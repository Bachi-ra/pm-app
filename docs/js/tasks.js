import { escapeHtml, formatDate, getRoleOptions, roleColor, EVERYONE_ROLE, STATUS_LIST, STATUS_CLASS } from './utils.js';

function roleBadge(role) {
  return role ? `<span class="badge" style="background:${roleColor(role)}">${escapeHtml(role)}</span>` : '未割当';
}

const filterState = { assigneeRole: 'all', category: 'all', status: 'all' };

export function renderTasks(container, ctx) {
  const { members, tasks, currentMember, isAdmin } = ctx;
  const categories = [...new Set(tasks.map((t) => t.category))].sort();
  const roleOptions = getRoleOptions(members);

  const filtered = tasks.filter((t) => {
    if (filterState.assigneeRole !== 'all' && t.assigneeRole !== filterState.assigneeRole) return false;
    if (filterState.category !== 'all' && t.category !== filterState.category) return false;
    if (filterState.status !== 'all' && t.status !== filterState.status) return false;
    return true;
  });

  container.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="filter-assignee">
          <option value="all">担当役職: すべて</option>
          ${roleOptions.map((r) => `<option value="${escapeHtml(r)}" ${filterState.assigneeRole === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
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
              <th>タイトル</th><th>カテゴリ</th><th>担当役職</th><th>状態</th><th>進捗</th><th>期間</th><th></th>
            </tr></thead>
            <tbody>
              ${filtered.map((t) => renderRow(t, currentMember, isAdmin)).join('')}
            </tbody>
          </table></div>`
    }

    <div class="modal-root" id="task-modal-root"></div>
  `;

  container.querySelector('#filter-assignee').addEventListener('change', (e) => {
    filterState.assigneeRole = e.target.value;
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

function renderRow(task, currentMember, isAdmin) {
  const myRole = currentMember ? (currentMember.role || '').trim() : '';
  const isOwner = Boolean(
    task.assigneeRole && myRole && (task.assigneeRole === EVERYONE_ROLE || task.assigneeRole === myRole)
  );
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

  const checklist = task.checklist || [];
  const checklistDone = checklist.filter((item) => item.done).length;

  return `<tr>
    <td>
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
      ${checklist.length > 0 ? `<div class="task-desc">チェックリスト ${checklistDone}/${checklist.length} 完了</div>` : ''}
    </td>
    <td>${escapeHtml(task.category)}</td>
    <td>${roleBadge(task.assigneeRole)}</td>
    <td><span class="badge ${STATUS_CLASS[task.status]}">${task.status}</span></td>
    <td><div class="progress-bar" title="${task.progress}%"><div class="progress-fill" style="width:${task.progress}%"></div></div></td>
    <td class="nowrap">${formatDate(task.startDate)} 〜 ${formatDate(task.endDate)}</td>
    <td class="nowrap">${actionCell}</td>
  </tr>`;
}

function genClientId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function renderChecklistEditor(checklist) {
  return `
    ${
      checklist.length === 0
        ? '<p class="empty">項目がありません</p>'
        : `<ul class="milestone-manage-list">
            ${checklist
              .map(
                (item, i) => `<li>
                  <div class="form-checkbox">
                    <label><input type="checkbox" data-checklist-toggle="${i}" ${item.done ? 'checked' : ''} /> ${escapeHtml(item.text)}</label>
                  </div>
                  <button type="button" class="btn btn-small btn-danger" data-checklist-remove="${i}">削除</button>
                </li>`
              )
              .join('')}
          </ul>`
    }
    <div class="inline-form">
      <input type="text" id="checklist-new-text" placeholder="項目を追加" />
      <button type="button" class="btn btn-small" id="checklist-add-btn">追加</button>
    </div>
  `;
}

function wireChecklistEditor(section, checklist, rerender) {
  section.querySelectorAll('[data-checklist-toggle]').forEach((el) => {
    el.addEventListener('change', (e) => {
      checklist[Number(e.target.dataset.checklistToggle)].done = e.target.checked;
    });
  });
  section.querySelectorAll('[data-checklist-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      checklist.splice(Number(btn.dataset.checklistRemove), 1);
      rerender();
    });
  });

  const input = section.querySelector('#checklist-new-text');
  const addItem = () => {
    const text = input.value.trim();
    if (!text) return;
    checklist.push({ id: genClientId(), text, done: false });
    rerender();
  };
  section.querySelector('#checklist-add-btn').addEventListener('click', addItem);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  });
}

function openTaskModal(container, ctx, task) {
  const { members } = ctx;
  const root = container.querySelector('#task-modal-root');
  const isEdit = Boolean(task);
  const checklist = (task?.checklist || []).map((item) => ({ ...item }));

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
              <label>担当役職</label>
              <select name="assigneeRole">
                <option value="">未割当</option>
                ${getRoleOptions(members).map((r) => `<option value="${escapeHtml(r)}" ${task?.assigneeRole === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
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
          <div class="form-group">
            <label>チェックリスト</label>
            <div id="checklist-section">${renderChecklistEditor(checklist)}</div>
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

  function refreshChecklistSection() {
    const section = root.querySelector('#checklist-section');
    section.innerHTML = renderChecklistEditor(checklist);
    wireChecklistEditor(section, checklist, refreshChecklistSection);
  }
  wireChecklistEditor(root.querySelector('#checklist-section'), checklist, refreshChecklistSection);

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
      assigneeRole: form.get('assigneeRole') || null,
      startDate: form.get('startDate'),
      endDate: form.get('endDate'),
      status: form.get('status'),
      progress: Number(form.get('progress')),
      checklist,
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
