import { renderAssets } from './assets.js';
import { renderReferences } from './references.js';

let activeSubTab = 'assets';

export function renderMaterials(container, ctx) {
  container.innerHTML = `
    <div class="toolbar">
      <div>
        <button class="btn btn-small${activeSubTab === 'assets' ? ' btn-primary' : ''}" id="materials-subtab-assets">素材</button>
        <button class="btn btn-small${activeSubTab === 'references' ? ' btn-primary' : ''}" id="materials-subtab-references">資料</button>
      </div>
      <div></div>
    </div>
    <div id="materials-content"></div>
  `;

  container.querySelector('#materials-subtab-assets').addEventListener('click', () => {
    activeSubTab = 'assets';
    renderMaterials(container, ctx);
  });
  container.querySelector('#materials-subtab-references').addEventListener('click', () => {
    activeSubTab = 'references';
    renderMaterials(container, ctx);
  });

  const content = container.querySelector('#materials-content');
  if (activeSubTab === 'assets') {
    renderAssets(content, ctx);
  } else {
    renderReferences(content, ctx);
  }
}
