import { euclideanDistance3D } from '../../geometry/distance';
import type { Point3D } from '../../types';

/**
 * T-003 技術検証: 素のWebXR Device APIのみで2点間距離を計測するプロトタイプ。
 *
 * Three.js等のライブラリを使わず、hit-testの生の値だけで距離が実用精度で
 * 取れるかを確認するための最小実装。ArBackend（docs/api-design.md）の
 * 正式な実装はT-006（採用方式決定後）で行う。ここでは検証に必要な最小限
 * （床の検出→2点タップ→距離表示）だけを実装する。
 *
 * hit testの基準空間には 'viewer'（画面中心から前方へのレイ）を使う。
 * つまり画面中央に十字マーカーを重ね、狙った床の点をタップして記録する。
 */
export async function runTwoPointDistancePrototype(
  hostElement: HTMLElement,
  onResult: (result: { distanceMeters: number; points: Point3D[] }) => void,
): Promise<void> {
  const xr = navigator.xr;
  if (!xr) {
    hostElement.textContent = 'WebXR未対応のため技術検証Aは実行できません。';
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'xr-overlay';
  overlay.innerHTML = `
    <p class="xr-status" id="xr-status">初期化中…</p>
    <div class="xr-crosshair" aria-hidden="true"></div>
    <div class="xr-controls">
      <button type="button" id="xr-record">記録（<span id="xr-count">0</span>/2）</button>
      <button type="button" id="xr-exit">終了</button>
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

  const gl = canvas.getContext('webgl', { xrCompatible: true });
  if (!gl) {
    cleanup();
    hostElement.textContent = 'WebGLコンテキストの初期化に失敗しました。';
    return;
  }

  let session: XRSession;
  try {
    session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlay },
    });
  } catch (error) {
    cleanup();
    hostElement.textContent = `ARセッションを開始できませんでした: ${(error as Error).message}`;
    return;
  }

  await gl.makeXRCompatible();
  await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

  const referenceSpace = await session.requestReferenceSpace('local');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const requestedHitTestSource = await session.requestHitTestSource?.({ space: viewerSpace });

  if (!requestedHitTestSource) {
    cleanup();
    await session.end().catch(() => undefined);
    hostElement.textContent = 'Hit Test機能を初期化できませんでした。';
    return;
  }
  // クロージャ内でのnull/undefined narrowingのため、非nullが確定した値を別変数に固定する
  const glContext = gl;
  const hitTestSource = requestedHitTestSource;

  const points: Point3D[] = [];
  let latestHitPosition: Point3D | null = null;

  const statusEl = overlay.querySelector<HTMLElement>('#xr-status')!;
  const countEl = overlay.querySelector<HTMLElement>('#xr-count')!;
  const recordButton = overlay.querySelector<HTMLButtonElement>('#xr-record')!;
  const exitButton = overlay.querySelector<HTMLButtonElement>('#xr-exit')!;

  function recordPoint(): void {
    if (!latestHitPosition || points.length >= 2) return;
    points.push({ ...latestHitPosition });
    countEl.textContent = String(points.length);
    if (points.length === 2) {
      const distanceMeters = euclideanDistance3D(points[0], points[1]);
      statusEl.textContent = `距離: ${distanceMeters.toFixed(3)} m`;
      onResult({ distanceMeters, points: [...points] });
    }
  }

  // DOM Overlay上のボタン操作がARの'select'イベントとしても発火し、
  // 1回のタップでrecordPointが二重に呼ばれる(=1タップで2点とも記録される)
  // 問題を防ぐ。'select'では記録せず、明示的なボタンのクリックのみで記録する。
  overlay.addEventListener('beforexrselect', (event) => event.preventDefault());
  recordButton.addEventListener('click', recordPoint);
  exitButton.addEventListener('click', () => session.end());
  session.addEventListener('end', cleanup);

  function onXRFrame(_time: number, frame: XRFrame): void {
    session.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(referenceSpace);
    const glLayer = session.renderState.baseLayer;
    if (!pose || !glLayer) {
      statusEl.textContent = '追跡中…';
      return;
    }

    glContext.bindFramebuffer(glContext.FRAMEBUFFER, glLayer.framebuffer);
    glContext.viewport(0, 0, glLayer.framebufferWidth, glLayer.framebufferHeight);
    glContext.clearColor(0, 0, 0, 0);
    glContext.clear(glContext.COLOR_BUFFER_BIT | glContext.DEPTH_BUFFER_BIT);

    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length > 0) {
      const hitPose = hitTestResults[0].getPose(referenceSpace);
      if (hitPose) {
        latestHitPosition = {
          x: hitPose.transform.position.x,
          y: hitPose.transform.position.y,
          z: hitPose.transform.position.z,
        };
        if (points.length < 2) statusEl.textContent = '床を検出しました。画面中央を狙って「記録」';
      } else {
        latestHitPosition = null;
      }
    } else {
      latestHitPosition = null;
      if (points.length < 2) statusEl.textContent = '床を探しています…端末をゆっくり動かしてください';
    }
  }

  session.requestAnimationFrame(onXRFrame);
}
