import {
  escapeHtml,
  formatDate,
  todayIso,
  addDays,
  daysBetween,
  roleColor,
  priorityColor,
  priorityRank,
  EVERYONE_ROLE,
} from './utils.js';
import { buildGanttChart, buildCalendarHtml, shiftMonth } from './gantt.js';
import { exportGanttToExcel, exportScheduleToIcs } from './export.js';

let scheduleViewMode = 'gantt';
let scheduleCalendarMonth = todayIso().slice(0, 7);

function scheduleWidgetShellHtml() {
  return `
    <div class="toolbar">
      <div class="gantt-legend">
        <span><i class="dot status-todo"></i>未着手</span>
        <span><i class="dot status-doing"></i>進行中</span>
        <span><i class="dot status-done"></i>完了</span>
        <span><i class="dot today-dot"></i>本日</span>
        <span><i class="dot milestone-dot"></i>マイルストーン</span>
      </div>
      <div>
        <button class="btn btn-small${scheduleViewMode === 'gantt' ? ' btn-primary' : ''}" id="dash-view-gantt-btn">ガント</button>
        <button class="btn btn-small${scheduleViewMode === 'calendar' ? ' btn-primary' : ''}" id="dash-view-calendar-btn">カレンダー</button>
        <button class="btn" id="dash-export-excel-btn">Excel出力</button>
        <button class="btn" id="dash-export-ics-btn">カレンダー出力(.ics)</button>
      </div>
    </div>
    <div id="dash-schedule-area"></div>
  `;
}

function renderScheduleWidget(container, ctx) {
  const { tasks, milestones } = ctx;
  const area = container.querySelector('#dash-schedule-area');
  if (!area) return;
  area.innerHTML = '';

  if (scheduleViewMode === 'calendar') {
    area.innerHTML = buildCalendarHtml(tasks, milestones, scheduleCalendarMonth);
    const prevBtn = area.querySelector('#calendar-prev');
    const nextBtn = area.querySelector('#calendar-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        scheduleCalendarMonth = shiftMonth(scheduleCalendarMonth, -1);
        renderScheduleWidget(container, ctx);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        scheduleCalendarMonth = shiftMonth(scheduleCalendarMonth, 1);
        renderScheduleWidget(container, ctx);
      });
    }
    return;
  }

  if (tasks.length === 0 && milestones.length === 0) {
    area.innerHTML = '<p class="empty">タスクまたはマイルストーンを登録するとガントチャートが表示されます</p>';
    return;
  }
  area.appendChild(buildGanttChart(tasks, milestones));
}

function wireScheduleWidget(container, ctx) {
  const ganttBtn = container.querySelector('#dash-view-gantt-btn');
  const calBtn = container.querySelector('#dash-view-calendar-btn');
  ganttBtn.addEventListener('click', () => {
    scheduleViewMode = 'gantt';
    ganttBtn.classList.add('btn-primary');
    calBtn.classList.remove('btn-primary');
    renderScheduleWidget(container, ctx);
  });
  calBtn.addEventListener('click', () => {
    scheduleViewMode = 'calendar';
    calBtn.classList.add('btn-primary');
    ganttBtn.classList.remove('btn-primary');
    renderScheduleWidget(container, ctx);
  });

  container.querySelector('#dash-export-excel-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '出力中...';
    try {
      await exportGanttToExcel(ctx.tasks, ctx.milestones);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  container.querySelector('#dash-export-ics-btn').addEventListener('click', () => {
    try {
      exportScheduleToIcs(ctx.tasks, ctx.milestones);
    } catch (err) {
      alert(err.message);
    }
  });
}

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

// 既存の3日前デイリーリマインドとは別に、タスクごとに1回だけ
// 「締切まで1週間を切った」通知を送る。
async function maybeSendWeekBeforeDiscordNotification(ctx, targets, today) {
  const webhookUrl = ctx.notificationSettings?.discordWebhookUrl;
  if (!webhookUrl || targets.length === 0) return;

  for (const task of targets) {
    try {
      const claimed = await ctx.api.claimTaskWeekBeforeNotification(task.id);
      if (!claimed) continue;

      const daysLeft = daysBetween(today, task.endDate);
      const content = `【1週間前通知】${task.title} の締切まであと${daysLeft}日です`;

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      // 通知に失敗しても画面表示には影響させない
    }
  }
}

function buildBurndownSvg(snapshots, milestones) {
  if (snapshots.length < 2) {
    return '<p class="empty">データが2日分たまるとグラフが表示されます(今日から記録を開始しています)</p>';
  }

  const width = 640;
  const height = 200;
  const padding = { top: 16, right: 16, bottom: 20, left: 28 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const minDate = snapshots[0].date;
  const maxDate = snapshots[snapshots.length - 1].date;
  const totalDays = Math.max(daysBetween(minDate, maxDate), 1);
  const maxRemaining = Math.max(...snapshots.map((s) => s.remainingCount), 1);

  const xFor = (date) => padding.left + (daysBetween(minDate, date) / totalDays) * plotW;
  const yFor = (count) => padding.top + plotH - (count / maxRemaining) * plotH;

  const points = snapshots.map((s) => `${xFor(s.date).toFixed(1)},${yFor(s.remainingCount).toFixed(1)}`).join(' ');
  const dots = snapshots
    .map(
      (s) =>
        `<circle cx="${xFor(s.date).toFixed(1)}" cy="${yFor(s.remainingCount).toFixed(1)}" r="2.5" fill="#3b5bc4"><title>${escapeHtml(formatDate(s.date))}: 残り${s.remainingCount}件</title></circle>`
    )
    .join('');

  const milestoneLines = milestones
    .filter((ms) => ms.date >= minDate && ms.date <= maxDate)
    .map((ms) => {
      const x = xFor(ms.date).toFixed(1);
      return `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + plotH}" stroke="#7c3aed" stroke-dasharray="4 3" stroke-width="1" />
        <text x="${Number(x) + 3}" y="${padding.top + 10}" font-size="9" fill="#7c3aed">${escapeHtml(ms.title)}</text>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="burndown-svg" role="img" aria-label="残タスク数の推移">
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotH}" stroke="#e5e7eb" stroke-width="1" />
      <line x1="${padding.left}" y1="${padding.top + plotH}" x2="${padding.left + plotW}" y2="${padding.top + plotH}" stroke="#e5e7eb" stroke-width="1" />
      ${milestoneLines}
      <polyline points="${points}" fill="none" stroke="#3b5bc4" stroke-width="2" />
      ${dots}
      <text x="2" y="${padding.top + 4}" font-size="9" fill="#6b7280">${maxRemaining}</text>
      <text x="2" y="${padding.top + plotH}" font-size="9" fill="#6b7280">0</text>
    </svg>
  `;
}

async function loadAndRenderBurndown(container, ctx) {
  const area = container.querySelector('#burndown-area');
  if (!area) return;
  try {
    const { tasks, milestones } = ctx;
    const today = todayIso();
    const remainingCount = tasks.filter((t) => t.status !== '完了').length;
    const totalCount = tasks.length;
    const avgProgress = totalCount ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / totalCount) : 0;

    await ctx.api.upsertProgressSnapshot({ date: today, remainingCount, totalCount, avgProgress });
    const snapshots = await ctx.api.getProgressSnapshots();
    const sorted = snapshots.slice().sort((a, b) => a.date.localeCompare(b.date));
    area.innerHTML = buildBurndownSvg(sorted, milestones);
  } catch (err) {
    area.innerHTML = `<p class="empty">グラフの読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
  }
}

export function renderDashboard(container, ctx) {
  const { members, tasks, milestones, renderJobs, currentMember, goToTab } = ctx;
  const activeRenderJobCount = renderJobs.filter((j) => j.status === '実行中').length;

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
  maybeSendWeekBeforeDiscordNotification(
    ctx,
    upcomingTasks.filter((t) => !t.discordNotifiedWeekBefore),
    today
  );

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
      <div class="card stat-card" data-tab="renderQueue">
        <div class="stat-value">${activeRenderJobCount}</div>
        <div class="stat-label">レンダー中</div>
      </div>
    </div>

    <div class="card">
      <h3>スケジュール</h3>
      ${scheduleWidgetShellHtml()}
    </div>

    <div class="card">
      <h3>残タスク数の推移</h3>
      <div id="burndown-area"><p class="empty">読み込み中...</p></div>
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
      <h3>メンバー</h3>
      ${
        members.length === 0
          ? '<p class="empty">メンバーが登録されていません</p>'
          : `<div class="table-scroll"><table class="data-table">
              <thead><tr><th>名前</th><th>役職</th><th>権限</th></tr></thead>
              <tbody>
                ${members
                  .map(
                    (m) => `<tr>
                      <td>${escapeHtml(m.name)}${m.id === currentMember?.id ? ' <span class="you-tag">(あなた)</span>' : ''}</td>
                      <td>${m.role ? `<span class="badge" style="background:${roleColor(m.role)}">${escapeHtml(m.role)}</span>` : '-'}</td>
                      <td>${m.isAdmin ? '<span class="badge status-doing">管理者</span>' : 'メンバー'}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table></div>`
      }
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

  wireScheduleWidget(container, ctx);
  renderScheduleWidget(container, ctx);
  loadAndRenderBurndown(container, ctx);
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
