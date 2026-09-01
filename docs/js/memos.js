import { escapeHtml, formatDateTime } from './utils.js';

export function renderMemos(container, ctx) {
  const { memos, members, currentMember, isAdmin } = ctx;
  const sorted = memos.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  container.innerHTML = `
    ${
      currentMember
        ? `<div class="card">
            <h3>メモを投稿</h3>
            <form id="memo-form" class="memo-form">
              <textarea name="content" rows="3" placeholder="共有したいメモや連絡事項を入力..." required></textarea>
              <div class="memo-form-actions">
                <button type="submit" class="btn btn-primary">投稿</button>
              </div>
              <p class="form-error" id="memo-form-error"></p>
            </form>
          </div>`
        : ''
    }

    ${
      sorted.length === 0
        ? '<p class="empty">まだメモがありません</p>'
        : `<ul class="memo-list">${sorted.map((m) => renderMemoItem(m, members, currentMember, isAdmin)).join('')}</ul>`
    }
  `;

  const memoForm = container.querySelector('#memo-form');
  if (memoForm) {
    memoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        await ctx.api.createMemo({ authorId: currentMember.id, content: form.get('content') });
        await ctx.refresh();
      } catch (err) {
        container.querySelector('#memo-form-error').textContent = err.message;
      }
    });
  }

  container.querySelectorAll('[data-edit-memo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const memo = memos.find((m) => m.id === btn.dataset.editMemo);
      startEditMemo(container, ctx, memo);
    });
  });

  container.querySelectorAll('[data-delete-memo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('このメモを削除しますか?')) return;
      try {
        await ctx.api.deleteMemo(btn.dataset.deleteMemo);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function authorName(members, id) {
  const m = members.find((mm) => mm.id === id);
  return m ? m.name : '退会したメンバー';
}

function renderMemoItem(memo, members, currentMember, isAdmin) {
  const isOwner = Boolean(currentMember && memo.authorId === currentMember.id);
  const canEdit = isOwner;
  const canDelete = isOwner || isAdmin;

  return `<li class="memo-item" data-memo-id="${memo.id}">
    <div class="memo-meta">
      <span class="memo-author">${escapeHtml(authorName(members, memo.authorId))}</span>
      <span class="memo-date">${formatDateTime(memo.createdAt)}</span>
    </div>
    <div class="memo-content">${escapeHtml(memo.content).replace(/\n/g, '<br>')}</div>
    ${
      canEdit || canDelete
        ? `<div class="memo-actions">
            ${canEdit ? `<button class="btn btn-small" data-edit-memo="${memo.id}">編集</button>` : ''}
            ${canDelete ? `<button class="btn btn-small btn-danger" data-delete-memo="${memo.id}">削除</button>` : ''}
          </div>`
        : ''
    }
  </li>`;
}

function startEditMemo(container, ctx, memo) {
  const li = container.querySelector(`[data-memo-id="${memo.id}"]`);
  li.innerHTML = `
    <form class="memo-edit-form">
      <textarea name="content" rows="3" required>${escapeHtml(memo.content)}</textarea>
      <div class="memo-form-actions">
        <button type="button" class="btn" id="memo-cancel-edit">キャンセル</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
      <p class="form-error" id="memo-edit-error"></p>
    </form>
  `;

  li.querySelector('#memo-cancel-edit').addEventListener('click', () => {
    ctx.refresh();
  });

  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await ctx.api.updateMemo(memo.id, { content: form.get('content') });
      await ctx.refresh();
    } catch (err) {
      li.querySelector('#memo-edit-error').textContent = err.message;
    }
  });
}
