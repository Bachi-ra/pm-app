import { escapeHtml, formatDate, todayIso, addDays, roleColor, priorityColor, priorityRank, EVERYONE_ROLE } from './utils.js';

function isAssignedToMember(task, member) {
  const role = (member.role || '').trim();
  return Boolean(task.assigneeRole && (task.assigneeRole === EVERYONE_ROLE || (role && task.assigneeRole === role)));
}

function roleBadge(role) {
  return role ? `<span class="badge" style="background:${roleColor(role)}">${escapeHtml(role)}</span>` : '未割当';
}

function priorityBadge(priority) {
  return `<span class="badge" style="background:${priorityColor(priority)}">${escapeHtml(priority || '中')}</span>`;
}

const BROWSER_NOTIFY_KEY = 'pmapp_last_browser_notify_date';

function maybeSendBrowserNotification(urgentTasks, today) {
  if (urgentTasks.length === 0) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  let lastDate = null;
  try {
    lastDate = localStorage.getItem(BROWSER_NOTIFY_KEY);
  } catch (err) {
    return;
  }
  if (lastDate === today) return;

  try {
    new Notification('締切が近いタスクがあります', {
      body: `3日以内に締切のタスクが${urgentTasks.length}件あります`,
    });
    localStorage.setItem(BROWSER_NOTIFY_KEY, today);
  } catch (err) {
    // 通知に失敗しても画面表示には影響させない
  }
}

async function maybeSendDiscordNotification(ctx, urgentTasks, today) {
  if (urgentTasks.length === 0) return;
  const webhookUrl = ctx.notificationSettings?.discordWebhookUrl;
  if (!webhookUrl) return;

  try {
    const claimed = await ctx.api.claimDailyDiscordNotification(today);
    if (!claimed) return;

    const lines = urgentTasks.slice(0, 10).map((t) => `・${t.title}(締切: ${formatDate(t.endDate)})`);
    const content = `【締切リマインド】3日以内に締切の未完了タスクが${urgentTasks.length}件あります\n${lines.join('\n')}`;

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    // 通知に失敗しても画面表示には影響させない
  }
}

export function renderDashboard(container, ctx) {
  const { members, tasks, milestones, goToTab } = ctx;

  const counts = { 未着手: 0, 進行中: 0, 完了: 0 };
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  const total = tasks.length;

  const today = todayIso();
  const soon = addDays(today, 7);
  const upcomingTasks = tasks
    .filter((t) => t.status !== '完了' && t.endDate >= today && t.endDate <= soon)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.endDate.localeCompare(b.endDate));

  const overdueTasks = tasks.filter((t) => t.status !== '完了' && t.endDate < today);

  const urgentTasks = tasks.filter((t) => t.status !== '完了' && t.endDate && t.endDate <= addDays(today, 3));
  maybeSendBrowserNotification(urgentTasks, today);
  maybeSendDiscordNotification(ctx, urgentTasks, today);

  const workload = members.map((m) => {
    const mine = tasks.filter((t) => isAssignedToMember(t, m));
    const done = mine.filter((t) => t.status === '完了').length;
    const avg = mine.length
      ? Math.round(mine.reduce((sum, t) => sum + t.progress, 0) / mine.length)
      : 0;
    return { member: m, count: mine.length, done, avg };
  });

  const upcomingMilestones = milestones
    .filter((ms) => ms.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const showNotifyBanner = 'Notification' in window && Notification.permission === 'default';

  container.innerHTML = `
    ${
      showNotifyBanner
        ? `<div class="card">
            <div class="toolbar">
              <span>締切が近いタスクをブラウザ通知でお知らせできます。</span>
              <button class="btn btn-small btn-primary" id="enable-notify-btn">通知を有効にする</button>
            </div>
          </div>`
        : ''
    }
    <div class="dashboard-grid">
      <div class="card stat-card" data-tab="tasks">
        <div class="stat-value">${total}</div>
        <div class="stat-label">総タスク数</div>
      </div>
      <div class="card stat-card" data-tab="tasks">
        <div class="stat-value">${counts['未着手']}</div>
        <div class="stat-label">未着手</div>
      </div>
      <div class="card stat-card" data-tab="tasks">
        <div class="stat-value">${counts['進行中']}</div>
        <div class="stat-label">進行中</div>
      </div>
      <div class="card stat-card" data-tab="tasks">
        <div class="stat-value">${counts['完了']}</div>
        <div class="stat-label">完了</div>
      </div>
    </div>

    <div class="dashboard-cols">
      <div class="card">
        <h3>直近7日以内の締切 ${overdueTasks.length ? `<span class="badge status-todo">期限超過 ${overdueTasks.length}件あり</span>` : ''}</h3>
        ${
          overdueTasks.length === 0 && upcomingTasks.length === 0
            ? '<p class="empty">直近の締切タスクはありません</p>'
            : ''
        }
        ${overdueTasks.length > 0 ? renderTaskMiniList(overdueTasks, true) : ''}
        ${upcomingTasks.length > 0 ? renderTaskMiniList(upcomingTasks, false) : ''}
      </div>

      <div class="card">
        <h3>直近のマイルストーン</h3>
        ${
          upcomingMilestones.length === 0
            ? '<p class="empty">登録済みのマイルストーンはありません</p>'
            : `<ul class="milestone-list">${upcomingMilestones
                .map((ms) => `<li><strong>${formatDate(ms.date)}</strong> ${escapeHtml(ms.title)}</li>`)
                .join('')}</ul>`
        }
      </div>
    </div>

    <div class="card">
      <h3>メンバー別 進捗サマリ</h3>
      ${
        workload.length === 0
          ? '<p class="empty">メンバーが登録されていません</p>'
          : `<div class="table-scroll"><table class="data-table">
              <thead><tr><th>メンバー</th><th>役職</th><th>担当タスク数</th><th>完了数</th><th>平均進捗</th></tr></thead>
              <tbody>
                ${workload
                  .map(
                    (w) => `<tr>
                      <td>${escapeHtml(w.member.name)}</td>
                      <td>${w.member.role ? `<span class="badge" style="background:${roleColor(w.member.role)}">${escapeHtml(w.member.role)}</span>` : '-'}</td>
                      <td>${w.count}</td>
                      <td>${w.done}</td>
                      <td>${renderMiniProgress(w.avg)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table></div>`
      }
    </div>
  `;

  container.querySelectorAll('[data-tab]').forEach((node) => {
    node.addEventListener('click', () => goToTab(node.dataset.tab));
  });

  const enableNotifyBtn = container.querySelector('#enable-notify-btn');
  if (enableNotifyBtn) {
    enableNotifyBtn.addEventListener('click', async () => {
      await Notification.requestPermission();
      renderDashboard(container, ctx);
    });
  }
}

function renderTaskMiniList(list, overdue) {
  return `<ul class="task-mini-list">
    ${list
      .map(
        (t) => `<li class="${overdue ? 'overdue' : ''}">
          <span class="task-mini-title">${escapeHtml(t.title)}</span>
          <span class="task-mini-meta">${priorityBadge(t.priority)} ${roleBadge(t.assigneeRole)} / 期限 ${formatDate(t.endDate)}</span>
        </li>`
      )
      .join('')}
  </ul>`;
}

function renderMiniProgress(pct) {
  return `<div class="progress-bar" title="${pct}%"><div class="progress-fill" style="width:${pct}%"></div></div>`;
}
