import { runTwoPointDistancePrototype } from '../ar/webxr-native/two-point-prototype';
import type { Point3D } from '../types';

interface TrialRecord {
  method: 'webxr-native' | 'threejs';
  referenceSpaceType: 'local-floor' | 'local';
  interaction: 'クロスヘア+ボタン' | 'タップ即記録';
  measuredDistance: number;
  correctedDistance: number | null;
  isCalibration: boolean;
  actualDistance: number | null;
  errorMeters: number | null;
  correctedErrorMeters: number | null;
  points: Point3D[];
  recordedAt: string;
}

const trials: TrialRecord[] = [];

/**
 * T-003/T-004 技術検証の暫定UI。
 * 正式な検証記録画面（S-005, F-008）はT-010で実装するため、
 * ここでは技術検証に必要な最小限（既知距離との比較・一覧表示）だけを提供する。
 *
 * local-floor参照空間へ切り替えた後に精度悪化が疑われたため、
 * local-floor / local をその場で選んで直接比較できるようにしている。
 * T-004（Three.js版）はさらに「タップした場所を即座に測点にする」操作方式に
 * 変え、狙う/押すの間のズレが誤差要因かどうかも切り分けられるようにしている。
 */
export function renderTechValidation(container: HTMLElement): void {
  container.innerHTML = `
    <section>
      <h2>技術検証</h2>
      <p class="note">既知の距離（メジャー等で実測）を複数回計測し、誤差・ばらつきを記録します。</p>
      <button type="button" id="start-local-floor">技術検証A: 素のWebXR（local-floor優先／クロスヘア+ボタン）</button>
      <button type="button" id="start-local">技術検証A: 素のWebXR（localのみ／クロスヘア+ボタン）</button>
      <button type="button" id="start-threejs">技術検証B: Three.js（local固定／タップ即記録）</button>
      <button type="button" id="start-photo-lab">技術検証D: 写真方式（撮影・傾きセンサー）</button>
      <div id="trial-list"></div>
    </section>
  `;

  function recordTrial(
    method: TrialRecord['method'],
    interaction: TrialRecord['interaction'],
    referenceSpaceType: TrialRecord['referenceSpaceType'],
    measuredDistance: number,
    points: Point3D[],
    actualDistance: number | null,
    correctedDistance: number | null = null,
    isCalibration = false,
  ): void {
    const errorMeters = actualDistance !== null ? measuredDistance - actualDistance : null;
    const correctedErrorMeters =
      actualDistance !== null && correctedDistance !== null ? correctedDistance - actualDistance : null;

    trials.push({
      method,
      referenceSpaceType,
      interaction,
      measuredDistance,
      correctedDistance,
      isCalibration,
      actualDistance,
      errorMeters,
      correctedErrorMeters,
      points,
      recordedAt: new Date().toISOString(),
    });

    renderTrialList(container.querySelector<HTMLElement>('#trial-list')!);
  }

  container.querySelector<HTMLButtonElement>('#start-local-floor')!.addEventListener('click', () => {
    void runTwoPointDistancePrototype(
      container,
      (result) =>
        recordTrial(
          'webxr-native',
          'クロスヘア+ボタン',
          result.referenceSpaceType,
          result.distanceMeters,
          result.points,
          result.actualDistanceMeters,
          result.correctedDistanceMeters,
          result.isCalibration,
        ),
      { preferLocalFloor: true },
    );
  });
  container.querySelector<HTMLButtonElement>('#start-local')!.addEventListener('click', () => {
    void runTwoPointDistancePrototype(
      container,
      (result) =>
        recordTrial(
          'webxr-native',
          'クロスヘア+ボタン',
          result.referenceSpaceType,
          result.distanceMeters,
          result.points,
          result.actualDistanceMeters,
          result.correctedDistanceMeters,
          result.isCalibration,
        ),
      { preferLocalFloor: false },
    );
  });
  container.querySelector<HTMLButtonElement>('#start-threejs')!.addEventListener('click', () => {
    // three.js(500KB超)は技術検証Bを使う人だけが読み込めばよいため動的importにする
    void import('../ar/threejs/two-point-prototype').then(({ runTwoPointDistancePrototypeThreeJs }) =>
      runTwoPointDistancePrototypeThreeJs(container, (result) =>
        recordTrial('threejs', 'タップ即記録', 'local', result.distanceMeters, result.points, result.actualDistanceMeters),
      ),
    );
  });

  container.querySelector<HTMLButtonElement>('#start-photo-lab')!.addEventListener('click', () => {
    void import('./photo-lab').then(({ renderPhotoLab }) => renderPhotoLab(container));
  });

  renderTrialList(container.querySelector<HTMLElement>('#trial-list')!);
}

function renderTrialList(listContainer: HTMLElement): void {
  if (trials.length === 0) {
    listContainer.innerHTML = '<p class="note">まだ計測記録はありません。</p>';
    return;
  }

  const rows = trials
    .map((t, i) => {
      const errorCm = t.errorMeters !== null ? (t.errorMeters * 100).toFixed(1) : '—';
      const correctedCm = t.correctedErrorMeters !== null ? (t.correctedErrorMeters * 100).toFixed(1) : '—';
      const actual = t.actualDistance !== null ? `${t.actualDistance.toFixed(3)} m` : '未入力';
      const corrected = t.correctedDistance !== null ? `${t.correctedDistance.toFixed(3)} m` : t.isCalibration ? '（基準）' : '—';
      const within3cm = t.correctedErrorMeters !== null ? Math.abs(t.correctedErrorMeters) <= 0.03 : t.errorMeters !== null ? Math.abs(t.errorMeters) <= 0.03 : null;
      const badge =
        within3cm === null ? '' : within3cm ? '<span class="ok">±3cm以内</span>' : '<span class="ng">±3cm超</span>';
      const calibrationTag = t.isCalibration ? '<br><strong>キャリブレーション基準</strong>' : '';
      return `<tr>
        <td>${i + 1}</td>
        <td>${t.method}<br>${t.referenceSpaceType}<br>${t.interaction}${calibrationTag}</td>
        <td>生: ${t.measuredDistance.toFixed(3)} m<br>補正: ${corrected}</td>
        <td>${actual}</td>
        <td>生誤差: ${errorCm} cm<br>補正誤差: ${correctedCm} cm</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join('');

  listContainer.innerHTML = `
    <table class="trial-table">
      <thead>
        <tr><th>#</th><th>方式/参照空間/操作</th><th>計測値(生/補正)</th><th>実測値</th><th>誤差(生/補正)</th><th>判定</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
