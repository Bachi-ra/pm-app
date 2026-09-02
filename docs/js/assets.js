import { escapeHtml, ASSET_TYPE_LIST } from './utils.js';
import { uploadAttachment, deleteAttachment } from './storage.js';
import { attachmentPreviewHtml, wireAttachmentPreviews } from './attachmentPreview.js';

export function renderAssets(container, ctx) {
  const { assets, tasks, isAdmin, currentMember } = ctx;
  const canEdit = Boolean(currentMember);
  const sorted = assets
    .slice()
    .sort((a, b) => a.type.localeCompare(b.type, 'ja') || a.name.localeCompare(b.name, 'ja'));

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      ${canEdit ? '<button class="btn btn-primary" id="add-asset-btn">+ 素材追加</button>' : ''}
    </div>
    ${
      sorted.length === 0
        ? '<p class="empty">まだ素材が登録されていません</p>'
        : `<div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>名前</th><th>種類</th><th>入手元</th><th>ライセンス</th><th>使用タスク</th><th>メモ</th><th></th></tr></thead>
              <tbody>${sorted.map((a) => renderRow(a, tasks, isAdmin, canEdit)).join('')}</tbody>
            </table>
          </div>`
    }
    <div class="modal-root" id="asset-modal-root"></div>
  `;

  const addBtn = container.querySelector('#add-asset-btn');
  if (addBtn) addBtn.addEventListener('click', () => openAssetModal(container, ctx, null));

  container.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const asset = assets.find((a) => a.id === btn.dataset.editId);
      openAssetModal(container, ctx, asset);
    });
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('この素材を削除しますか?')) return;
      try {
        await ctx.api.deleteAsset(btn.dataset.deleteId);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  wireAttachmentPreviews(container);
}

function renderRow(asset, tasks, isAdmin, canEdit) {
  const usedTask = asset.usedInTaskId ? tasks.find((t) => t.id === asset.usedInTaskId) : null;
  const licenseUnknown = !asset.license;
  const isUrlSource = /^https?:\/\//i.test(asset.source || '');

  return `<tr>
    <td>${escapeHtml(asset.name)}</td>
    <td>${escapeHtml(asset.type)}</td>
    <td>${
      asset.source
        ? isUrlSource
          ? `<a class="link-external" href="${escapeHtml(asset.source)}" target="_blank" rel="noopener noreferrer">リンク</a>`
          : escapeHtml(asset.source)
        : '-'
    }</td>
    <td>${licenseUnknown ? '<span class="badge badge-warning">ライセンス未確認</span>' : escapeHtml(asset.license)}</td>
    <td>${usedTask ? escapeHtml(usedTask.title) : '-'}</td>
    <td>
      ${asset.note ? escapeHtml(asset.note) : '-'}
      ${asset.attachment ? `<div class="task-desc">${attachmentPreviewHtml(asset.attachment)}</div>` : ''}
    </td>
    <td class="nowrap">
      ${canEdit ? `<button class="btn btn-small" data-edit-id="${asset.id}">編集</button>` : ''}
      ${isAdmin ? `<button class="btn btn-small btn-danger" data-delete-id="${asset.id}">削除</button>` : ''}
    </td>
  </tr>`;
}

function openAssetModal(container, ctx, asset) {
  const { tasks, isAdmin } = ctx;
  const root = container.querySelector('#asset-modal-root');
  const isEdit = Boolean(asset);

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>${isEdit ? '素材を編集' : '素材追加'}</h3>
        <form id="asset-form">
          <div class="form-group">
            <label>名前</label>
            <input type="text" name="name" required value="${escapeHtml(asset?.name || '')}" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>種類</label>
              <select name="type">
                ${ASSET_TYPE_LIST.map((t) => `<option value="${t}" ${(asset?.type || 'その他') === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>使用タスク(任意)</label>
              <select name="usedInTaskId">
                <option value="">なし</option>
                ${tasks.map((t) => `<option value="${t.id}" ${asset?.usedInTaskId === t.id ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>入手元(URLなど)</label>
            <input type="text" name="source" value="${escapeHtml(asset?.source || '')}" placeholder="https://... または購入元など" />
          </div>
          <div class="form-group">
            <label>ライセンス/利用規約の状況</label>
            <input type="text" name="license" value="${escapeHtml(asset?.license || '')}" placeholder="例: CC0、商用利用可、要確認 など" />
          </div>
          <div class="form-group">
            <label>メモ</label>
            <textarea name="note" rows="2">${escapeHtml(asset?.note || '')}</textarea>
          </div>
          <div class="form-group">
            <label>添付ファイル(任意、15MBまで)</label>
            ${asset?.attachment ? `<p class="empty">現在の添付: ${escapeHtml(asset.attachment.fileName)}</p>` : ''}
            <input type="file" name="attachmentFile" />
            ${
              asset?.attachment
                ? `<div class="form-checkbox"><label><input type="checkbox" name="removeAttachment" /> 添付ファイルを削除する</label></div>`
                : ''
            }
          </div>
          <div class="modal-actions">
            ${isEdit && isAdmin ? '<button type="button" class="btn btn-danger" id="modal-delete">削除</button>' : '<span></span>'}
            <div>
              <button type="button" class="btn" id="modal-cancel">キャンセル</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </div>
          <p class="form-error" id="asset-form-error"></p>
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
      if (!confirm('この素材を削除しますか?')) return;
      try {
        await ctx.api.deleteAsset(asset.id);
        root.innerHTML = '';
        await ctx.refresh();
      } catch (err) {
        root.querySelector('#asset-form-error').textContent = err.message;
      }
    });
  }

  root.querySelector('#asset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let attachment;
      const file = form.get('attachmentFile');
      if (file && file.size > 0) {
        attachment = await uploadAttachment('assets', file);
        if (asset?.attachment) await deleteAttachment(asset.attachment.path);
      } else if (form.get('removeAttachment') === 'on') {
        if (asset?.attachment) await deleteAttachment(asset.attachment.path);
        attachment = null;
      }

      const payload = {
        name: form.get('name'),
        type: form.get('type'),
        usedInTaskId: form.get('usedInTaskId') || null,
        source: form.get('source'),
        license: form.get('license'),
        note: form.get('note'),
      };
      if (attachment !== undefined) payload.attachment = attachment;

      if (isEdit) {
        await ctx.api.updateAsset(asset.id, payload);
      } else {
        await ctx.api.createAsset(payload);
      }
      root.innerHTML = '';
      await ctx.refresh();
    } catch (err) {
      root.querySelector('#asset-form-error').textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
