import { runTwoPointDistancePrototype } from '../ar/webxr-native/two-point-prototype';
import type { Point3D } from '../types';

interface TrialRecord {
  method: 'webxr-native';
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
 */
export function renderTechValidation(container: HTMLElement): void {
  container.innerHTML = `
    <section>
      <h2>技術検証</h2>
      <p class="note">既知の距離（メジャー等で実測）を複数回計測し、誤差・ばらつきを記録します。</p>
      <button type="button" id="start-webxr-native">技術検証A: 素のWebXRで2点間計測を開始</button>
      <p class="note">技術検証B（Three.js）はT-004で実装予定です。</p>
      <div id="trial-list"></div>
    </section>
  `;

  const startButton = container.querySelector<HTMLButtonElement>('#start-webxr-native')!;
  startButton.addEventListener('click', () => {
    void runTwoPointDistancePrototype(container, (result) => {
      const actualInput = window.prompt(
        `計測距離: ${result.distanceMeters.toFixed(3)} m\nメジャー等で測った実際の距離（メートル）を入力してください（未計測なら空欄でOK）`,
      );
      const actualDistance = actualInput ? Number.parseFloat(actualInput) : null;
      const errorMeters =
        actualDistance !== null && !Number.isNaN(actualDistance)
          ? result.distanceMeters - actualDistance
          : null;

      trials.push({
        method: 'webxr-native',
        measuredDistance: result.distanceMeters,
        actualDistance: Number.isNaN(actualDistance!) ? null : actualDistance,
        errorMeters,
        points: result.points,
        recordedAt: new Date().toISOString(),
      });

      renderTrialList(container.querySelector<HTMLElement>('#trial-list')!);
    });
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
        <td>${t.method}</td>
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
        <tr><th>#</th><th>方式</th><th>計測値</th><th>実測値</th><th>誤差</th><th>判定</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
