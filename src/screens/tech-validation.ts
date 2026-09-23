import { runTwoPointDistancePrototype } from '../ar/webxr-native/two-point-prototype';
import type { Point3D } from '../types';

interface TrialRecord {
  method: 'webxr-native' | 'threejs';
  referenceSpaceType: 'local-floor' | 'local';
  interaction: 'クロスヘア+ボタン' | 'タップ即記録';
  measuredDistance: number;
  actualDistance: number | null;
  errorMeters: number | null;
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
      <div id="trial-list"></div>
    </section>
  `;

  function recordTrial(
    method: TrialRecord['method'],
    interaction: TrialRecord['interaction'],
    referenceSpaceType: TrialRecord['referenceSpaceType'],
    measuredDistance: number,
    points: Point3D[],
  ): void {
    const actualInput = window.prompt(
      `計測距離: ${measuredDistance.toFixed(3)} m（${method} / ${referenceSpaceType} / ${interaction}）\nメジャー等で測った実際の距離（メートル）を入力してください（未計測なら空欄でOK）`,
    );
    const actualDistance = actualInput ? Number.parseFloat(actualInput) : null;
    const validActual = actualDistance !== null && !Number.isNaN(actualDistance) ? actualDistance : null;
    const errorMeters = validActual !== null ? measuredDistance - validActual : null;

    trials.push({
      method,
      referenceSpaceType,
      interaction,
      measuredDistance,
      actualDistance: validActual,
      errorMeters,
      points,
      recordedAt: new Date().toISOString(),
    });

    renderTrialList(container.querySelector<HTMLElement>('#trial-list')!);
  }

  container.querySelector<HTMLButtonElement>('#start-local-floor')!.addEventListener('click', () => {
    void runTwoPointDistancePrototype(
      container,
      (result) => recordTrial('webxr-native', 'クロスヘア+ボタン', result.referenceSpaceType, result.distanceMeters, result.points),
      { preferLocalFloor: true },
    );
  });
  container.querySelector<HTMLButtonElement>('#start-local')!.addEventListener('click', () => {
    void runTwoPointDistancePrototype(
      container,
      (result) => recordTrial('webxr-native', 'クロスヘア+ボタン', result.referenceSpaceType, result.distanceMeters, result.points),
      { preferLocalFloor: false },
    );
  });
  container.querySelector<HTMLButtonElement>('#start-threejs')!.addEventListener('click', () => {
    // three.js(500KB超)は技術検証Bを使う人だけが読み込めばよいため動的importにする
    void import('../ar/threejs/two-point-prototype').then(({ runTwoPointDistancePrototypeThreeJs }) =>
      runTwoPointDistancePrototypeThreeJs(container, (result) =>
        recordTrial('threejs', 'タップ即記録', 'local', result.distanceMeters, result.points),
      ),
    );
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
      const actual = t.actualDistance !== null ? `${t.actualDistance.toFixed(3)} m` : '未入力';
      const within3cm = t.errorMeters !== null ? Math.abs(t.errorMeters) <= 0.03 : null;
      const badge =
        within3cm === null ? '' : within3cm ? '<span class="ok">±3cm以内</span>' : '<span class="ng">±3cm超</span>';
      return `<tr>
        <td>${i + 1}</td>
        <td>${t.method}<br>${t.referenceSpaceType}<br>${t.interaction}</td>
        <td>${t.measuredDistance.toFixed(3)} m</td>
        <td>${actual}</td>
        <td>${errorCm} cm</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join('');

  listContainer.innerHTML = `
    <table class="trial-table">
      <thead>
        <tr><th>#</th><th>方式/参照空間/操作</th><th>計測値</th><th>実測値</th><th>誤差</th><th>判定</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
