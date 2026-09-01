import { escapeHtml, formatDateTime, renderStatusColor } from './utils.js';

export function renderRenderQueue(container, ctx) {
  const { renderJobs, members, currentMember, isAdmin } = ctx;
  const canManage = Boolean(currentMember);

  const active = renderJobs
    .filter((j) => j.status === '実行中')
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  const history = renderJobs
    .filter((j) => j.status !== '実行中')
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .slice(0, 10);

  const pcNames = [...new Set(renderJobs.map((j) => j.pcName))].sort((a, b) => a.localeCompare(b, 'ja'));

  container.innerHTML = `
    <datalist id="pcname-list">
      ${pcNames.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}
    </datalist>
    ${canManage ? renderNewJobForm() : ''}
    ${
      active.length === 0
        ? '<p class="empty">現在使用中のPCはありません</p>'
        : `<div class="table-scroll"><table class="data-table">
            <thead><tr><th>PC名</th><th>使用者</th><th>内容</th><th>開始</th><th>終了予定</th><th>経過</th><th></th></tr></thead>
            <tbody>${active.map((j) => renderActiveRow(j, members, currentMember, isAdmin)).join('')}</tbody>
          </table></div>`
    }
    <div class="card">${renderHistorySection(history, members)}</div>
  `;

  const form = container.querySelector('#job-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await ctx.api.createRenderJob({
          pcName: fd.get('pcName'),
          memberId: currentMember.id,
          title: fd.get('title'),
          estimatedEndAt: fd.get('estimatedEndAt') || null,
          note: fd.get('note'),
        });
        await ctx.refresh();
      } catch (err) {
        container.querySelector('#job-form-error').textContent = err.message;
      }
    });
  }

  container.querySelectorAll('[data-complete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await ctx.api.updateRenderJob(btn.dataset.completeId, { status: '完了' });
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  container.querySelectorAll('[data-suspend-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await ctx.api.updateRenderJob(btn.dataset.suspendId, { status: '中断' });
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('このジョブを削除しますか?')) return;
      try {
        await ctx.api.deleteRenderJob(btn.dataset.deleteId);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function memberName(members, id) {
  const m = members.find((mm) => mm.id === id);
  return m ? m.name : '退会したメンバー';
}

function formatElapsed(startedAt) {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return '-';
  const totalMinutes = Math.max(Math.floor((Date.now() - start.getTime()) / 60000), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;
}

function renderNewJobForm() {
  return `
    <div class="card">
      <h3>PCの使用を開始</h3>
      <form id="job-form" class="memo-form">
        <div class="form-row">
          <div class="form-group">
            <label>PC名</label>
            <input type="text" name="pcName" list="pcname-list" required placeholder="例: 編集PC1" />
          </div>
          <div class="form-group">
            <label>終了予定(任意)</label>
            <input type="datetime-local" name="estimatedEndAt" />
          </div>
        </div>
        <div class="form-group">
          <label>内容</label>
          <input type="text" name="title" required placeholder="例: 第3カット 最終レンダリング" />
        </div>
        <div class="form-group">
          <label>メモ(任意)</label>
          <textarea name="note" rows="2"></textarea>
        </div>
        <div class="memo-form-actions">
          <button type="submit" class="btn btn-primary">使用開始</button>
        </div>
        <p class="form-error" id="job-form-error"></p>
      </form>
    </div>
  `;
}

function renderActiveRow(job, members, currentMember, isAdmin) {
  const canManage = isAdmin || Boolean(currentMember && job.memberId === currentMember.id);
  const overdue = Boolean(job.estimatedEndAt && new Date(job.estimatedEndAt) < new Date());

  return `<tr>
    <td>${escapeHtml(job.pcName)}</td>
    <td>${escapeHtml(memberName(members, job.memberId))}</td>
    <td>
      ${escapeHtml(job.title)}
      ${job.note ? `<div class="task-desc">${escapeHtml(job.note)}</div>` : ''}
      ${overdue ? '<span class="badge badge-warning">予定時刻超過</span>' : ''}
    </td>
    <td class="nowrap">${formatDateTime(job.startedAt)}</td>
    <td class="nowrap">${job.estimatedEndAt ? formatDateTime(job.estimatedEndAt) : '-'}</td>
    <td class="nowrap">${formatElapsed(job.startedAt)}</td>
    <td class="nowrap">
      ${
        canManage
          ? `<button class="btn btn-small" data-complete-id="${job.id}">完了にする</button>
             <button class="btn btn-small" data-suspend-id="${job.id}">中断にする</button>
             <button class="btn btn-small btn-danger" data-delete-id="${job.id}">削除</button>`
          : ''
      }
    </td>
  </tr>`;
}

function renderHistorySection(history, members) {
  return `
    <details class="milestone-admin">
      <summary>履歴 (${history.length}件)</summary>
      <div class="milestone-admin-body">
        ${
          history.length === 0
            ? '<p class="empty">履歴はありません</p>'
            : `<ul class="milestone-manage-list">
                ${history
                  .map(
                    (j) => `<li>
                      <span>${escapeHtml(j.pcName)} - ${escapeHtml(j.title)}(${escapeHtml(memberName(members, j.memberId))})
                        <span class="badge" style="background:${renderStatusColor(j.status)}">${escapeHtml(j.status)}</span>
                      </span>
                    </li>`
                  )
                  .join('')}
              </ul>`
        }
      </div>
    </details>
  `;
}
