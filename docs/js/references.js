import { escapeHtml, formatDateTime } from './utils.js';
import { uploadAttachment, deleteAttachment } from './storage.js';
import { attachmentPreviewHtml, wireAttachmentPreviews } from './attachmentPreview.js';

let tagFilter = 'all';

export function renderReferences(container, ctx) {
  const { references, members, currentMember, isAdmin } = ctx;
  const allTags = [...new Set(references.flatMap((r) => r.tags || []))].sort((a, b) => a.localeCompare(b, 'ja'));
  const filtered = tagFilter === 'all' ? references : references.filter((r) => (r.tags || []).includes(tagFilter));
  const sorted = filtered.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  container.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="filter-tag">
          <option value="all">タグ: すべて</option>
          ${allTags.map((t) => `<option value="${escapeHtml(t)}" ${tagFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>
      </div>
      ${currentMember ? '<button class="btn btn-primary" id="add-reference-btn">+ 資料追加</button>' : ''}
    </div>
    ${
      sorted.length === 0
        ? '<p class="empty">まだ資料がありません</p>'
        : `<div class="reference-gallery">${sorted.map((r) => renderCard(r, members, currentMember, isAdmin)).join('')}</div>`
    }
    <div class="modal-root" id="reference-modal-root"></div>
  `;

  container.querySelector('#filter-tag').addEventListener('change', (e) => {
    tagFilter = e.target.value;
    renderReferences(container, ctx);
  });

  const addRefBtn = container.querySelector('#add-reference-btn');
  if (addRefBtn) addRefBtn.addEventListener('click', () => openReferenceModal(container, ctx, null));

  container.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ref = references.find((r) => r.id === btn.dataset.editId);
      openReferenceModal(container, ctx, ref);
    });
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('この資料を削除しますか?')) return;
      try {
        await ctx.api.deleteReference(btn.dataset.deleteId);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  wireAttachmentPreviews(container);
}

function uploaderName(members, id) {
  const m = members.find((mm) => mm.id === id);
  return m ? m.name : '退会したメンバー';
}

function renderCard(ref, members, currentMember, isAdmin) {
  const isOwner = Boolean(currentMember && ref.uploadedBy === currentMember.id);
  const canEdit = isOwner;
  const canDelete = isOwner || isAdmin;
  const tags = ref.tags || [];
  const isImageAttachment = Boolean(ref.attachment && (ref.attachment.contentType || '').startsWith('image/'));
  const thumbSrc = isImageAttachment ? ref.attachment.url : ref.imageUrl;

  return `<div class="reference-card">
    ${
      thumbSrc
        ? `<img class="reference-thumb" src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(ref.title)}" loading="lazy" />`
        : ''
    }
    <div class="reference-body">
      <div class="reference-title">${escapeHtml(ref.title)}</div>
      ${ref.note ? `<div class="task-desc">${escapeHtml(ref.note)}</div>` : ''}
      ${ref.attachment && !isImageAttachment ? `<div class="task-desc">${attachmentPreviewHtml(ref.attachment)}</div>` : ''}
      ${tags.length > 0 ? `<div class="reference-tags">${tags.map((t) => `<span class="badge" style="background:#6b7280">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="memo-meta">
        <span class="memo-author">${escapeHtml(uploaderName(members, ref.uploadedBy))}</span>
        <span class="memo-date">${formatDateTime(ref.createdAt)}</span>
      </div>
      ${
        canEdit || canDelete
          ? `<div class="memo-actions">
              ${canEdit ? `<button class="btn btn-small" data-edit-id="${ref.id}">編集</button>` : ''}
              ${canDelete ? `<button class="btn btn-small btn-danger" data-delete-id="${ref.id}">削除</button>` : ''}
            </div>`
          : ''
      }
    </div>
  </div>`;
}

function openReferenceModal(container, ctx, ref) {
  const root = container.querySelector('#reference-modal-root');
  const isEdit = Boolean(ref);

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>${isEdit ? '資料を編集' : '資料追加'}</h3>
        <form id="reference-form">
          <div class="form-group">
            <label>タイトル</label>
            <input type="text" name="title" required value="${escapeHtml(ref?.title || '')}" />
          </div>
          <div class="form-group">
            <label>画像URL(添付ファイルを使う場合は空欄でも可)</label>
            <input type="text" name="imageUrl" value="${escapeHtml(ref?.imageUrl || '')}" placeholder="https://..." />
          </div>
          <div class="form-group">
            <label>添付ファイル(任意、15MBまで。画像ファイルを直接アップロードできます)</label>
            ${ref?.attachment ? `<p class="empty">現在の添付: ${escapeHtml(ref.attachment.fileName)}</p>` : ''}
            <input type="file" name="attachmentFile" />
            ${
              ref?.attachment
                ? `<div class="form-checkbox"><label><input type="checkbox" name="removeAttachment" /> 添付ファイルを削除する</label></div>`
                : ''
            }
          </div>
          <div class="form-group">
            <label>タグ(カンマ区切り、任意)</label>
            <input type="text" name="tags" value="${escapeHtml((ref?.tags || []).join(', '))}" placeholder="例: 背景, カラーラフ" />
          </div>
          <div class="form-group">
            <label>メモ</label>
            <textarea name="note" rows="2">${escapeHtml(ref?.note || '')}</textarea>
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="modal-delete">削除</button>' : '<span></span>'}
            <div>
              <button type="button" class="btn" id="modal-cancel">キャンセル</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </div>
          <p class="form-error" id="reference-form-error"></p>
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
      if (!confirm('この資料を削除しますか?')) return;
      try {
        await ctx.api.deleteReference(ref.id);
        root.innerHTML = '';
        await ctx.refresh();
      } catch (err) {
        root.querySelector('#reference-form-error').textContent = err.message;
      }
    });
  }

  root.querySelector('#reference-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let attachment;
      const file = form.get('attachmentFile');
      if (file && file.size > 0) {
        attachment = await uploadAttachment('references', file);
        if (ref?.attachment) await deleteAttachment(ref.attachment.path);
      } else if (form.get('removeAttachment') === 'on') {
        if (ref?.attachment) await deleteAttachment(ref.attachment.path);
        attachment = null;
      }

      const payload = {
        title: form.get('title'),
        imageUrl: form.get('imageUrl'),
        tags: form.get('tags'),
        note: form.get('note'),
      };
      if (attachment !== undefined) payload.attachment = attachment;

      if (isEdit) {
        await ctx.api.updateReference(ref.id, payload);
      } else {
        payload.uploadedBy = ctx.currentMember.id;
        await ctx.api.createReference(payload);
      }
      root.innerHTML = '';
      await ctx.refresh();
    } catch (err) {
      root.querySelector('#reference-form-error').textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
