import { escapeHtml, formatDate, memberName, STATUS_LIST, STATUS_CLASS } from './utils.js';

const filterState = { assignee: 'all', category: 'all', status: 'all' };

export function renderTasks(container, ctx) {
  const { members, tasks, currentMember, isAdmin } = ctx;
  const categories = [...new Set(tasks.map((t) => t.category))].sort();

  const filtered = tasks.filter((t) => {
    if (filterState.assignee !== 'all' && t.assigneeId !== filterState.assignee) return false;
    if (filterState.category !== 'all' && t.category !== filterState.category) return false;
    if (filterState.status !== 'all' && t.status !== filterState.status) return false;
    return true;
  });

  container.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="filter-assignee">
          <option value="all">担当者: すべて</option>
          ${members.map((m) => `<option value="${m.id}" ${filterState.assignee === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
        </select>
        <select id="filter-category">
          <option value="all">カテゴリ: すべて</option>
          ${categories.map((c) => `<option value="${escapeHtml(c)}" ${filterState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <select id="filter-status">
          <option value="all">状態: すべて</option>
          ${STATUS_LIST.map((s) => `<option value="${s}" ${filterState.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      ${isAdmin ? '<button class="btn btn-primary" id="add-task-btn">+ 新規タスク</button>' : ''}
    </div>

    <datalist id="category-list">
      ${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
    </datalist>

    ${
      filtered.length === 0
        ? '<p class="empty">条件に合うタスクがありません</p>'
        : `<div class="table-scroll"><table class="data-table">
            <thead><tr>
              <th>タイトル</th><th>カテゴリ</th><th>担当</th><th>状態</th><th>進捗</th><th>期間</th><th></th>
            </tr></thead>
            <tbody>
              ${filtered.map((t) => renderRow(t, members, currentMember, isAdmin)).join('')}
            </tbody>
          </table></div>`
    }

    <div class="modal-root" id="task-modal-root"></div>
  `;

  container.querySelector('#filter-assignee').addEventListener('change', (e) => {
    filterState.assignee = e.target.value;
    renderTasks(container, ctx);
  });
  container.querySelector('#filter-category').addEventListener('change', (e) => {
    filterState.category = e.target.value;
    renderTasks(container, ctx);
  });
  container.querySelector('#filter-status').addEventListener('change', (e) => {
    filterState.status = e.target.value;
    renderTasks(container, ctx);
  });

  const addBtn = container.querySelector('#add-task-btn');
  if (addBtn) addBtn.addEventListener('click', () => openTaskModal(container, ctx, null));

  container.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = tasks.find((t) => t.id === btn.dataset.editId);
      openTaskModal(container, ctx, task);
    });
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('このタスクを削除しますか?')) return;
      try {
        await ctx.api.deleteTask(btn.dataset.deleteId);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  container.querySelectorAll('[data-quick-save-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const status = row.querySelector('.quick-status').value;
      const progress = Number(row.querySelector('.quick-progress').value);
      try {
        await ctx.api.updateTask(btn.dataset.quickSaveId, { status, progress });
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderRow(task, members, currentMember, isAdmin) {
  const isOwner = currentMember && task.assigneeId === currentMember.id;
  const canQuickEdit = isOwner && !isAdmin;

  let actionCell;
  if (isAdmin) {
    actionCell = `
      <button class="btn btn-small" data-edit-id="${task.id}">編集</button>
      <button class="btn btn-small btn-danger" data-delete-id="${task.id}">削除</button>
    `;
  } else if (canQuickEdit) {
    actionCell = `
      <select class="quick-status">
        ${STATUS_LIST.map((s) => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <input type="number" class="quick-progress" min="0" max="100" value="${task.progress}" />
      <button class="btn btn-small btn-primary" data-quick-save-id="${task.id}">更新</button>
    `;
  } else {
    actionCell = '';
  }

  return `<tr>
    <td>
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
    </td>
    <td>${escapeHtml(task.category)}</td>
    <td>${escapeHtml(memberName(members, task.assigneeId))}</td>
    <td><span class="badge ${STATUS_CLASS[task.status]}">${task.status}</span></td>
    <td><div class="progress-bar" title="${task.progress}%"><div class="progress-fill" style="width:${task.progress}%"></div></div></td>
    <td class="nowrap">${formatDate(task.startDate)} 〜 ${formatDate(task.endDate)}</td>
    <td class="nowrap">${actionCell}</td>
  </tr>`;
}

function openTaskModal(container, ctx, task) {
  const { members } = ctx;
  const root = container.querySelector('#task-modal-root');
  const isEdit = Boolean(task);

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>${isEdit ? 'タスクを編集' : '新規タスク'}</h3>
        <form id="task-form">
          <div class="form-group">
            <label>タイトル</label>
            <input type="text" name="title" required value="${escapeHtml(task?.title || '')}" />
          </div>
          <div class="form-group">
            <label>説明</label>
            <textarea name="description" rows="2">${escapeHtml(task?.description || '')}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>カテゴリ</label>
              <input type="text" name="category" list="category-list" value="${escapeHtml(task?.category || '')}" placeholder="例: 企画" />
            </div>
            <div class="form-group">
              <label>担当者</label>
              <select name="assigneeId">
                <option value="">未割当</option>
                ${members.map((m) => `<option value="${m.id}" ${task?.assigneeId === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>開始日</label>
              <input type="date" name="startDate" required value="${task?.startDate || ''}" />
            </div>
            <div class="form-group">
              <label>終了日</label>
              <input type="date" name="endDate" required value="${task?.endDate || ''}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>状態</label>
              <select name="status">
                ${STATUS_LIST.map((s) => `<option value="${s}" ${(task?.status || '未着手') === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>進捗 (%)</label>
              <input type="number" name="progress" min="0" max="100" value="${task?.progress ?? 0}" />
            </div>
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="modal-delete">削除</button>' : '<span></span>'}
            <div>
              <button type="button" class="btn" id="modal-cancel">キャンセル</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </div>
          <p class="form-error" id="task-form-error"></p>
        </form>
      </div>
    </div>
  `;

  root.querySelector('#modal-cancel').addEventListener('click', () => {
    root.innerHTML = '';
  });

  const deleteBtn = root.querySelector('#modal-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('このタスクを削除しますか?')) return;
      try {
        await ctx.api.deleteTask(task.id);
        root.innerHTML = '';
        await ctx.refresh();
      } catch (err) {
        root.querySelector('#task-form-error').textContent = err.message;
      }
    });
  }

  root.querySelector('#task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      title: form.get('title'),
      description: form.get('description'),
      category: form.get('category'),
      assigneeId: form.get('assigneeId') || null,
      startDate: form.get('startDate'),
      endDate: form.get('endDate'),
      status: form.get('status'),
      progress: Number(form.get('progress')),
    };
    try {
      if (isEdit) {
        await ctx.api.updateTask(task.id, payload);
      } else {
        await ctx.api.createTask(payload);
      }
      root.innerHTML = '';
      await ctx.refresh();
    } catch (err) {
      root.querySelector('#task-form-error').textContent = err.message;
    }
  });
}
