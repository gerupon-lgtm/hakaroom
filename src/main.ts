import './style.css';
import { APP_VERSION } from './version';
import { renderEnvironmentCheck } from './screens/environment-check';
import { renderTechValidation } from './screens/tech-validation';

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
  renderTechValidation(mainContent);
});
