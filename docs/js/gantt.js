import { escapeHtml, formatDate, todayIso, addDays, daysBetween, roleColor, STATUS_CLASS } from './utils.js';

const DAY_WIDTH = 28;
const LABEL_WIDTH = 220;

export function renderGantt(container, ctx) {
  const { tasks, milestones, isAdmin } = ctx;

  container.innerHTML = `
    <div class="gantt-legend">
      <span><i class="dot status-todo"></i>未着手</span>
      <span><i class="dot status-doing"></i>進行中</span>
      <span><i class="dot status-done"></i>完了</span>
      <span><i class="dot today-dot"></i>本日</span>
      <span><i class="dot milestone-dot"></i>マイルストーン</span>
    </div>
    ${isAdmin ? renderMilestoneAdmin(milestones) : ''}
    <div id="gantt-chart-area"></div>
  `;

  if (isAdmin) wireMilestoneAdmin(container, ctx);

  const area = container.querySelector('#gantt-chart-area');
  if (tasks.length === 0 && milestones.length === 0) {
    area.innerHTML = '<p class="empty">タスクまたはマイルストーンを登録するとガントチャートが表示されます</p>';
    return;
  }

  area.appendChild(buildGanttChart(tasks, milestones));
}

function buildGanttChart(tasks, milestones) {
  const allDates = [
    ...tasks.flatMap((t) => [t.startDate, t.endDate]),
    ...milestones.map((m) => m.date),
    todayIso(),
  ];
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
      .filter((t) => t.category === category)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    for (const task of catTasks) {
      const startOffset = daysBetween(rangeStart, task.startDate);
      const duration = daysBetween(task.startDate, task.endDate) + 1;
      const barLeft = startOffset * DAY_WIDTH;
      const barWidth = Math.max(duration * DAY_WIDTH - 4, 6);

      const label = `<div class="gantt-label-cell">
        <div class="gantt-task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
        <div class="gantt-task-assignee">${
          task.assigneeRole
            ? `<span class="badge" style="background:${roleColor(task.assigneeRole)}">${escapeHtml(task.assigneeRole)}</span>`
            : '未割当'
        }</div>
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
    if (ms.date < rangeStart || ms.date > rangeEnd) continue;
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
  const sun = 'rgba(220,38,38,0.08)';
  const sat = 'rgba(37,99,235,0.08)';
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
