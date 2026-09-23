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
 *
 * 参照空間は可能なら 'local-floor'（重力方向にY軸を揃え、Y=0を床面とする）
 * を使う。これにより、床が最初に一度検出できればその後は画面に映り続けなくても
 * トラッキングは継続し、また2点の高さ(Y座標)が実際に一致しているかを
 * 判定できるようになる。'local-floor'が使えない端末では'local'にフォールバック
 * する（その場合、高さの判定はできない旨を表示する）。
 */
const HEIGHT_MISMATCH_WARNING_METERS = 0.05;

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
  // 記録ボタンは右手・左手どちらの片手持ちでも親指が届くよう、
  // 画面下の左右両隅に同じ機能のボタンを複製配置する（技術検証段階の暫定措置）。
  // 測り直す/終了は使用頻度が低いため、邪魔にならない上部にまとめる。
  overlay.innerHTML = `
    <div class="xr-top-bar">
      <p class="xr-status" id="xr-status">初期化中…</p>
      <p class="xr-refspace" id="xr-refspace"></p>
      <div class="xr-secondary-controls">
        <button type="button" class="xr-reset" id="xr-reset-1">測り直す</button>
        <button type="button" class="xr-exit" id="xr-exit-1">終了</button>
      </div>
    </div>
    <div class="xr-crosshair" aria-hidden="true"></div>
    <button type="button" class="xr-record xr-record-left" id="xr-record-left">
      記録<br>(<span class="xr-count">0</span>/2)
    </button>
    <button type="button" class="xr-record xr-record-right" id="xr-record-right">
      記録<br>(<span class="xr-count">0</span>/2)
    </button>
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
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: overlay },
    });
  } catch (error) {
    cleanup();
    hostElement.textContent = `ARセッションを開始できませんでした: ${(error as Error).message}`;
    return;
  }

  await gl.makeXRCompatible();
  await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

  let referenceSpace: XRReferenceSpace;
  let referenceSpaceType: 'local-floor' | 'local';
  try {
    referenceSpace = await session.requestReferenceSpace('local-floor');
    referenceSpaceType = 'local-floor';
  } catch {
    referenceSpace = await session.requestReferenceSpace('local');
    referenceSpaceType = 'local';
  }
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const requestedHitTestSource = await session.requestHitTestSource?.({ space: viewerSpace });

  const refSpaceEl = overlay.querySelector<HTMLElement>('#xr-refspace')!;
  refSpaceEl.textContent =
    referenceSpaceType === 'local-floor'
      ? '参照空間: local-floor（高さの判定が可能）'
      : '参照空間: local（この端末では高さの一致判定はできません）';

  if (!requestedHitTestSource) {
    cleanup();
    await session.end().catch(() => undefined);
    hostElement.textContent = 'Hit Test機能を初期化できませんでした。';
    return;
  }
  // クロージャ内でのnull/undefined narrowingのため、非nullが確定した値を別変数に固定する
  const glContext = gl;
  const hitTestSource = requestedHitTestSource;

  let points: Point3D[] = [];
  let latestHitPosition: Point3D | null = null;

  const statusEl = overlay.querySelector<HTMLElement>('#xr-status')!;
  const countEls = overlay.querySelectorAll<HTMLElement>('.xr-count');
  const recordButtons = overlay.querySelectorAll<HTMLButtonElement>('.xr-record');
  const resetButton = overlay.querySelector<HTMLButtonElement>('#xr-reset-1')!;
  const exitButton = overlay.querySelector<HTMLButtonElement>('#xr-exit-1')!;

  function recordPoint(): void {
    if (!latestHitPosition || points.length >= 2) return;
    points.push({ ...latestHitPosition });
    countEls.forEach((el) => (el.textContent = String(points.length)));
    if (points.length === 2) {
      const distanceMeters = euclideanDistance3D(points[0], points[1]);
      let message = `距離: ${distanceMeters.toFixed(3)} m`;
      if (referenceSpaceType === 'local-floor') {
        const heightDiff = Math.abs(points[0].y - points[1].y);
        if (heightDiff > HEIGHT_MISMATCH_WARNING_METERS) {
          message += ` ／⚠高さの差 ${(heightDiff * 100).toFixed(1)}cm（2点の高さが揃っていない可能性）`;
        }
      }
      statusEl.textContent = message;
      onResult({ distanceMeters, points: [...points] });
    }
  }

  /**
   * ARセッション(=トラッキング)を維持したまま測点だけをリセットする。
   * セッションを終了・再開すると毎回トラッキングが初期化されてしまい、
   * 「同一セッション内でトラッキングが安定していくか」を検証できないため、
   * 記録のやり直しは終了・再開ではなくこのリセットで行う。
   */
  function resetPoints(): void {
    points = [];
    countEls.forEach((el) => (el.textContent = '0'));
    statusEl.textContent = latestHitPosition ? '床を検出しました。画面中央を狙って「記録」' : '追跡中…';
  }

  // DOM Overlay上のボタン操作がARの'select'イベントとしても発火し、
  // 1回のタップでrecordPointが二重に呼ばれる(=1タップで2点とも記録される)
  // 問題を防ぐ。'select'では記録せず、明示的なボタンのクリックのみで記録する。
  overlay.addEventListener('beforexrselect', (event) => event.preventDefault());
  recordButtons.forEach((button) => button.addEventListener('click', recordPoint));
  resetButton.addEventListener('click', resetPoints);
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
