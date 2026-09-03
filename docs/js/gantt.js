import { escapeHtml, formatDate, todayIso, addDays, daysBetween, roleColor, STATUS_CLASS } from './utils.js';
import { exportGanttToExcel, exportScheduleToIcs } from './export.js';
import { openTaskModal } from './tasks.js';

const DAY_WIDTH = 28;
const LABEL_WIDTH = 220;
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

let viewMode = 'gantt';
let calendarMonth = todayIso().slice(0, 7);

function isValidIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function renderGantt(container, ctx) {
  const { tasks, milestones, isAdmin } = ctx;
  const categories = [...new Set(tasks.map((t) => t.category))].sort();

  container.innerHTML = `
    <datalist id="category-list">
      ${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
    </datalist>
    <div class="toolbar">
      <div class="gantt-legend">
        <span><i class="dot status-todo"></i>未着手</span>
        <span><i class="dot status-doing"></i>進行中</span>
        <span><i class="dot status-done"></i>完了</span>
        <span><i class="dot today-dot"></i>本日</span>
        <span><i class="dot milestone-dot"></i>マイルストーン</span>
      </div>
      <div>
        ${isAdmin ? '<button class="btn btn-primary" id="add-task-inline-btn">+ 新規タスク</button>' : ''}
        <button class="btn btn-small${viewMode === 'gantt' ? ' btn-primary' : ''}" id="view-gantt-btn">ガント</button>
        <button class="btn btn-small${viewMode === 'calendar' ? ' btn-primary' : ''}" id="view-calendar-btn">カレンダー</button>
        <button class="btn" id="export-excel-btn">Excel出力</button>
        <button class="btn" id="export-ics-btn">カレンダー出力(.ics)</button>
      </div>
    </div>
    ${isAdmin ? renderMilestoneAdmin(milestones) : ''}
    <div id="gantt-chart-area"></div>
    <div class="modal-root" id="task-modal-root"></div>
  `;

  const addTaskBtn = container.querySelector('#add-task-inline-btn');
  if (addTaskBtn) addTaskBtn.addEventListener('click', () => openTaskModal(container, ctx, null));

  container.querySelector('#view-gantt-btn').addEventListener('click', () => {
    viewMode = 'gantt';
    renderGantt(container, ctx);
  });
  container.querySelector('#view-calendar-btn').addEventListener('click', () => {
    viewMode = 'calendar';
    renderGantt(container, ctx);
  });

  container.querySelector('#export-excel-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '出力中...';
    try {
      await exportGanttToExcel(tasks, milestones);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  container.querySelector('#export-ics-btn').addEventListener('click', () => {
    try {
      exportScheduleToIcs(tasks, milestones);
    } catch (err) {
      alert(err.message);
    }
  });

  if (isAdmin) wireMilestoneAdmin(container, ctx);

  const area = container.querySelector('#gantt-chart-area');

  if (viewMode === 'calendar') {
    area.innerHTML = buildCalendarHtml(tasks, milestones, calendarMonth, { allowCreate: isAdmin });
    wireCalendarNav(container, ctx);
    return;
  }

  if (tasks.length === 0 && milestones.length === 0) {
    area.innerHTML = '<p class="empty">タスクまたはマイルストーンを登録するとガントチャートが表示されます</p>';
    return;
  }

  area.appendChild(buildGanttChart(tasks, milestones));
}

export function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildCalendarHtml(tasks, milestones, monthStr, { allowCreate = false } = {}) {
  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthNumStr);

  const firstWeekday = new Date(`${monthStr}-01T00:00:00`).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const tasksByDate = {};
  for (const t of tasks) {
    if (!isValidIsoDate(t.endDate)) continue;
    (tasksByDate[t.endDate] = tasksByDate[t.endDate] || []).push(t);
  }
  const milestonesByDate = {};
  for (const ms of milestones) {
    if (!isValidIsoDate(ms.date)) continue;
    (milestonesByDate[ms.date] = milestonesByDate[ms.date] || []).push(ms);
  }

  const today = todayIso();
  let cellsHtml = '';
  for (let i = 0; i < firstWeekday; i++) {
    cellsHtml += '<div class="calendar-cell calendar-cell-empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateIso = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayTasks = tasksByDate[dateIso] || [];
    const dayMilestones = milestonesByDate[dateIso] || [];
    cellsHtml += `<div class="calendar-cell${dateIso === today ? ' calendar-cell-today' : ''}">
      <div class="calendar-date-row">
        <span class="calendar-date">${d}</span>
        ${allowCreate ? `<button type="button" class="calendar-add-btn" data-add-date="${dateIso}" title="この日に新規タスクを追加">+</button>` : ''}
      </div>
      ${dayMilestones.map((ms) => `<div class="calendar-milestone" title="${escapeHtml(ms.title)}">${escapeHtml(ms.title)}</div>`).join('')}
      ${dayTasks.map((t) => `<div class="calendar-task ${STATUS_CLASS[t.status]}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>`).join('')}
    </div>`;
  }
  const trailing = (7 - ((firstWeekday + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    cellsHtml += '<div class="calendar-cell calendar-cell-empty"></div>';
  }

  return `
    <div class="calendar-header">
      <button class="btn btn-small" id="calendar-prev">← 前月</button>
      <div class="calendar-title">${year}年${month}月</div>
      <button class="btn btn-small" id="calendar-next">次月 →</button>
    </div>
    <div class="calendar-grid">
      ${WEEKDAY_LABELS.map((w) => `<div class="calendar-weekday">${w}</div>`).join('')}
      ${cellsHtml}
    </div>
  `;
}

function wireCalendarNav(container, ctx) {
  container.querySelector('#calendar-prev').addEventListener('click', () => {
    calendarMonth = shiftMonth(calendarMonth, -1);
    renderGantt(container, ctx);
  });
  container.querySelector('#calendar-next').addEventListener('click', () => {
    calendarMonth = shiftMonth(calendarMonth, 1);
    renderGantt(container, ctx);
  });
  container.querySelectorAll('[data-add-date]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.addDate;
      openTaskModal(container, ctx, null, { startDate: date, endDate: date });
    });
  });
}

export function buildGanttChart(tasks, milestones) {
  const allDates = [
    ...tasks.flatMap((t) => [t.startDate, t.endDate]),
    ...milestones.map((m) => m.date),
    todayIso(),
  ].filter(isValidIsoDate);
  const minDate = allDates.reduce((a, b) => (a < b ? a : b));
  const maxDate = allDates.reduce((a, b) => (a > b ? a : b));
  const rangeStart = addDays(minDate, -3);
  const rangeEnd = addDays(maxDate, 3);
  const totalDays = daysBetween(rangeStart, rangeEnd) + 1;
  const trackWidth = totalDays * DAY_WIDTH;

  const categories = [...new Set(tasks.map((t) => t.category))];
  const weekendBg = buildWeekendGradient(rangeStart, totalDays);

  const scroll = document.createElement('div');
  scroll.className = 'gantt-scroll';

  const inner = document.createElement('div');
  inner.className = 'gantt-inner';
  inner.style.width = `${LABEL_WIDTH + trackWidth}px`;
  scroll.appendChild(inner);

  // header row
  inner.appendChild(
    buildRow(
      `<div class="gantt-label-cell gantt-corner">タスク / 担当</div>`,
      buildHeaderTrack(rangeStart, totalDays),
      trackWidth,
      'gantt-header-row'
    )
  );

  for (const category of categories) {
    inner.appendChild(
      buildRow(
        `<div class="gantt-label-cell category-label">${escapeHtml(category)}</div>`,
        `<div class="gantt-row-track" style="width:${trackWidth}px;background-image:${weekendBg}"></div>`,
        trackWidth,
        'gantt-category-row'
      )
    );

    const catTasks = tasks
      .filter((t) => t.category === category && isValidIsoDate(t.startDate) && isValidIsoDate(t.endDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    for (const task of catTasks) {
      const startOffset = daysBetween(rangeStart, task.startDate);
      const duration = daysBetween(task.startDate, task.endDate) + 1;
      const barLeft = startOffset * DAY_WIDTH;
      const barWidth = Math.max(duration * DAY_WIDTH - 4, 6);

      const depNames = (task.dependsOn || [])
        .map((depId) => tasks.find((t) => t.id === depId))
        .filter(Boolean)
        .map((dep) => escapeHtml(dep.title));

      const label = `<div class="gantt-label-cell">
        <div class="gantt-task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
        <div class="gantt-task-assignee">${
          task.assigneeRole
            ? `<span class="badge" style="background:${roleColor(task.assigneeRole)}">${escapeHtml(task.assigneeRole)}</span>`
            : '未割当'
        }</div>
        ${depNames.length > 0 ? `<div class="gantt-task-assignee">依存: ${depNames.join('、')}</div>` : ''}
      </div>`;

      const bar = `<div class="gantt-row-track" style="width:${trackWidth}px;background-image:${weekendBg}">
        <div class="gantt-bar ${STATUS_CLASS[task.status]}" style="left:${barLeft}px;width:${barWidth}px"
             title="${escapeHtml(task.title)} (${formatDate(task.startDate)}〜${formatDate(task.endDate)}, ${task.progress}%)">
          <div class="gantt-bar-fill" style="width:${task.progress}%"></div>
        </div>
      </div>`;

      inner.appendChild(buildRow(label, bar, trackWidth, 'gantt-task-row'));
    }
  }

  if (categories.length === 0) {
    inner.appendChild(
      buildRow(
        '<div class="gantt-label-cell category-label">タスク未登録</div>',
        `<div class="gantt-row-track" style="width:${trackWidth}px;background-image:${weekendBg}"></div>`,
        trackWidth,
        'gantt-category-row'
      )
    );
  }

  // overlay: today line + milestones
  const overlay = document.createElement('div');
  overlay.className = 'gantt-overlay';

  const todayOffset = LABEL_WIDTH + daysBetween(rangeStart, todayIso()) * DAY_WIDTH + DAY_WIDTH / 2;
  overlay.appendChild(el(`<div class="gantt-today-line" style="left:${todayOffset}px"></div>`));

  for (const ms of milestones) {
    if (!isValidIsoDate(ms.date) || ms.date < rangeStart || ms.date > rangeEnd) continue;
    const offset = LABEL_WIDTH + daysBetween(rangeStart, ms.date) * DAY_WIDTH + DAY_WIDTH / 2;
    overlay.appendChild(
      el(`<div class="gantt-milestone-line" style="left:${offset}px" title="${escapeHtml(ms.title)} (${formatDate(ms.date)})">
            <span class="gantt-milestone-label">${escapeHtml(ms.title)}</span>
          </div>`)
    );
  }

  inner.appendChild(overlay);

  return scroll;
}

function buildRow(labelHtml, trackHtml, trackWidth, extraClass) {
  const row = document.createElement('div');
  row.className = `gantt-row ${extraClass}`;
  row.innerHTML = `${labelHtml}${trackHtml}`;
  return row;
}

function buildHeaderTrack(rangeStart, totalDays) {
  let cells = '';
  for (let i = 0; i < totalDays; i++) {
    const date = addDays(rangeStart, i);
    const d = new Date(date);
    const weekday = d.getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const isMonthStart = d.getDate() === 1;
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    cells += `<div class="gantt-day-cell${isWeekend ? ' weekend' : ''}${isMonthStart ? ' month-start' : ''}"
                    style="width:${DAY_WIDTH}px" ${isMonthStart ? `data-month-label="${d.getMonth() + 1}月"` : ''}>${label}</div>`;
  }
  return `<div class="gantt-header-track" style="width:${totalDays * DAY_WIDTH}px">${cells}</div>`;
}

function buildWeekendGradient(rangeStart, totalDays) {
  const sun = 'color-mix(in srgb, var(--danger) 10%, transparent)';
  const sat = 'color-mix(in srgb, var(--doing) 10%, transparent)';
  const stops = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(addDays(rangeStart, i));
    const weekday = d.getDay();
    if (weekday !== 0 && weekday !== 6) continue;
    const color = weekday === 0 ? sun : sat;
    const start = i * DAY_WIDTH;
    const end = start + DAY_WIDTH;
    stops.push(`transparent ${start}px`, `${color} ${start}px`, `${color} ${end}px`, `transparent ${end}px`);
  }
  if (stops.length === 0) return 'none';
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function renderMilestoneAdmin(milestones) {
  return `
    <details class="milestone-admin">
      <summary>マイルストーンを管理 (${milestones.length}件)</summary>
      <div class="milestone-admin-body">
        <form id="milestone-form" class="inline-form">
          <input type="text" name="title" placeholder="例: 中間発表" required />
          <input type="date" name="date" required />
          <button type="submit" class="btn btn-small btn-primary">追加</button>
        </form>
        <ul class="milestone-manage-list">
          ${milestones
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(
              (ms) => `<li>
                <span>${formatDate(ms.date)} - ${escapeHtml(ms.title)}</span>
                <button class="btn btn-small btn-danger" data-delete-ms="${ms.id}">削除</button>
              </li>`
            )
            .join('')}
        </ul>
      </div>
    </details>
  `;
}

function wireMilestoneAdmin(container, ctx) {
  const form = container.querySelector('#milestone-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      try {
        await ctx.api.createMilestone({ title: data.get('title'), date: data.get('date') });
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  container.querySelectorAll('[data-delete-ms]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('このマイルストーンを削除しますか?')) return;
      try {
        await ctx.api.deleteMilestone(btn.dataset.deleteMs);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}
