import { euclideanDistance3D } from '../../geometry/distance';
import type { Point3D } from '../../types';
import { INIT_TIMEOUT_MS, InitTimeoutError, withTimeout } from '../with-timeout';

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

export interface TwoPointResult {
  distanceMeters: number;
  points: Point3D[];
  referenceSpaceType: 'local-floor' | 'local';
  /** 端末の入力欄でその場で入力した実測値(メートル)。未入力ならnull。 */
  actualDistanceMeters: number | null;
  /**
   * この計測がキャリブレーション（縮尺補正係数を設定した回）かどうか。
   * キャリブレーション回は「補正後の値」を実測値と比較する意味がないためnullになる。
   */
  isCalibration: boolean;
  /** 縮尺補正係数(実測値/生の計測値)が設定済みの場合の補正後距離。未設定ならnull。 */
  correctedDistanceMeters: number | null;
}

export interface TwoPointPrototypeOptions {
  /**
   * true: local-floorを優先し、非対応なら'local'にフォールバックする。
   * false: 最初から'local'のみを使う。
   * local-floor導入後に精度が悪化した疑いがあるため、A/B比較用に選べるようにしている。
   */
  preferLocalFloor: boolean;
}

export async function runTwoPointDistancePrototype(
  hostElement: HTMLElement,
  onResult: (result: TwoPointResult) => void,
  options: TwoPointPrototypeOptions = { preferLocalFloor: true },
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
      <p class="xr-refspace" id="xr-calibration"></p>
      <div class="xr-secondary-controls">
        <button type="button" class="xr-reset" id="xr-reset-1">測り直す</button>
        <button type="button" id="xr-clear-calibration">キャリブレーション解除</button>
        <button type="button" class="xr-exit" id="xr-exit-1">終了</button>
      </div>
      <div class="xr-actual-input-row" id="xr-actual-input-row" hidden>
        <input type="text" inputmode="decimal" id="xr-actual-input" placeholder="実測値(m)・任意" />
        <button type="button" id="xr-confirm-actual">記録して次へ</button>
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

  // 初期化(requestSession等)が途中で固まっても必ず抜けられるよう、
  // 「終了」ボタンは初期化の完了を待たずに最初から機能させる。
  // sessionはこの時点ではまだ存在しないので、生成され次第上書きする。
  let session: XRSession | null = null;
  const exitButtonImmediate = overlay.querySelector<HTMLButtonElement>('#xr-exit-1')!;
  let cancelled = false;
  exitButtonImmediate.addEventListener('click', () => {
    cancelled = true;
    if (session) {
      void session.end();
    } else {
      cleanup();
      hostElement.textContent = 'キャンセルしました。もう一度お試しください。';
    }
  });

  const gl = canvas.getContext('webgl', { xrCompatible: true });
  if (!gl) {
    cleanup();
    hostElement.textContent = 'WebGLコンテキストの初期化に失敗しました。';
    return;
  }

  // タイムアウト後にrequestSessionが遅れて成功した場合、カメラを握ったまま
  // 誰にも参照されないセッションが残ってしまう(リソースリーク)ため、
  // その場合は即座に終了させる。
  let timedOut = false;
  const sessionPromise = xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local'],
    optionalFeatures: ['dom-overlay', 'local-floor'],
    domOverlay: { root: overlay },
  });
  sessionPromise
    .then((lateSession) => {
      if (timedOut || cancelled) void lateSession.end();
    })
    .catch(() => undefined);

  try {
    session = await withTimeout(sessionPromise, INIT_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof InitTimeoutError) timedOut = true;
    if (cancelled) return; // ユーザーが「終了」で既にキャンセル済み
    cleanup();
    hostElement.textContent =
      error instanceof InitTimeoutError
        ? 'ARセッションの開始がタイムアウトしました。Androidの全画面案内表示が影響している可能性があります。少し待ってからもう一度お試しください。'
        : `ARセッションを開始できませんでした: ${(error as Error).message}`;
    return;
  }
  if (cancelled) {
    void session.end();
    return;
  }
  // クロージャ内でのnull narrowingのため、非nullが確定した値を別変数に固定する
  const xrSession: XRSession = session;

  try {
    await withTimeout(gl.makeXRCompatible(), INIT_TIMEOUT_MS);
    await withTimeout(xrSession.updateRenderState({ baseLayer: new XRWebGLLayer(xrSession, gl) }), INIT_TIMEOUT_MS);
  } catch (error) {
    if (!cancelled) {
      cleanup();
      hostElement.textContent = `WebGLの初期化に失敗しました: ${(error as Error).message}`;
      void xrSession.end().catch(() => undefined);
    }
    return;
  }

  let referenceSpace: XRReferenceSpace;
  let referenceSpaceType: 'local-floor' | 'local';
  if (options.preferLocalFloor) {
    try {
      referenceSpace = await xrSession.requestReferenceSpace('local-floor');
      referenceSpaceType = 'local-floor';
    } catch {
      referenceSpace = await xrSession.requestReferenceSpace('local');
      referenceSpaceType = 'local';
    }
  } else {
    referenceSpace = await xrSession.requestReferenceSpace('local');
    referenceSpaceType = 'local';
  }
  const viewerSpace = await xrSession.requestReferenceSpace('viewer');
  const requestedHitTestSource = await xrSession.requestHitTestSource?.({ space: viewerSpace });

  const refSpaceEl = overlay.querySelector<HTMLElement>('#xr-refspace')!;
  refSpaceEl.textContent =
    referenceSpaceType === 'local-floor'
      ? '参照空間: local-floor（高さの判定が可能）'
      : '参照空間: local（この端末では高さの一致判定はできません）';

  if (!requestedHitTestSource) {
    cleanup();
    await xrSession.end().catch(() => undefined);
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
  // 終了ボタン(#xr-exit-1)は初期化開始前に既に配線済み(exitButtonImmediate)のため、ここでは再登録しない
  const actualInputRow = overlay.querySelector<HTMLDivElement>('#xr-actual-input-row')!;
  const actualInput = overlay.querySelector<HTMLInputElement>('#xr-actual-input')!;
  const confirmActualButton = overlay.querySelector<HTMLButtonElement>('#xr-confirm-actual')!;
  const calibrationEl = overlay.querySelector<HTMLElement>('#xr-calibration')!;
  const clearCalibrationButton = overlay.querySelector<HTMLButtonElement>('#xr-clear-calibration')!;

  let pendingResult: { distanceMeters: number; points: Point3D[] } | null = null;
  /**
   * 縮尺補正係数(実測値/生の計測値)。要件定義書F-011の「基準距離の入力」に相当する
   * 最も単純なハイブリッド方式の検証: セッション内で最初に実測値を入力した回を
   * キャリブレーションとして扱い、以後の計測にこの係数を掛けて補正値を出す。
   */
  let scaleFactor: number | null = null;

  function updateCalibrationLabel(): void {
    calibrationEl.textContent =
      scaleFactor === null
        ? 'キャリブレーション: 未設定（最初の実測値入力が基準になります）'
        : `キャリブレーション: 設定済み（補正係数 ×${scaleFactor.toFixed(4)}）`;
  }
  updateCalibrationLabel();

  clearCalibrationButton.addEventListener('click', () => {
    scaleFactor = null;
    updateCalibrationLabel();
  });

  function recordPoint(): void {
    if (!latestHitPosition || points.length >= 2) return;
    points.push({ ...latestHitPosition });
    countEls.forEach((el) => (el.textContent = String(points.length)));
    if (points.length === 2) {
      const distanceMeters = euclideanDistance3D(points[0], points[1]);
      let message = `距離(生値): ${distanceMeters.toFixed(3)} m`;
      if (scaleFactor !== null) {
        message += ` ／補正後: ${(distanceMeters * scaleFactor).toFixed(3)} m`;
      }
      if (referenceSpaceType === 'local-floor') {
        const heightDiff = Math.abs(points[0].y - points[1].y);
        if (heightDiff > HEIGHT_MISMATCH_WARNING_METERS) {
          message += ` ／⚠高さの差 ${(heightDiff * 100).toFixed(1)}cm（2点の高さが揃っていない可能性）`;
        }
      }
      statusEl.textContent = message;
      // window.prompt()はブロッキングダイアログで、表示するとARセッションが
      // 強制終了されてしまう(実機で確認)。ARを抜けずに実測値を入力できるよう、
      // DOM Overlay内のインライン入力欄をここで表示する。
      pendingResult = { distanceMeters, points: [...points] };
      actualInputRow.hidden = false;
      actualInput.value = '';
      actualInput.focus();
    }
  }

  function confirmActualDistance(): void {
    if (!pendingResult) return;
    const parsed = actualInput.value.trim() === '' ? null : Number.parseFloat(actualInput.value);
    const actualDistanceMeters = parsed !== null && !Number.isNaN(parsed) ? parsed : null;

    let isCalibration = false;
    let correctedDistanceMeters: number | null = null;
    if (scaleFactor === null) {
      // この回でキャリブレーションを設定する(実測値が無ければ設定できず、補正なしのまま)
      if (actualDistanceMeters !== null && pendingResult.distanceMeters > 0) {
        scaleFactor = actualDistanceMeters / pendingResult.distanceMeters;
        isCalibration = true;
        updateCalibrationLabel();
      }
    } else {
      correctedDistanceMeters = pendingResult.distanceMeters * scaleFactor;
    }

    onResult({
      ...pendingResult,
      referenceSpaceType,
      actualDistanceMeters,
      isCalibration,
      correctedDistanceMeters,
    });
    pendingResult = null;
    actualInputRow.hidden = true;
    resetPoints();
  }

  /**
   * ARセッション(=トラッキング)を維持したまま測点だけをリセットする。
   * セッションを終了・再開すると毎回トラッキングが初期化されてしまい、
   * 「同一セッション内でトラッキングが安定していくか」を検証できないため、
   * 記録のやり直しは終了・再開ではなくこのリセットで行う。
   */
  function resetPoints(): void {
    points = [];
    pendingResult = null;
    actualInputRow.hidden = true;
    countEls.forEach((el) => (el.textContent = '0'));
    statusEl.textContent = latestHitPosition ? '床を検出しました。画面中央を狙って「記録」' : '追跡中…';
  }

  // DOM Overlay上のボタン操作がARの'select'イベントとしても発火し、
  // 1回のタップでrecordPointが二重に呼ばれる(=1タップで2点とも記録される)
  // 問題を防ぐ。'select'では記録せず、明示的なボタンのクリックのみで記録する。
  overlay.addEventListener('beforexrselect', (event) => event.preventDefault());
  recordButtons.forEach((button) => button.addEventListener('click', recordPoint));
  resetButton.addEventListener('click', resetPoints);
  confirmActualButton.addEventListener('click', confirmActualDistance);
  xrSession.addEventListener('end', cleanup);

  function onXRFrame(_time: number, frame: XRFrame): void {
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(referenceSpace);
    const glLayer = xrSession.renderState.baseLayer;
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

  xrSession.requestAnimationFrame(onXRFrame);
}
