const express = require('express');
const crypto = require('crypto');
const { readAll, writeAll } = require('../dataStore');
const { resolveActingMember } = require('../auth');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await readAll('members'));
});

router.post('/', async (req, res) => {
  const { name, role } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '名前は必須です' });
  }

  const members = await readAll('members');
  const isBootstrap = members.length === 0;
  const actingMember = await resolveActingMember(req);

  if (!isBootstrap && (!actingMember || !actingMember.isAdmin)) {
    return res.status(403).json({ error: '管理者のみメンバーを追加できます' });
  }

  const newMember = {
    id: crypto.randomUUID(),
    name: name.trim(),
    role: (role || '').trim(),
    isAdmin: isBootstrap ? true : Boolean(req.body.isAdmin),
  };

  members.push(newMember);
  await writeAll('members', members);
  res.status(201).json(newMember);
});

router.put('/:id', async (req, res) => {
  const actingMember = await resolveActingMember(req);
  if (!actingMember || !actingMember.isAdmin) {
    return res.status(403).json({ error: '管理者のみメンバーを編集できます' });
  }

  const members = await readAll('members');
  const target = members.find((m) => m.id === req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'メンバーが見つかりません' });
  }

  const wasAdmin = target.isAdmin;
  const willBeAdmin = req.body.isAdmin !== undefined ? Boolean(req.body.isAdmin) : wasAdmin;
  const remainingAdmins = members.filter((m) => m.id !== target.id && m.isAdmin).length;
  if (wasAdmin && !willBeAdmin && remainingAdmins === 0) {
    return res.status(400).json({ error: '最後の管理者の権限は外せません' });
  }

  if (req.body.name !== undefined) target.name = String(req.body.name).trim();
  if (req.body.role !== undefined) target.role = String(req.body.role).trim();
  target.isAdmin = willBeAdmin;

  await writeAll('members', members);
  res.json(target);
});

router.delete('/:id', async (req, res) => {
  const actingMember = await resolveActingMember(req);
  if (!actingMember || !actingMember.isAdmin) {
    return res.status(403).json({ error: '管理者のみメンバーを削除できます' });
  }

  const members = await readAll('members');
  const target = members.find((m) => m.id === req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'メンバーが見つかりません' });
  }

  const remainingAdmins = members.filter((m) => m.id !== target.id && m.isAdmin).length;
  if (target.isAdmin && remainingAdmins === 0) {
    return res.status(400).json({ error: '最後の管理者は削除できません' });
  }

  const next = members.filter((m) => m.id !== req.params.id);
  await writeAll('members', next);

  const tasks = await readAll('tasks');
  let tasksChanged = false;
  for (const task of tasks) {
    if (task.assigneeId === req.params.id) {
      task.assigneeId = null;
      tasksChanged = true;
    }
  }
  if (tasksChanged) await writeAll('tasks', tasks);

  res.status(204).end();
});

module.exports = router;
