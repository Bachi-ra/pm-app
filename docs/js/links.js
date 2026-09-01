import { escapeHtml } from './utils.js';

export function renderLinks(container, ctx) {
  const { links, isAdmin, notificationSettings } = ctx;
  const categories = [...new Set(links.map((l) => l.category).filter(Boolean))].sort();
  const sorted = links
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category, 'ja') || a.title.localeCompare(b.title, 'ja'));

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      ${isAdmin ? '<button class="btn btn-primary" id="add-link-btn">+ リンク追加</button>' : ''}
    </div>

    ${isAdmin ? renderWebhookAdmin(notificationSettings) : ''}

    <datalist id="link-category-list">
      ${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
    </datalist>

    ${
      sorted.length === 0
        ? '<p class="empty">まだリンクが登録されていません</p>'
        : `<div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>名前</th><th>カテゴリ</th><th>メモ</th><th></th></tr></thead>
              <tbody>${sorted.map((l) => renderRow(l, isAdmin)).join('')}</tbody>
            </table>
          </div>`
    }

    <div class="modal-root" id="link-modal-root"></div>
  `;

  if (isAdmin) wireWebhookAdmin(container, ctx);

  const addBtn = container.querySelector('#add-link-btn');
  if (addBtn) addBtn.addEventListener('click', () => openLinkModal(container, ctx, null));

  container.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const link = links.find((l) => l.id === btn.dataset.editId);
      openLinkModal(container, ctx, link);
    });
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('このリンクを削除しますか?')) return;
      try {
        await ctx.api.deleteLink(btn.dataset.deleteId);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderWebhookAdmin(notificationSettings) {
  const currentUrl = notificationSettings?.discordWebhookUrl || '';
  return `
    <details class="milestone-admin">
      <summary>締切リマインドのDiscord通知設定</summary>
      <div class="milestone-admin-body">
        <p class="empty">
          締切が近い(3日以内)未完了タスクがある状態で誰かがアプリを開くと、
          1日1回この宛先にリマインドを投稿します。空欄にすると通知しません。
        </p>
        <form id="webhook-form" class="inline-form">
          <input type="text" name="webhookUrl" value="${escapeHtml(currentUrl)}" placeholder="https://discord.com/api/webhooks/..." style="flex:1;min-width:240px" />
          <button type="submit" class="btn btn-small btn-primary">保存</button>
        </form>
        <p class="form-error" id="webhook-form-error"></p>
      </div>
    </details>
  `;
}

function wireWebhookAdmin(container, ctx) {
  const form = container.querySelector('#webhook-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    try {
      await ctx.api.updateDiscordWebhookUrl(data.get('webhookUrl'));
      await ctx.refresh();
    } catch (err) {
      container.querySelector('#webhook-form-error').textContent = err.message;
    }
  });
}

function renderRow(link, isAdmin) {
  return `<tr>
    <td><a class="link-external" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.title)}</a></td>
    <td>${escapeHtml(link.category || 'その他')}</td>
    <td>${escapeHtml(link.note || '-')}</td>
    <td class="nowrap">
      ${
        isAdmin
          ? `<button class="btn btn-small" data-edit-id="${link.id}">編集</button>
             <button class="btn btn-small btn-danger" data-delete-id="${link.id}">削除</button>`
          : ''
      }
    </td>
  </tr>`;
}

function openLinkModal(container, ctx, link) {
  const root = container.querySelector('#link-modal-root');
  const isEdit = Boolean(link);

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>${isEdit ? 'リンクを編集' : 'リンク追加'}</h3>
        <form id="link-form">
          <div class="form-group">
            <label>名前</label>
            <input type="text" name="title" required value="${escapeHtml(link?.title || '')}" placeholder="例: Discordサーバー" />
          </div>
          <div class="form-group">
            <label>URL</label>
            <input type="text" name="url" required value="${escapeHtml(link?.url || '')}" placeholder="https://..." />
          </div>
          <div class="form-group">
            <label>カテゴリ</label>
            <input type="text" name="category" list="link-category-list" value="${escapeHtml(link?.category || '')}" placeholder="例: 連絡ツール" />
          </div>
          <div class="form-group">
            <label>メモ</label>
            <input type="text" name="note" value="${escapeHtml(link?.note || '')}" placeholder="用途など(任意)" />
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="modal-delete">削除</button>' : '<span></span>'}
            <div>
              <button type="button" class="btn" id="modal-cancel">キャンセル</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </div>
          <p class="form-error" id="link-form-error"></p>
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
      if (!confirm('このリンクを削除しますか?')) return;
      try {
        await ctx.api.deleteLink(link.id);
        root.innerHTML = '';
        await ctx.refresh();
      } catch (err) {
        root.querySelector('#link-form-error').textContent = err.message;
      }
    });
  }

  root.querySelector('#link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      title: form.get('title'),
      url: form.get('url'),
      category: form.get('category'),
      note: form.get('note'),
    };
    try {
      if (isEdit) {
        await ctx.api.updateLink(link.id, payload);
      } else {
        await ctx.api.createLink(payload);
      }
      root.innerHTML = '';
      await ctx.refresh();
    } catch (err) {
      root.querySelector('#link-form-error').textContent = err.message;
    }
  });
}
