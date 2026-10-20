import {
  escapeHtml,
  formatDate,
  compareCutNumber,
  RENDERABLE_LIST,
  RENDER_CUT_STATUS_LIST,
  PRIORITY_LIST,
} from './utils.js';
import { parseRenderCutPaste } from './renderCutImport.js';

let statusFilter = 'all';

// 値ごとの色クラス(テーマ変数で色付けするのでダークモードでも読める)
const VALUE_CLASS = {
  可能: 'cut-ok',
  完了: 'cut-ok',
  不可能: 'cut-ng',
  やり直し: 'cut-ng',
  高: 'cut-ng',
  レンダリング中: 'cut-doing',
  中: 'cut-mid',
};

function valueClass(value) {
  return VALUE_CLASS[value] || 'cut-muted';
}

function selectHtml(cut, field, options, allowEmpty) {
  const current = cut[field] || '';
  const opts = (allowEmpty ? [''] : []).concat(options);
  return `<select class="cut-select ${valueClass(current)}" data-cut-id="${cut.id}" data-field="${field}">
    ${opts.map((o) => `<option value="${escapeHtml(o)}" ${o === current ? 'selected' : ''}>${o ? escapeHtml(o) : '-'}</option>`).join('')}
  </select>`;
}

function badgeHtml(value) {
  return `<span class="cut-badge ${valueClass(value)}">${value ? escapeHtml(value) : '-'}</span>`;
}

function frameText(value) {
  return value === null || value === undefined ? '' : escapeHtml(String(value));
}

function renderRow(cut, canEdit) {
  const field = (name, options, allowEmpty) =>
    canEdit ? selectHtml(cut, name, options, allowEmpty) : badgeHtml(cut[name] || '');
  return `<tr>
    <td class="nowrap"><strong>${escapeHtml(cut.cutNumber)}</strong></td>
    <td>${field('renderable', RENDERABLE_LIST, true)}</td>
    <td class="render-cut-reason">${escapeHtml(cut.reason || '')}</td>
    <td>${field('priority', PRIORITY_LIST, true)}</td>
    <td>${escapeHtml(cut.assignee || '')}</td>
    <td class="nowrap">${cut.dueDate ? formatDate(cut.dueDate) : ''}</td>
    <td>${field('status', RENDER_CUT_STATUS_LIST, false)}</td>
    <td class="cut-divider nowrap">${escapeHtml(cut.config || '')}</td>
    <td class="num">${frameText(cut.startFrame)}</td>
    <td class="num">${frameText(cut.endFrame)}</td>
    <td class="nowrap">${escapeHtml(cut.cameraName || '')}</td>
    <td class="render-cut-path" title="${escapeHtml(cut.scenePath || '')}">${escapeHtml(cut.scenePath || '')}</td>
    <td class="nowrap">${canEdit ? `<button class="btn btn-small" data-edit-id="${cut.id}">編集</button>` : ''}</td>
  </tr>`;
}

function summaryHtml(cuts) {
  const count = (pred) => cuts.filter(pred).length;
  const items = [
    ['全', cuts.length, ''],
    ['完了', count((c) => c.status === '完了'), 'cut-ok'],
    ['レンダリング中', count((c) => c.status === 'レンダリング中'), 'cut-doing'],
    ['やり直し', count((c) => c.status === 'やり直し'), 'cut-ng'],
    ['不可能', count((c) => c.renderable === '不可能'), 'cut-ng'],
  ];
  return `<div class="render-cut-summary">
    ${items.map(([label, n, cls]) => `<span class="render-cut-summary-item ${cls}">${label} <strong>${n}</strong>${label === '全' ? ' カット' : ''}</span>`).join('')}
  </div>`;
}

function importPanelHtml() {
  return `
    <details class="milestone-admin">
      <summary>Excelから一括取り込み(PMのみ)</summary>
      <div class="milestone-admin-body">
        <p class="empty">
          Excelのカット一覧で、カット番号〜シーンパスの範囲(A〜L列)を選んでコピーし、下に貼り付けてください。
          見出し行が含まれていても読み飛ばします。同じカット番号が既にあれば上書きします。
        </p>
        <textarea id="cut-import-text" rows="6" placeholder="ここに貼り付け"></textarea>
        <div class="render-cut-import-actions">
          <button type="button" class="btn btn-small" id="cut-import-preview-btn">プレビュー</button>
          <button type="button" class="btn btn-small btn-primary" id="cut-import-run-btn" disabled>取り込む</button>
          <span id="cut-import-message"></span>
        </div>
      </div>
    </details>
  `;
}

export function renderRenderCuts(container, ctx) {
  const { renderCuts, isAdmin, currentMember } = ctx;
  const canEdit = Boolean(currentMember);
  const sorted = renderCuts.slice().sort((a, b) => compareCutNumber(a.cutNumber, b.cutNumber));
  const visible = statusFilter === 'all' ? sorted : sorted.filter((c) => (c.status || '未着手') === statusFilter);

  container.innerHTML = `
    ${summaryHtml(renderCuts)}
    <div class="toolbar">
      <div class="filters">
        <select id="cut-status-filter">
          <option value="all">進行状況: すべて</option>
          ${RENDER_CUT_STATUS_LIST.map((s) => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      ${canEdit ? '<button class="btn btn-primary" id="add-cut-btn">+ カット追加</button>' : ''}
    </div>
    ${isAdmin ? importPanelHtml() : ''}
    ${
      visible.length === 0
        ? `<p class="empty">${renderCuts.length === 0 ? 'まだカットが登録されていません' : '条件に合うカットがありません'}</p>`
        : `<div class="table-scroll">
            <table class="data-table render-cut-table">
              <thead><tr>
                <th>カット番号</th><th>レンダリング可否</th><th>不可/確認中の理由</th><th>優先度</th><th>担当</th><th>期限</th><th>進行状況</th>
                <th class="cut-divider">使用コンフィグ</th><th>開始フレーム</th><th>終了フレーム</th><th>カメラ名</th><th>シーンパス</th><th></th>
              </tr></thead>
              <tbody>${visible.map((c) => renderRow(c, canEdit)).join('')}</tbody>
            </table>
          </div>`
    }
    <div class="modal-root" id="render-cut-modal-root"></div>
  `;

  container.querySelector('#cut-status-filter').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderRenderCuts(container, ctx);
  });

  const addBtn = container.querySelector('#add-cut-btn');
  if (addBtn) addBtn.addEventListener('click', () => openCutModal(container, ctx, null));

  container.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openCutModal(container, ctx, renderCuts.find((c) => c.id === btn.dataset.editId));
    });
  });

  container.querySelectorAll('.cut-select').forEach((select) => {
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await ctx.api.updateRenderCut(select.dataset.cutId, { [select.dataset.field]: select.value });
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
        select.disabled = false;
      }
    });
  });

  if (isAdmin) wireImportPanel(container, ctx);
}

function wireImportPanel(container, ctx) {
  const textEl = container.querySelector('#cut-import-text');
  const previewBtn = container.querySelector('#cut-import-preview-btn');
  const runBtn = container.querySelector('#cut-import-run-btn');
  const messageEl = container.querySelector('#cut-import-message');
  let rows = [];

  textEl.addEventListener('input', () => {
    runBtn.disabled = true;
    messageEl.textContent = '';
  });

  previewBtn.addEventListener('click', () => {
    rows = parseRenderCutPaste(textEl.value);
    if (rows.length === 0) {
      runBtn.disabled = true;
      messageEl.textContent = '取り込めるカットがありません';
      return;
    }
    const existingNumbers = new Set(ctx.renderCuts.map((c) => c.cutNumber));
    const updates = rows.filter((r) => existingNumbers.has(r.cutNumber)).length;
    messageEl.textContent = `新規 ${rows.length - updates} 件・更新 ${updates} 件`;
    runBtn.disabled = false;
  });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    previewBtn.disabled = true;
    messageEl.textContent = '取り込み中...';
    try {
      const { created, updated } = await ctx.api.upsertRenderCuts(rows, ctx.renderCuts);
      alert(`取り込みました(新規 ${created} 件・更新 ${updated} 件)`);
      await ctx.refresh();
    } catch (err) {
      messageEl.textContent = `取り込みに失敗しました: ${err.message}`;
      previewBtn.disabled = false;
    }
  });
}

function textField(label, name, value, attrs = '') {
  return `<div class="form-group">
    <label>${label}</label>
    <input type="text" name="${name}" value="${escapeHtml(value || '')}" ${attrs} />
  </div>`;
}

function selectField(label, name, options, value, allowEmpty) {
  const opts = (allowEmpty ? [''] : []).concat(options);
  return `<div class="form-group">
    <label>${label}</label>
    <select name="${name}">
      ${opts.map((o) => `<option value="${escapeHtml(o)}" ${o === (value || '') ? 'selected' : ''}>${o ? escapeHtml(o) : '-'}</option>`).join('')}
    </select>
  </div>`;
}

function openCutModal(container, ctx, cut) {
  const { isAdmin } = ctx;
  const root = container.querySelector('#render-cut-modal-root');
  const isEdit = Boolean(cut);
  const frameValue = (v) => (v === null || v === undefined ? '' : String(v));

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>${isEdit ? `カット ${escapeHtml(cut.cutNumber)} を編集` : 'カット追加'}</h3>
        <form id="render-cut-form">
          ${textField('カット番号', 'cutNumber', cut?.cutNumber, 'required placeholder="例: C001"')}
          <div class="form-row">
            ${selectField('レンダリング可否', 'renderable', RENDERABLE_LIST, cut?.renderable, true)}
            ${selectField('優先度', 'priority', PRIORITY_LIST, cut?.priority, true)}
          </div>
          <div class="form-group">
            <label>不可/確認中の理由</label>
            <textarea name="reason" rows="2">${escapeHtml(cut?.reason || '')}</textarea>
          </div>
          <div class="form-row">
            ${textField('担当', 'assignee', cut?.assignee, 'placeholder="例: 学校(坂井)"')}
            <div class="form-group">
              <label>期限</label>
              <input type="date" name="dueDate" value="${escapeHtml(cut?.dueDate || '')}" />
            </div>
          </div>
          ${selectField('進行状況', 'status', RENDER_CUT_STATUS_LIST, cut?.status || '未着手', false)}
          ${textField('使用コンフィグ', 'config', cut?.config, 'placeholder="例: Arnold_simple"')}
          <div class="form-row">
            <div class="form-group">
              <label>開始フレーム</label>
              <input type="number" name="startFrame" value="${frameValue(cut?.startFrame)}" />
            </div>
            <div class="form-group">
              <label>終了フレーム</label>
              <input type="number" name="endFrame" value="${frameValue(cut?.endFrame)}" />
            </div>
          </div>
          ${textField('カメラ名', 'cameraName', cut?.cameraName)}
          ${textField('シーンパス', 'scenePath', cut?.scenePath)}
          <div class="modal-actions">
            ${isEdit && isAdmin ? '<button type="button" class="btn btn-danger" id="modal-delete">削除</button>' : '<span></span>'}
            <div>
              <button type="button" class="btn" id="modal-cancel">キャンセル</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </div>
          <p class="form-error" id="render-cut-form-error"></p>
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
      if (!confirm(`カット ${cut.cutNumber} を削除しますか?`)) return;
      try {
        await ctx.api.deleteRenderCut(cut.id);
        root.innerHTML = '';
        await ctx.refresh();
      } catch (err) {
        root.querySelector('#render-cut-form-error').textContent = err.message;
      }
    });
  }

  root.querySelector('#render-cut-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (isEdit) {
        await ctx.api.updateRenderCut(cut.id, payload);
      } else {
        await ctx.api.createRenderCut(payload);
      }
      root.innerHTML = '';
      await ctx.refresh();
    } catch (err) {
      root.querySelector('#render-cut-form-error').textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
