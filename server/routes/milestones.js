const express = require('express');
const crypto = require('crypto');
const { readAll, writeAll } = require('../dataStore');
const { resolveActingMember } = require('../auth');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(await readAll('milestones'));
}));

router.post('/', asyncHandler(async (req, res) => {
  const actingMember = await resolveActingMember(req);
  if (!actingMember || !actingMember.isAdmin) {
    return res.status(403).json({ error: '管理者のみマイルストーンを追加できます' });
  }

  const { title, date } = req.body;
  if (!title || !title.trim() || !date) {
    return res.status(400).json({ error: 'タイトルと日付は必須です' });
  }

  const milestone = { id: crypto.randomUUID(), title: title.trim(), date };
  const milestones = await readAll('milestones');
  milestones.push(milestone);
  await writeAll('milestones', milestones);
  res.status(201).json(milestone);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const actingMember = await resolveActingMember(req);
  if (!actingMember || !actingMember.isAdmin) {
    return res.status(403).json({ error: '管理者のみマイルストーンを編集できます' });
  }

  const milestones = await readAll('milestones');
  const target = milestones.find((m) => m.id === req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'マイルストーンが見つかりません' });
  }
  if (req.body.title !== undefined) target.title = String(req.body.title).trim();
  if (req.body.date !== undefined) target.date = req.body.date;

  await writeAll('milestones', milestones);
  res.json(target);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const actingMember = await resolveActingMember(req);
  if (!actingMember || !actingMember.isAdmin) {
    return res.status(403).json({ error: '管理者のみマイルストーンを削除できます' });
  }

  const milestones = await readAll('milestones');
  const next = milestones.filter((m) => m.id !== req.params.id);
  if (next.length === milestones.length) {
    return res.status(404).json({ error: 'マイルストーンが見つかりません' });
  }
  await writeAll('milestones', next);
  res.status(204).end();
}));

module.exports = router;
