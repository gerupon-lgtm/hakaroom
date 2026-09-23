import * as THREE from 'three';
import { euclideanDistance3D } from '../../geometry/distance';
import type { Point3D } from '../../types';
import { INIT_TIMEOUT_MS, InitTimeoutError, withTimeout } from '../with-timeout';

/**
 * T-004 技術検証: Three.jsを使った2点間距離計測プロトタイプ。
 *
 * Three.js自体は独自の位置推定を持たない（同じWebXR Hit Test APIの上に
 * 乗るだけ）ため、単純な置き換えでは素のWebXR版(webxr-native)とほぼ同じ
 * 生データになるはずである。そこでT-004では操作方法も変える：
 * 「画面中央のクロスヘアを狙う」→「別ボタンを押す」という2段階操作をやめ、
 * **画面をタップした場所をそのまま測点にする**（transient-input hit test）。
 * 狙う/押すの間で端末が動いてしまう誤差要因を切り分けるのが目的。
 *
 * 参照空間は素のWebXR版のうち'local'側との比較を優先するため'local'固定とする。
 */
export interface TwoPointResultThreeJs {
  distanceMeters: number;
  points: Point3D[];
}

export async function runTwoPointDistancePrototypeThreeJs(
  hostElement: HTMLElement,
  onResult: (result: TwoPointResultThreeJs) => void,
): Promise<void> {
  const xr = navigator.xr;
  if (!xr) {
    hostElement.textContent = 'WebXR未対応のため技術検証Bは実行できません。';
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'xr-overlay';
  overlay.innerHTML = `
    <div class="xr-top-bar">
      <p class="xr-status" id="xr-status">初期化中…</p>
      <div class="xr-secondary-controls">
        <button type="button" id="xr-reset-1">測り直す</button>
        <button type="button" id="xr-exit-1">終了</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const canvas = document.createElement('canvas');
  canvas.className = 'xr-canvas';
  document.body.appendChild(canvas);

  const cleanup = () => {
    overlay.remove();
    canvas.remove();
  };

  // 「終了」は初期化の完了を待たずに最初から機能させる(T-003で判明した固まる不具合の教訓)。
  let session: XRSession | null = null;
  let cancelled = false;
  const exitButtonImmediate = overlay.querySelector<HTMLButtonElement>('#xr-exit-1')!;
  exitButtonImmediate.addEventListener('click', () => {
    cancelled = true;
    if (session) {
      void session.end();
    } else {
      cleanup();
      hostElement.textContent = 'キャンセルしました。もう一度お試しください。';
    }
  });

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));

  let timedOut = false;
  const sessionPromise = xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlay },
  });
  sessionPromise.then((lateSession) => {
    if (timedOut || cancelled) void lateSession.end();
  }).catch(() => undefined);

  try {
    session = await withTimeout(sessionPromise, INIT_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof InitTimeoutError) timedOut = true;
    if (cancelled) return;
    cleanup();
    hostElement.textContent =
      error instanceof InitTimeoutError
        ? 'ARセッションの開始がタイムアウトしました。少し待ってからもう一度お試しください。'
        : `ARセッションを開始できませんでした: ${(error as Error).message}`;
    return;
  }
  if (cancelled) {
    void session.end();
    return;
  }
  const xrSession: XRSession = session;

  try {
    await withTimeout(renderer.xr.setSession(xrSession));
  } catch (error) {
    if (!cancelled) {
      cleanup();
      hostElement.textContent = `Three.jsのセッション設定に失敗しました: ${(error as Error).message}`;
      void xrSession.end().catch(() => undefined);
    }
    return;
  }

  const referenceSpace = renderer.xr.getReferenceSpace();
  if (!referenceSpace) {
    cleanup();
    await xrSession.end().catch(() => undefined);
    hostElement.textContent = '参照空間を取得できませんでした。';
    return;
  }

  let hitTestSourceForTransientInput: XRTransientInputHitTestSource | undefined;
  try {
    hitTestSourceForTransientInput = await xrSession.requestHitTestSourceForTransientInput?.({
      profile: 'generic-touchscreen',
    });
  } catch {
    hitTestSourceForTransientInput = undefined;
  }

  if (!hitTestSourceForTransientInput) {
    cleanup();
    await xrSession.end().catch(() => undefined);
    hostElement.textContent = 'タップ位置のHit Test機能を初期化できませんでした。';
    return;
  }
  const hitTestSource = hitTestSourceForTransientInput;

  const statusEl = overlay.querySelector<HTMLElement>('#xr-status')!;
  const resetButton = overlay.querySelector<HTMLButtonElement>('#xr-reset-1')!;

  let points: Point3D[] = [];
  const markerGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x1565c0 });
  let markers: THREE.Mesh[] = [];
  let connectingLine: THREE.Line | null = null;

  function addMarker(position: Point3D): void {
    const mesh = new THREE.Mesh(markerGeometry, markerMaterial);
    mesh.position.set(position.x, position.y, position.z);
    scene.add(mesh);
    markers.push(mesh);
  }

  function drawLine(a: Point3D, b: Point3D): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
    ]);
    connectingLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
    scene.add(connectingLine);
  }

  function resetPoints(): void {
    points = [];
    markers.forEach((m) => scene.remove(m));
    markers = [];
    if (connectingLine) {
      scene.remove(connectingLine);
      connectingLine = null;
    }
    statusEl.textContent = '画面をタップして1点目を記録してください';
  }

  overlay.addEventListener('beforexrselect', (event) => event.preventDefault());
  resetButton.addEventListener('click', resetPoints);
  xrSession.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    cleanup();
  });

  xrSession.addEventListener('select', (event) => {
    if (points.length >= 2) return;
    const inputEvent = event as XRInputSourceEvent;
    const frame = inputEvent.frame;
    const results = frame.getHitTestResultsForTransientInput(hitTestSource);
    const matching = results.find((r) => r.inputSource === inputEvent.inputSource);
    const hitResult = matching?.results[0];
    if (!hitResult) {
      statusEl.textContent = 'その場所は認識できませんでした。もう一度タップしてください。';
      return;
    }
    const pose = hitResult.getPose(referenceSpace);
    if (!pose) return;

    const position: Point3D = {
      x: pose.transform.position.x,
      y: pose.transform.position.y,
      z: pose.transform.position.z,
    };
    points.push(position);
    addMarker(position);

    if (points.length === 1) {
      statusEl.textContent = '1点目を記録しました。2点目をタップしてください';
    } else {
      drawLine(points[0], points[1]);
      const distanceMeters = euclideanDistance3D(points[0], points[1]);
      statusEl.textContent = `距離: ${distanceMeters.toFixed(3)} m`;
      onResult({ distanceMeters, points: [...points] });
    }
  });

  statusEl.textContent = '画面をタップして1点目を記録してください';

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });
}
