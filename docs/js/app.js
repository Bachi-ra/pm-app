import { api } from './api.js';
import { getCurrentMemberId, setCurrentMemberId } from './state.js';
import { renderDashboard } from './dashboard.js';
import { renderTasks } from './tasks.js';
import { renderGantt } from './gantt.js';
import { renderMembers } from './members.js';
import { renderMemos } from './memos.js';
import { renderLinks } from './links.js';
import { escapeHtml } from './utils.js';

const TABS = {
  dashboard: { label: 'ダッシュボード', render: renderDashboard },
  tasks: { label: 'タスク一覧', render: renderTasks },
  gantt: { label: 'スケジュール', render: renderGantt },
  members: { label: 'メンバー', render: renderMembers },
  memos: { label: 'メモ', render: renderMemos },
  links: { label: 'リンク集', render: renderLinks },
};

let data = { members: [], tasks: [], milestones: [], memos: [], links: [] };
let activeTab = 'dashboard';

const panel = document.getElementById('panel');
const tabsNav = document.getElementById('tabs');
const headerUser = document.getElementById('header-user');
const modalLayer = document.getElementById('modal-layer');

function getCurrentMember() {
  const id = getCurrentMemberId();
  return data.members.find((m) => m.id === id) || null;
}

async function loadData() {
  const [members, tasks, milestones, memos, links] = await Promise.all([
    api.getMembers(),
    api.getTasks(),
    api.getMilestones(),
    api.getMemos(),
    api.getLinks(),
  ]);
  data = { members, tasks, milestones, memos, links };
}

function buildCtx() {
  const currentMember = getCurrentMember();
  return {
    ...data,
    currentMember,
    isAdmin: Boolean(currentMember && currentMember.isAdmin),
    api,
    refresh,
    goToTab,
  };
}

function renderHeader() {
  const currentMember = getCurrentMember();
  if (!currentMember) {
    headerUser.innerHTML = '';
    return;
  }
  headerUser.innerHTML = `
    <span class="header-user-name">${escapeHtml(currentMember.name)}${
    currentMember.isAdmin ? ' <span class="badge status-doing">管理者</span>' : ''
  }</span>
    <button class="btn btn-small" id="switch-user-btn">ユーザー切替</button>
  `;
  document.getElementById('switch-user-btn').addEventListener('click', () => {
    setCurrentMemberId(null);
    boot();
  });
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
  renderHeader();
  renderActiveTab();
}

function buildTabsNav() {
  tabsNav.innerHTML = Object.entries(TABS)
    .map(
      ([key, t]) =>
        `<button class="tab-btn ${key === activeTab ? 'active' : ''}" data-tab="${key}">${t.label}</button>`
    )
    .join('');
  tabsNav.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToTab(btn.dataset.tab));
  });
}

function showIdentityModal() {
  const needsBootstrap = data.members.length === 0;
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      if (needsBootstrap) {
        const member = await api.createMember({ name: fd.get('name'), role: fd.get('role') });
        setCurrentMemberId(member.id);
      } else {
        const id = fd.get('memberId');
        if (!id) return;
        setCurrentMemberId(id);
      }
      modalLayer.innerHTML = '';
      await boot();
    } catch (err) {
      document.getElementById('identity-form-error').textContent = err.message;
    }
  });
}

async function boot() {
  await loadData();
  const currentMember = getCurrentMember();
  if (!currentMember) {
    tabsNav.innerHTML = '';
    headerUser.innerHTML = '';
    panel.innerHTML = '';
    showIdentityModal();
    return;
  }
  buildTabsNav();
  renderHeader();
  renderActiveTab();
}

boot().catch((err) => {
  panel.innerHTML = `<p class="empty">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
});
