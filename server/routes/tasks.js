const express = require('express');
const crypto = require('crypto');
const { readAll, writeAll } = require('../dataStore');
const { resolveActingMember } = require('../auth');

const router = express.Router();

const VALID_STATUS = ['未着手', '進行中', '完了'];

function clampProgress(value, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

router.get('/', async (req, res) => {
  res.json(await readAll('tasks'));
});

router.post('/', async (req, res) => {
  const actingMember = await resolveActingMember(req);
  if (!actingMember || !actingMember.isAdmin) {
    return res.status(403).json({ error: '管理者のみタスクを作成できます' });
  }

  const { title, description, category, assigneeId, startDate, endDate } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'タイトルは必須です' });
  }
  if (!startDate || !endDate) {
    return res.status(400).json({ error: '開始日と終了日は必須です' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: '開始日は終了日より前にしてください' });
  }

  const status = VALID_STATUS.includes(req.body.status) ? req.body.status : '未着手';

  const task = {
    id: crypto.randomUUID(),
    title: title.trim(),
    description: (description || '').trim(),
    category: (category || '未分類').trim(),
    assigneeId: assigneeId || null,
    status,
    progress: status === '完了' ? 100 : clampProgress(req.body.progress, 0),
    startDate,
    endDate,
  };

  const tasks = await readAll('tasks');
  tasks.push(task);
  await writeAll('tasks', tasks);
  res.status(201).json(task);
});

router.put('/:id', async (req, res) => {
  const actingMember = await resolveActingMember(req);
  const tasks = await readAll('tasks');
  const target = tasks.find((t) => t.id === req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'タスクが見つかりません' });
  }

  const isAdmin = Boolean(actingMember && actingMember.isAdmin);
  const isOwner = Boolean(actingMember && actingMember.id === target.assigneeId);

  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: '自分の担当タスクのみ更新できます' });
  }

  if (!isAdmin) {
    // 担当者はステータスと進捗のみ更新可能
    const allowedKeys = ['status', 'progress'];
    const extraKeys = Object.keys(req.body).filter(
      (k) => !allowedKeys.includes(k) && k !== 'actingMemberId'
    );
    if (extraKeys.length > 0) {
      return res.status(403).json({ error: 'ステータスと進捗以外は管理者のみ編集できます' });
    }
  }

  if (req.body.status !== undefined) {
    if (!VALID_STATUS.includes(req.body.status)) {
      return res.status(400).json({ error: '不正なステータスです' });
    }
    target.status = req.body.status;
    if (target.status === '完了') target.progress = 100;
  }
  if (req.body.progress !== undefined) {
    target.progress = clampProgress(req.body.progress, target.progress);
  }

  if (isAdmin) {
    if (req.body.title !== undefined) target.title = String(req.body.title).trim();
    if (req.body.description !== undefined) target.description = String(req.body.description).trim();
    if (req.body.category !== undefined) target.category = String(req.body.category).trim() || '未分類';
    if (req.body.assigneeId !== undefined) target.assigneeId = req.body.assigneeId || null;
    if (req.body.startDate !== undefined) target.startDate = req.body.startDate;
    if (req.body.endDate !== undefined) target.endDate = req.body.endDate;
    if (target.startDate > target.endDate) {
      return res.status(400).json({ error: '開始日は終了日より前にしてください' });
    }
  }

  await writeAll('tasks', tasks);
  res.json(target);
});

router.delete('/:id', async (req, res) => {
  const actingMember = await resolveActingMember(req);
  if (!actingMember || !actingMember.isAdmin) {
    return res.status(403).json({ error: '管理者のみタスクを削除できます' });
  }

  const tasks = await readAll('tasks');
  const next = tasks.filter((t) => t.id !== req.params.id);
  if (next.length === tasks.length) {
    return res.status(404).json({ error: 'タスクが見つかりません' });
  }
  await writeAll('tasks', next);
  res.status(204).end();
});

module.exports = router;
