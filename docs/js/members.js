import { escapeHtml, roleColor } from './utils.js';

export function renderMembers(container, ctx) {
  const { members, isAdmin, currentMember } = ctx;

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      ${isAdmin ? '<button class="btn btn-primary" id="add-member-btn">+ メンバー追加</button>' : ''}
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>名前</th><th>役職</th><th>権限</th><th></th></tr></thead>
        <tbody>
          ${members
            .map(
              (m) => `<tr>
                <td>${escapeHtml(m.name)}${m.id === currentMember?.id ? ' <span class="you-tag">(あなた)</span>' : ''}</td>
                <td>${m.role ? `<span class="badge" style="background:${roleColor(m.role)}">${escapeHtml(m.role)}</span>` : '-'}</td>
                <td>${m.isAdmin ? '<span class="badge status-doing">管理者</span>' : 'メンバー'}</td>
                <td class="nowrap">
                  ${
                    isAdmin
                      ? `<button class="btn btn-small" data-edit-id="${m.id}">編集</button>
                         <button class="btn btn-small btn-danger" data-delete-id="${m.id}">削除</button>`
                      : ''
                  }
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-root" id="member-modal-root"></div>
  `;

  const addBtn = container.querySelector('#add-member-btn');
  if (addBtn) addBtn.addEventListener('click', () => openMemberModal(container, ctx, null));

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
            <label>役職</label>
            <input type="text" name="role" value="${escapeHtml(member?.role || '')}" placeholder="例: デザイン担当" />
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
      role: form.get('role'),
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
