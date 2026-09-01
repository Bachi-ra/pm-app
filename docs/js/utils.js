export const STATUS_LIST = ['未着手', '進行中', '完了'];

export const STATUS_CLASS = {
  未着手: 'status-todo',
  進行中: 'status-doing',
  完了: 'status-done',
};

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

export function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function todayIso() {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now - tz).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
}

export function addDays(isoDate, n) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export const EVERYONE_ROLE = '全員';

export function getRoleOptions(members) {
  const roles = [...new Set(members.map((m) => (m.role || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ja')
  );
  return [EVERYONE_ROLE, ...roles];
}

const FIXED_ROLE_COLORS = {
  モデラー: '#dc2626',
  アニメーター: '#2563eb',
  エフェクト: '#ca8a04',
  コンポジット: '#16a34a',
  なんでも: '#6b7280',
  プロジェクトマネージャー: '#8b5cf6',
};

export function roleColor(role) {
  const str = (role || '').trim();
  if (!str) return '#9ca3af';
  if (FIXED_ROLE_COLORS[str]) return FIXED_ROLE_COLORS[str];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 40%)`;
}

export const PRIORITY_LIST = ['高', '中', '低'];

const PRIORITY_COLORS = { 高: '#dc2626', 中: '#ca8a04', 低: '#9ca3af' };

export function priorityColor(priority) {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS['中'];
}

const PRIORITY_ORDER = { 高: 0, 中: 1, 低: 2 };

export function priorityRank(priority) {
  return PRIORITY_ORDER[priority] ?? 1;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
