import { api } from './api.js';
import { renderDashboard } from './dashboard.js';
import { renderTasks } from './tasks.js';
import { renderGantt } from './gantt.js';
import { renderMembers } from './members.js';
import { renderMemos } from './memos.js';
import { renderLinks } from './links.js';
import { renderMaterials } from './materials.js';
import { renderRenderQueue } from './renderQueue.js';
import { initThemeToggle } from './theme.js';
import { escapeHtml } from './utils.js';

initThemeToggle();

const isReadonlyMode = new URLSearchParams(window.location.search).get('readonly') === '1';

const TABS = {
  dashboard: { label: 'ダッシュボード', render: renderDashboard },
  tasks: { label: 'タスク一覧', render: renderTasks },
  gantt: { label: 'スケジュール', render: renderGantt },
  members: { label: 'メンバー', render: renderMembers },
  materials: { label: '素材・資料', render: renderMaterials },
  links: { label: 'リンク集', render: renderLinks },
  memos: { label: 'メモ', render: renderMemos },
  renderQueue: { label: 'レンダー', render: renderRenderQueue },
};

let data = {
  members: [],
  tasks: [],
  milestones: [],
  memos: [],
  links: [],
  assets: [],
  references: [],
  renderJobs: [],
  notificationSettings: { discordWebhookUrl: '' },
};
let currentMemberId = null;
let activeTab = 'dashboard';

const panel = document.getElementById('panel');
const tabsNav = document.getElementById('tabs');
const headerUser = document.getElementById('header-user');
const modalLayer = document.getElementById('modal-layer');

function getCurrentMember() {
  return data.members.find((m) => m.id === currentMemberId) || null;
}

async function loadData() {
  const [members, tasks, milestones, memos, links, assets, references, renderJobs, notificationSettings] =
    await Promise.all([
      api.getMembers(),
      api.getTasks(),
      api.getMilestones(),
      api.getMemos(),
      api.getLinks(),
      api.getAssets(),
      api.getReferences(),
      api.getRenderJobs(),
      api.getNotificationSettings(),
    ]);
  data = { members, tasks, milestones, memos, links, assets, references, renderJobs, notificationSettings };
}

function buildCtx() {
  const currentMember = getCurrentMember();
  return {
    ...data,
    currentMember,
    isAdmin: Boolean(currentMember && currentMember.isAdmin),
    isReadonly: isReadonlyMode,
    api,
    refresh,
    goToTab,
  };
}

function renderHeader() {
  const currentMember = getCurrentMember();
  if (isReadonlyMode) {
    headerUser.innerHTML = '<span class="header-user-name">閲覧専用モード</span>';
    return;
  }
  if (!currentMember) {
    headerUser.innerHTML = '';
    return;
  }
  headerUser.innerHTML = `
    <div class="header-search">
      <input type="text" id="global-search-input" placeholder="検索(タスク/メモ/リンク)" />
      <div id="global-search-results" class="search-results" hidden></div>
    </div>
    <span class="header-user-name">${escapeHtml(currentMember.name)}${
    currentMember.isAdmin ? ' <span class="badge status-doing">管理者</span>' : ''
  }</span>
  `;
  setupSearchBox();
}

function buildSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];

  for (const t of data.tasks) {
    if (t.title.toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q)) {
      results.push({ type: 'タスク', label: t.title, tab: 'tasks' });
    }
  }
  for (const m of data.memos) {
    if ((m.content || '').toLowerCase().includes(q)) {
      results.push({ type: 'メモ', label: m.content.slice(0, 40), tab: 'memos' });
    }
  }
  for (const l of data.links) {
    if ((l.title || '').toLowerCase().includes(q)) {
      results.push({ type: 'リンク', label: l.title, tab: 'links' });
    }
  }
  return results.slice(0, 20);
}

function renderSearchResults(results) {
  const box = document.getElementById('global-search-results');
  if (!box) return;
  box.innerHTML =
    results.length === 0
      ? '<p class="empty">一致する結果がありません</p>'
      : results
          .map(
            (r) =>
              `<button type="button" class="search-result-item" data-tab="${r.tab}"><span class="badge" style="background:#6b7280">${r.type}</span> ${escapeHtml(r.label)}</button>`
          )
          .join('');
  box.hidden = false;
  box.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      goToTab(btn.dataset.tab);
      box.hidden = true;
      const input = document.getElementById('global-search-input');
      if (input) input.value = '';
    });
  });
}

let searchOutsideClickWired = false;

function setupSearchBox() {
  const input = document.getElementById('global-search-input');
  const box = document.getElementById('global-search-results');
  if (!input || !box) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    renderSearchResults(buildSearchResults(q));
  });

  if (!searchOutsideClickWired) {
    searchOutsideClickWired = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.header-search')) {
        const resultsBox = document.getElementById('global-search-results');
        if (resultsBox) resultsBox.hidden = true;
      }
    });
  }
}

function renderActiveTab() {
  const ctx = buildCtx();
  panel.innerHTML = '';
  TABS[activeTab].render(panel, ctx);
}

function goToTab(tab) {
  activeTab = tab;
  tabsNav.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderActiveTab();
}

async function refresh() {
  await loadData();
  buildTabsNav();
  renderHeader();
  renderActiveTab();
}

const ADMIN_ONLY_TABS = ['gantt', 'members'];

function visibleTabEntries() {
  const currentMember = getCurrentMember();
  const isAdmin = Boolean(currentMember && currentMember.isAdmin);
  // スケジュール・メンバータブ(編集用)は管理者専用。他のメンバーはダッシュボードの
  // ガントチャート/カレンダー・メンバー表で閲覧する
  return Object.entries(TABS).filter(([key]) => !ADMIN_ONLY_TABS.includes(key) || isAdmin);
}

function unreadMemoCount() {
  const currentMember = getCurrentMember();
  if (!currentMember) return 0;
  return data.memos.filter((m) => !(m.readBy || []).includes(currentMember.id)).length;
}

function buildTabsNav() {
  const tabs = visibleTabEntries();
  if (!tabs.some(([key]) => key === activeTab)) {
    activeTab = 'dashboard';
  }
  const unreadMemos = unreadMemoCount();
  tabsNav.innerHTML = tabs
    .map(
      ([key, t]) =>
        `<button class="tab-btn ${key === activeTab ? 'active' : ''}" data-tab="${key}">${t.label}${
          key === 'memos' && unreadMemos > 0 ? ` <span class="tab-badge">${unreadMemos}</span>` : ''
        }</button>`
    )
    .join('');
  tabsNav.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToTab(btn.dataset.tab));
  });
}

function showIdentityModal(needsBootstrap) {
  modalLayer.innerHTML = needsBootstrap ? bootstrapFormHtml() : selectMemberFormHtml();
  wireIdentityModal(needsBootstrap);
}

function bootstrapFormHtml() {
  return `
    <div class="overlay">
      <div class="modal">
        <h3>ようこそ</h3>
        <p>最初のメンバー(あなた)を管理者として登録してください。</p>
        <form id="identity-form">
          <div class="form-group">
            <label>名前</label>
            <input type="text" name="name" required />
          </div>
          <div class="form-group">
            <label>役職</label>
            <input type="text" name="role" placeholder="例: プロジェクトマネージャー/制作進行" />
          </div>
          <div class="modal-actions">
            <span></span>
            <div><button type="submit" class="btn btn-primary">登録して開始</button></div>
          </div>
          <p class="form-error" id="identity-form-error"></p>
        </form>
      </div>
    </div>
  `;
}

function selectMemberFormHtml() {
  const options = data.members
    .map(
      (m) =>
        `<option value="${m.id}">${escapeHtml(m.name)}${m.role ? ` (${escapeHtml(m.role)})` : ''}</option>`
    )
    .join('');
  return `
    <div class="overlay">
      <div class="modal">
        <h3>あなたの名前を選択してください</h3>
        <p class="modal-hint">一度選ぶと、このブラウザ・端末ではその人として記録されます。</p>
        <form id="identity-form">
          <div class="form-group">
            <select name="memberId" required>
              <option value="">選択してください</option>
              ${options}
            </select>
          </div>
          <div class="modal-actions">
            <span></span>
            <div><button type="submit" class="btn btn-primary">開始</button></div>
          </div>
          <p class="form-error" id="identity-form-error"></p>
        </form>
      </div>
    </div>
  `;
}

function wireIdentityModal(needsBootstrap) {
  const form = document.getElementById('identity-form');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    const fd = new FormData(form);
    try {
      if (needsBootstrap) {
        await api.createMember({ name: fd.get('name'), role: fd.get('role') });
      } else {
        const id = fd.get('memberId');
        if (!id) {
          submitBtn.disabled = false;
          return;
        }
        await api.claimMember(id);
      }
      await boot();
    } catch (err) {
      // フォームはこの時点で既に別の画面に置き換わっている可能性があるため、
      // 要素が残っていれば表示し、無ければalertに逃がす(無言で固まるのを防ぐ)。
      const errorEl = document.getElementById('identity-form-error');
      if (errorEl) {
        errorEl.textContent = err.message;
      } else {
        alert(err.message);
      }
      submitBtn.disabled = false;
    }
  });
}

function showLoading() {
  tabsNav.innerHTML = '';
  headerUser.innerHTML = '';
  panel.innerHTML = '<p class="empty">読み込み中...</p>';
}

async function boot() {
  showLoading();

  let claim;
  try {
    claim = isReadonlyMode ? null : await api.getMyClaim();
    await loadData();
  } catch (err) {
    panel.innerHTML = `<p class="empty">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
    return;
  }

  currentMemberId = null;
  if (claim) {
    const member = data.members.find((m) => m.id === claim.memberId);
    if (member) {
      currentMemberId = member.id;
    } else {
      // 紐付け先のメンバーが削除されている(退会扱い)ので、選び直せるようにする
      await api.clearMyClaim().catch(() => {});
    }
  }

  // 閲覧専用モードは、名前を選ばせずcurrentMemberId=nullのまま全タブを表示する
  // (編集系のUIはcurrentMemberが無いことで自動的に非表示になる)。
  if (!isReadonlyMode && !currentMemberId) {
    tabsNav.innerHTML = '';
    headerUser.innerHTML = '';
    panel.innerHTML = '';
    showIdentityModal(data.members.length === 0);
    return;
  }

  modalLayer.innerHTML = '';
  buildTabsNav();
  renderHeader();
  renderActiveTab();
}

boot().catch((err) => {
  panel.innerHTML = `<p class="empty">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
});
