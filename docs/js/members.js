import { escapeHtml, roleColor, memberRoles, groupByMemberRole } from './utils.js';

function groupMembersByRole(members) {
  return groupByMemberRole(members, (m) => m).map((g) => ({ role: g.role, members: g.items }));
}

function renderRoleBadges(member) {
  const roles = memberRoles(member);
  if (roles.length === 0) return '-';
  return roles.map((r) => `<span class="badge" style="background:${roleColor(r)}">${escapeHtml(r)}</span>`).join(' ');
}

function renderMemberRow(m, isAdmin, currentMember) {
  return `<tr>
    <td>${escapeHtml(m.name)}${m.id === currentMember?.id ? ' <span class="you-tag">(あなた)</span>' : ''}</td>
    <td>${renderRoleBadges(m)}</td>
    <td>${m.isAdmin ? '<span class="badge status-doing">管理者</span>' : 'メンバー'}</td>
    <td class="nowrap">
      ${
        isAdmin
          ? `<button class="btn btn-small" data-edit-id="${m.id}">編集</button>
             <button class="btn btn-small btn-danger" data-delete-id="${m.id}">削除</button>`
          : ''
      }
    </td>
  </tr>`;
}

export function renderMembers(container, ctx) {
  const { members, isAdmin, currentMember } = ctx;
  const groups = groupMembersByRole(members);

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      ${isAdmin ? '<button class="btn btn-primary" id="add-member-btn">+ メンバー追加</button>' : ''}
    </div>
    ${isAdmin ? renderReadonlyLinkTool() : ''}
    ${isAdmin ? renderBackupTool() : ''}
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>名前</th><th>役職</th><th>権限</th><th></th></tr></thead>
        <tbody>
          ${
            members.length === 0
              ? ''
              : groups
                  .map(
                    (g) => `
                      <tr class="role-group-row"><td colspan="4">${escapeHtml(g.role)}</td></tr>
                      ${g.members.map((m) => renderMemberRow(m, isAdmin, currentMember)).join('')}
                    `
                  )
                  .join('')
          }
        </tbody>
      </table>
    </div>
    <div class="modal-root" id="member-modal-root"></div>
  `;

  const addBtn = container.querySelector('#add-member-btn');
  if (addBtn) addBtn.addEventListener('click', () => openMemberModal(container, ctx, null));

  const copyReadonlyBtn = container.querySelector('#copy-readonly-link-btn');
  if (copyReadonlyBtn) {
    copyReadonlyBtn.addEventListener('click', async () => {
      const url = `${window.location.origin}${window.location.pathname}?readonly=1`;
      try {
        await navigator.clipboard.writeText(url);
        const original = copyReadonlyBtn.textContent;
        copyReadonlyBtn.textContent = 'コピーしました';
        setTimeout(() => {
          copyReadonlyBtn.textContent = original;
        }, 2000);
      } catch (err) {
        alert(`コピーに失敗しました。手動でこのURLを共有してください: ${url}`);
      }
    });
  }

  const exportBtn = container.querySelector('#backup-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const backup = await ctx.api.exportAllData();
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pm-app-backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(`バックアップの作成に失敗しました: ${err.message}`);
      } finally {
        exportBtn.disabled = false;
      }
    });
  }

  const importInput = container.querySelector('#backup-import-input');
  const importBtn = container.querySelector('#backup-import-btn');
  if (importInput && importBtn) {
    importBtn.addEventListener('click', async () => {
      const file = importInput.files && importInput.files[0];
      const errorEl = container.querySelector('#backup-import-error');
      errorEl.textContent = '';

      if (!file) {
        errorEl.textContent = 'ファイルを選択してください';
        return;
      }
      if (
        !confirm(
          '本当に上書きしますか?\n\n現在のデータはすべて削除され、選択したファイルの内容に置き換わります。この操作は取り消せません。'
        )
      ) {
        return;
      }

      importBtn.disabled = true;
      try {
        const text = await file.text();
        const backup = JSON.parse(text);
        await ctx.api.importAllData(backup);
        await ctx.refresh();
      } catch (err) {
        errorEl.textContent = `復元に失敗しました: ${err.message}`;
      } finally {
        importBtn.disabled = false;
      }
    });
  }

  container.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const member = members.find((m) => m.id === btn.dataset.editId);
      openMemberModal(container, ctx, member);
    });
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('このメンバーを削除しますか? 担当中のタスクは未割当になります。')) return;
      try {
        await ctx.api.deleteMember(btn.dataset.deleteId);
        await ctx.refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderReadonlyLinkTool() {
  return `
    <details class="milestone-admin">
      <summary>閲覧専用URL(編集ボタンなしで共有できます)</summary>
      <div class="milestone-admin-body">
        <p class="empty">
          チーム外の人(先生など)に進捗だけ見せたい場合に使えます。このURLでは
          追加・編集・削除のボタンがすべて非表示になります。
        </p>
        <button type="button" class="btn btn-small" id="copy-readonly-link-btn">閲覧専用URLをコピー</button>
      </div>
    </details>
  `;
}

function renderBackupTool() {
  return `
    <details class="milestone-admin">
      <summary>データのバックアップ・復元</summary>
      <div class="milestone-admin-body">
        <p class="empty">全コレクションのデータをJSONファイルとして保存・復元できます。</p>
        <button type="button" class="btn btn-small" id="backup-export-btn">JSONバックアップをダウンロード</button>
        <div class="form-group" style="margin-top:12px">
          <label>バックアップファイルから復元</label>
          <input type="file" id="backup-import-input" accept="application/json" />
        </div>
        <button type="button" class="btn btn-small btn-danger" id="backup-import-btn">このファイルで上書き復元する</button>
        <p class="form-error" id="backup-import-error"></p>
      </div>
    </details>
  `;
}

function openMemberModal(container, ctx, member) {
  const root = container.querySelector('#member-modal-root');
  const isEdit = Boolean(member);

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>${isEdit ? 'メンバーを編集' : 'メンバー追加'}</h3>
        <form id="member-form">
          <div class="form-group">
            <label>名前</label>
            <input type="text" name="name" required value="${escapeHtml(member?.name || '')}" />
          </div>
          <div class="form-group">
            <label>役職(カンマ区切りで複数入力可)</label>
            <input type="text" name="roles" value="${escapeHtml(memberRoles(member).join(', '))}" placeholder="例: デザイン担当, 編集担当" />
          </div>
          <div class="form-group">
            <label>個人の進捗確認チャンネル Webhook URL(任意)</label>
            <input type="url" name="discordWebhookUrl" value="${escapeHtml(member?.discordWebhookUrl || '')}" placeholder="https://discord.com/api/webhooks/..." />
            <p class="form-hint">設定すると、このメンバー宛の担当タスク・進捗まとめが定期的にこのチャンネルへ届きます。</p>
          </div>
          <div class="form-group form-checkbox">
            <label><input type="checkbox" name="isAdmin" ${member?.isAdmin ? 'checked' : ''} /> 管理者権限を付与する</label>
          </div>
          <div class="modal-actions">
            <span></span>
            <div>
              <button type="button" class="btn" id="modal-cancel">キャンセル</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </div>
          <p class="form-error" id="member-form-error"></p>
        </form>
      </div>
    </div>
  `;

  root.querySelector('#modal-cancel').addEventListener('click', () => {
    root.innerHTML = '';
  });

  root.querySelector('#member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      name: form.get('name'),
      roles: form.get('roles'),
      discordWebhookUrl: form.get('discordWebhookUrl'),
      isAdmin: form.get('isAdmin') === 'on',
    };
    try {
      if (isEdit) {
        await ctx.api.updateMember(member.id, payload);
      } else {
        await ctx.api.createMember(payload);
      }
      root.innerHTML = '';
      await ctx.refresh();
    } catch (err) {
      root.querySelector('#member-form-error').textContent = err.message;
    }
  });
}
