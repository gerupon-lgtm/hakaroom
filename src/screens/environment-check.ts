import { checkWebXrAvailability } from '../ar/check-availability';

/**
 * S-001 対応環境チェック画面（F-001）。
 * container 内にチェック結果を描画する。対応OKなら onAvailable を呼ぶ。
 */
export function renderEnvironmentCheck(container: HTMLElement, onAvailable: () => void): void {
  container.innerHTML = '<p class="status">対応環境を確認しています…</p>';

  checkWebXrAvailability()
    .then((result) => {
      if (result.available) {
        container.innerHTML = '<p class="status status-ok">対応環境です。</p>';
        onAvailable();
        return;
      }
      renderUnavailable(container, result.reason ?? '不明な理由により利用できません。', onAvailable);
    })
    .catch(() => {
      renderUnavailable(container, '対応環境の確認中にエラーが発生しました。', onAvailable);
    });
}

function renderUnavailable(container: HTMLElement, reason: string, onAvailable: () => void): void {
  container.innerHTML = `
    <p class="status status-ng">この端末・ブラウザでは利用できません。</p>
    <p class="reason">${escapeHtml(reason)}</p>
    <button type="button" id="recheck">再チェック</button>
  `;
  const button = container.querySelector<HTMLButtonElement>('#recheck');
  button?.addEventListener('click', () => {
    renderEnvironmentCheck(container, onAvailable);
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
