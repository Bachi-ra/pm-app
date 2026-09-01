import { db, ensureSignedIn, currentUid } from './firebaseClient.js';
import { STATUS_LIST } from './utils.js';
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

function toObj(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

async function getAll(colName) {
  await ensureSignedIn();
  const snap = await getDocs(collection(db, colName));
  return snap.docs.map(toObj);
}

async function createDoc(colName, payload) {
  await ensureSignedIn();
  const ref = await addDoc(collection(db, colName), payload);
  return { id: ref.id, ...payload };
}

async function updateDocFields(colName, id, payload) {
  await ensureSignedIn();
  const ref = doc(db, colName, id);
  await updateDoc(ref, payload);
  const snap = await getDoc(ref);
  return toObj(snap);
}

async function removeDoc(colName, id) {
  await ensureSignedIn();
  await deleteDoc(doc(db, colName, id));
  return null;
}

function clampProgress(value, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function genId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeChecklist(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item.text === 'string' && item.text.trim())
    .map((item) => ({
      id: String(item.id || genId()),
      text: String(item.text).trim(),
      done: Boolean(item.done),
    }));
}

// ---- identity (どの匿名セッションがどのメンバーか) ----

async function getMyClaim() {
  await ensureSignedIn();
  const uid = await currentUid();
  const snap = await getDoc(doc(db, 'memberClaims', uid));
  return snap.exists() ? snap.data() : null;
}

async function claimMember(memberId) {
  await ensureSignedIn();
  const uid = await currentUid();
  const metaSnap = await getDoc(doc(db, 'meta', 'appInfo'));

  if (metaSnap.exists()) {
    await setDoc(doc(db, 'memberClaims', uid), { memberId });
    return;
  }

  // meta/appInfo がまだ無い = このFirestoreルールを公開した直後、まだ誰も
  // ログインし直していない状態。既存メンバーの管理者数を数えて、
  // 一度きりの移行としてmeta/appInfoを補完しつつ自分の紐付けも作成する。
  const members = await getAll('members');
  const adminCount = Math.max(members.filter((m) => m.isAdmin).length, 1);
  await runTransaction(db, async (tx) => {
    const metaRef = doc(db, 'meta', 'appInfo');
    const check = await tx.get(metaRef);
    if (!check.exists()) {
      tx.set(metaRef, { bootstrapped: true, adminCount });
    }
    tx.set(doc(db, 'memberClaims', uid), { memberId });
  });
}

async function clearMyClaim() {
  await ensureSignedIn();
  const uid = await currentUid();
  await deleteDoc(doc(db, 'memberClaims', uid));
}

// ---- members ----

async function getMembers() {
  return getAll('members');
}

async function createMember(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('名前は必須です');
  await ensureSignedIn();

  const members = await getAll('members');
  const isBootstrap = members.length === 0;

  const payload = {
    name,
    role: (data.role || '').trim(),
    isAdmin: isBootstrap ? true : Boolean(data.isAdmin),
  };

  if (!isBootstrap) {
    return createDoc('members', payload);
  }

  // 最初の管理者登録は、members / memberClaims / meta/appInfo をまとめて
  // 1つのトランザクションで作成し、複数人が同時に開いても矛盾が起きないようにする。
  const uid = await currentUid();
  const memberRef = doc(collection(db, 'members'));
  await runTransaction(db, async (tx) => {
    tx.set(doc(db, 'meta', 'appInfo'), { bootstrapped: true, adminCount: 1 });
    tx.set(memberRef, payload);
    tx.set(doc(db, 'memberClaims', uid), { memberId: memberRef.id });
  });
  return { id: memberRef.id, ...payload };
}

async function updateMember(id, data) {
  await ensureSignedIn();
  const ref = doc(db, 'members', id);
  const metaRef = doc(db, 'meta', 'appInfo');

  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('メンバーが見つかりません');
    const target = snap.data();

    const metaSnap = await tx.get(metaRef);
    const meta = metaSnap.exists() ? metaSnap.data() : { adminCount: target.isAdmin ? 1 : 0 };

    const wasAdmin = Boolean(target.isAdmin);
    const willBeAdmin = data.isAdmin !== undefined ? Boolean(data.isAdmin) : wasAdmin;

    let nextAdminCount = meta.adminCount;
    if (wasAdmin && !willBeAdmin) nextAdminCount -= 1;
    if (!wasAdmin && willBeAdmin) nextAdminCount += 1;

    if (wasAdmin && !willBeAdmin && nextAdminCount < 1) {
      throw new Error('最後の管理者の権限は外せません');
    }

    const payload = { isAdmin: willBeAdmin };
    if (data.name !== undefined) payload.name = String(data.name).trim();
    if (data.role !== undefined) payload.role = String(data.role).trim();

    tx.update(ref, payload);
    if (nextAdminCount !== meta.adminCount || !metaSnap.exists()) {
      tx.set(metaRef, { ...meta, adminCount: nextAdminCount }, { merge: true });
    }

    return { id, ...target, ...payload };
  });

  return result;
}

async function deleteMember(id) {
  await ensureSignedIn();
  const ref = doc(db, 'members', id);
  const metaRef = doc(db, 'meta', 'appInfo');

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('メンバーが見つかりません');
    const target = snap.data();

    const metaSnap = await tx.get(metaRef);
    const meta = metaSnap.exists() ? metaSnap.data() : { adminCount: target.isAdmin ? 1 : 0 };

    if (target.isAdmin && meta.adminCount <= 1) {
      throw new Error('最後の管理者は削除できません');
    }

    tx.delete(ref);
    if (target.isAdmin) {
      tx.set(metaRef, { ...meta, adminCount: meta.adminCount - 1 }, { merge: true });
    }
  });

  return null;
}

// ---- tasks ----

async function getTasks() {
  return getAll('tasks');
}

async function createTask(data) {
  const title = (data.title || '').trim();
  if (!title) throw new Error('タイトルは必須です');
  if (!data.startDate || !data.endDate) throw new Error('開始日と終了日は必須です');
  if (data.startDate > data.endDate) throw new Error('開始日は終了日より前にしてください');

  const status = STATUS_LIST.includes(data.status) ? data.status : '未着手';

  const payload = {
    title,
    description: (data.description || '').trim(),
    category: (data.category || '未分類').trim(),
    assigneeRole: (data.assigneeRole || '').trim() || null,
    status,
    progress: status === '完了' ? 100 : clampProgress(data.progress, 0),
    startDate: data.startDate,
    endDate: data.endDate,
    checklist: sanitizeChecklist(data.checklist),
  };
  return createDoc('tasks', payload);
}

async function updateTask(id, data) {
  const tasks = await getAll('tasks');
  const target = tasks.find((t) => t.id === id);
  if (!target) throw new Error('タスクが見つかりません');

  const payload = {};
  let nextProgress = target.progress;

  if (data.status !== undefined) {
    if (!STATUS_LIST.includes(data.status)) throw new Error('不正なステータスです');
    payload.status = data.status;
    if (data.status === '完了') nextProgress = 100;
  }
  if (data.progress !== undefined) {
    nextProgress = clampProgress(data.progress, nextProgress);
  }
  if (payload.status !== undefined || data.progress !== undefined) {
    payload.progress = nextProgress;
  }

  if (data.title !== undefined) payload.title = String(data.title).trim();
  if (data.description !== undefined) payload.description = String(data.description).trim();
  if (data.category !== undefined) payload.category = String(data.category).trim() || '未分類';
  if (data.assigneeRole !== undefined) payload.assigneeRole = String(data.assigneeRole).trim() || null;
  if (data.startDate !== undefined) payload.startDate = data.startDate;
  if (data.endDate !== undefined) payload.endDate = data.endDate;
  if (data.checklist !== undefined) payload.checklist = sanitizeChecklist(data.checklist);

  const nextStart = payload.startDate !== undefined ? payload.startDate : target.startDate;
  const nextEnd = payload.endDate !== undefined ? payload.endDate : target.endDate;
  if (nextStart > nextEnd) throw new Error('開始日は終了日より前にしてください');

  return updateDocFields('tasks', id, payload);
}

async function deleteTask(id) {
  return removeDoc('tasks', id);
}

// ---- milestones ----

async function getMilestones() {
  return getAll('milestones');
}

async function createMilestone(data) {
  const title = (data.title || '').trim();
  if (!title || !data.date) throw new Error('タイトルと日付は必須です');
  return createDoc('milestones', { title, date: data.date });
}

async function updateMilestone(id, data) {
  const payload = {};
  if (data.title !== undefined) payload.title = String(data.title).trim();
  if (data.date !== undefined) payload.date = data.date;
  return updateDocFields('milestones', id, payload);
}

async function deleteMilestone(id) {
  return removeDoc('milestones', id);
}

// ---- memos ----

async function getMemos() {
  return getAll('memos');
}

async function createMemo(data) {
  const content = (data.content || '').trim();
  if (!content) throw new Error('内容は必須です');
  if (!data.authorId) throw new Error('投稿者が特定できません');

  const payload = {
    authorId: data.authorId,
    content,
    createdAt: new Date().toISOString(),
  };
  return createDoc('memos', payload);
}

async function updateMemo(id, data) {
  const payload = {};
  if (data.content !== undefined) {
    const content = String(data.content).trim();
    if (!content) throw new Error('内容は必須です');
    payload.content = content;
  }
  return updateDocFields('memos', id, payload);
}

async function deleteMemo(id) {
  return removeDoc('memos', id);
}

// ---- links ----

async function getLinks() {
  return getAll('links');
}

async function createLink(data) {
  const title = (data.title || '').trim();
  const url = (data.url || '').trim();
  if (!title || !url) throw new Error('名前とURLは必須です');
  if (!/^https?:\/\//i.test(url)) throw new Error('URLはhttp(s)://から始めてください');

  const payload = {
    title,
    url,
    category: (data.category || 'その他').trim() || 'その他',
    note: (data.note || '').trim(),
  };
  return createDoc('links', payload);
}

async function updateLink(id, data) {
  const payload = {};
  if (data.title !== undefined) {
    const title = String(data.title).trim();
    if (!title) throw new Error('名前は必須です');
    payload.title = title;
  }
  if (data.url !== undefined) {
    const url = String(data.url).trim();
    if (!url) throw new Error('URLは必須です');
    if (!/^https?:\/\//i.test(url)) throw new Error('URLはhttp(s)://から始めてください');
    payload.url = url;
  }
  if (data.category !== undefined) payload.category = String(data.category).trim() || 'その他';
  if (data.note !== undefined) payload.note = String(data.note).trim();
  return updateDocFields('links', id, payload);
}

async function deleteLink(id) {
  return removeDoc('links', id);
}

export const api = {
  getMyClaim,
  claimMember,
  clearMyClaim,
  getMembers,
  createMember,
  updateMember,
  deleteMember,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  getMemos,
  createMemo,
  updateMemo,
  deleteMemo,
  getLinks,
  createLink,
  updateLink,
  deleteLink,
};
