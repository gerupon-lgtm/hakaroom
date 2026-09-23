import './style.css';
import { APP_VERSION } from './version';
import { renderEnvironmentCheck } from './screens/environment-check';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element not found');

app.innerHTML = `
  <header class="app-header">
    <span class="app-icon" aria-hidden="true">📐</span>
    <span class="app-name">ハカルーム</span>
  </header>
  <main id="main-content"></main>
  <footer class="app-footer">
    <span class="app-version">${APP_VERSION}</span>
    <span class="app-copyright">© 2026 SIKUMI LAB</span>
  </footer>
`;

const mainContent = app.querySelector<HTMLElement>('#main-content');
if (!mainContent) throw new Error('#main-content element not found');

renderEnvironmentCheck(mainContent, () => {
  // T-002時点では以降の画面(S-002〜)は未実装。技術検証(T-003/T-004)で確定してから実装する。
  mainContent.innerHTML +=
    '<p class="note">対応環境の確認までがフェーズ0（技術検証）の対象です。以降の計測画面は次のフェーズで実装します。</p>';
});
