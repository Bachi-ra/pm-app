import { db, ensureSignedIn, currentUid } from './firebaseClient.js';
import { STATUS_LIST, PRIORITY_LIST, VERSION_STATUS_LIST, ASSET_TYPE_LIST, RENDER_STATUS_LIST } from './utils.js';
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
  query,
  where,
  writeBatch,
  arrayUnion,
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

// ---- notification settings (締切リマインド) ----

async function getNotificationSettings() {
  await ensureSignedIn();
  const snap = await getDoc(doc(db, 'meta', 'notifications'));
  return snap.exists() ? snap.data() : { discordWebhookUrl: '' };
}

async function updateDiscordWebhookUrl(url) {
  await ensureSignedIn();
  await setDoc(doc(db, 'meta', 'notifications'), { discordWebhookUrl: (url || '').trim() }, { merge: true });
}

// その日まだ誰も送っていなければ「自分が送る」と宣言する(トランザクションで
// 早い者勝ちにし、複数人が同時にアプリを開いても重複送信されないようにする)。
async function claimDailyDiscordNotification(today) {
  await ensureSignedIn();
  const ref = doc(db, 'meta', 'notifications');
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data() : {};
    if (current.lastDiscordNotifyDate === today) return false;
    tx.set(ref, { ...current, lastDiscordNotifyDate: today }, { merge: true });
    return true;
  });
}

// まだこのタスクについて1週間前通知を送っていなければ「自分が送る」と宣言する
// (claimDailyDiscordNotificationと同じ、トランザクションによる早い者勝ち)。
async function claimTaskWeekBeforeNotification(taskId) {
  await ensureSignedIn();
  const ref = doc(db, 'tasks', taskId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().discordNotifiedWeekBefore === true) return false;
    tx.update(ref, { discordNotifiedWeekBefore: true });
    return true;
  });
}

// ---- progress snapshots (バーンダウンチャート) ----

async function getProgressSnapshots() {
  return getAll('progressSnapshots');
}

// 日付をドキュメントIDにして、その日にアプリを開いた誰かが最新の集計値で
// 上書きする(過去の日付のスナップショットは日付が変わるので書き換わらない)。
async function upsertProgressSnapshot(data) {
  await ensureSignedIn();
  await setDoc(doc(db, 'progressSnapshots', data.date), {
    date: data.date,
    remainingCount: data.remainingCount,
    totalCount: data.totalCount,
    avgProgress: data.avgProgress,
  });
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
    priority: PRIORITY_LIST.includes(data.priority) ? data.priority : '中',
    dependsOn: Array.isArray(data.dependsOn) ? data.dependsOn.filter((id) => typeof id === 'string') : [],
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
  if (data.priority !== undefined) payload.priority = PRIORITY_LIST.includes(data.priority) ? data.priority : '中';
  if (data.dependsOn !== undefined) {
    payload.dependsOn = Array.isArray(data.dependsOn)
      ? data.dependsOn.filter((depId) => typeof depId === 'string' && depId !== id)
      : [];
  }

  const nextStart = payload.startDate !== undefined ? payload.startDate : target.startDate;
  const nextEnd = payload.endDate !== undefined ? payload.endDate : target.endDate;
  if (nextStart > nextEnd) throw new Error('開始日は終了日より前にしてください');

  return updateDocFields('tasks', id, payload);
}

async function deleteTask(id) {
  return removeDoc('tasks', id);
}

// ---- task comments ----

async function getTaskComments(taskId) {
  await ensureSignedIn();
  const q = query(collection(db, 'taskComments'), where('taskId', '==', taskId));
  const snap = await getDocs(q);
  return snap.docs.map(toObj);
}

async function createTaskComment(taskId, data) {
  const text = (data.text || '').trim();
  if (!text) throw new Error('コメントを入力してください');
  if (!data.authorMemberId) throw new Error('投稿者が特定できません');

  const payload = {
    taskId,
    authorMemberId: data.authorMemberId,
    text,
    createdAt: new Date().toISOString(),
  };
  return createDoc('taskComments', payload);
}

async function updateTaskComment(id, data) {
  const payload = {};
  if (data.text !== undefined) {
    const text = String(data.text).trim();
    if (!text) throw new Error('コメントを入力してください');
    payload.text = text;
  }
  return updateDocFields('taskComments', id, payload);
}

async function deleteTaskComment(id) {
  return removeDoc('taskComments', id);
}

// ---- versions (カット/バージョン管理) ----

async function getVersions(taskId) {
  await ensureSignedIn();
  const q = query(collection(db, 'versions'), where('taskId', '==', taskId));
  const snap = await getDocs(q);
  return snap.docs.map(toObj);
}

async function createVersion(taskId, data) {
  const versionLabel = (data.versionLabel || '').trim();
  if (!versionLabel) throw new Error('バージョン名は必須です');
  if (!data.createdBy) throw new Error('投稿者が特定できません');

  const url = (data.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw new Error('URLはhttp(s)://から始めてください');

  const payload = {
    taskId,
    versionLabel,
    url,
    note: (data.note || '').trim(),
    status: VERSION_STATUS_LIST.includes(data.status) ? data.status : 'レビュー待ち',
    createdBy: data.createdBy,
    createdAt: new Date().toISOString(),
  };
  return createDoc('versions', payload);
}

async function updateVersionStatus(id, status) {
  if (!VERSION_STATUS_LIST.includes(status)) throw new Error('不正なステータスです');
  return updateDocFields('versions', id, { status });
}

async function deleteVersion(id) {
  return removeDoc('versions', id);
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
    readBy: [data.authorId],
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

async function markMemoRead(memoId, memberId) {
  await ensureSignedIn();
  await updateDoc(doc(db, 'memos', memoId), { readBy: arrayUnion(memberId) });
}

// ---- render jobs (共有PC/レンダーキュー) ----

async function getRenderJobs() {
  return getAll('renderJobs');
}

async function createRenderJob(data) {
  const pcName = (data.pcName || '').trim();
  const title = (data.title || '').trim();
  if (!pcName) throw new Error('PC名は必須です');
  if (!title) throw new Error('内容は必須です');
  if (!data.memberId) throw new Error('登録者が特定できません');

  const payload = {
    pcName,
    memberId: data.memberId,
    title,
    startedAt: new Date().toISOString(),
    estimatedEndAt: data.estimatedEndAt || null,
    status: '実行中',
    note: (data.note || '').trim(),
  };
  return createDoc('renderJobs', payload);
}

async function updateRenderJob(id, data) {
  const payload = {};
  if (data.status !== undefined) {
    if (!RENDER_STATUS_LIST.includes(data.status)) throw new Error('不正なステータスです');
    payload.status = data.status;
  }
  if (data.note !== undefined) payload.note = String(data.note).trim();
  if (data.estimatedEndAt !== undefined) payload.estimatedEndAt = data.estimatedEndAt || null;
  return updateDocFields('renderJobs', id, payload);
}

async function deleteRenderJob(id) {
  return removeDoc('renderJobs', id);
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

// ---- assets (素材・権利管理) ----

async function getAssets() {
  return getAll('assets');
}

async function createAsset(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('名前は必須です');

  const payload = {
    name,
    type: ASSET_TYPE_LIST.includes(data.type) ? data.type : 'その他',
    source: (data.source || '').trim(),
    license: (data.license || '').trim(),
    usedInTaskId: data.usedInTaskId || null,
    note: (data.note || '').trim(),
  };
  return createDoc('assets', payload);
}

async function updateAsset(id, data) {
  const payload = {};
  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw new Error('名前は必須です');
    payload.name = name;
  }
  if (data.type !== undefined) payload.type = ASSET_TYPE_LIST.includes(data.type) ? data.type : 'その他';
  if (data.source !== undefined) payload.source = String(data.source).trim();
  if (data.license !== undefined) payload.license = String(data.license).trim();
  if (data.usedInTaskId !== undefined) payload.usedInTaskId = data.usedInTaskId || null;
  if (data.note !== undefined) payload.note = String(data.note).trim();
  return updateDocFields('assets', id, payload);
}

async function deleteAsset(id) {
  return removeDoc('assets', id);
}

// ---- references (絵コンテ/参考資料ギャラリー) ----

function sanitizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

async function getReferences() {
  return getAll('references');
}

async function createReference(data) {
  const title = (data.title || '').trim();
  const imageUrl = (data.imageUrl || '').trim();
  if (!title) throw new Error('タイトルは必須です');
  if (!imageUrl) throw new Error('画像URLは必須です');
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error('画像URLはhttp(s)://から始めてください');
  if (!data.uploadedBy) throw new Error('投稿者が特定できません');

  const payload = {
    title,
    imageUrl,
    note: (data.note || '').trim(),
    tags: sanitizeTags(data.tags),
    uploadedBy: data.uploadedBy,
    createdAt: new Date().toISOString(),
  };
  return createDoc('references', payload);
}

async function updateReference(id, data) {
  const payload = {};
  if (data.title !== undefined) {
    const title = String(data.title).trim();
    if (!title) throw new Error('タイトルは必須です');
    payload.title = title;
  }
  if (data.imageUrl !== undefined) {
    const imageUrl = String(data.imageUrl).trim();
    if (!imageUrl) throw new Error('画像URLは必須です');
    if (!/^https?:\/\//i.test(imageUrl)) throw new Error('画像URLはhttp(s)://から始めてください');
    payload.imageUrl = imageUrl;
  }
  if (data.note !== undefined) payload.note = String(data.note).trim();
  if (data.tags !== undefined) payload.tags = sanitizeTags(data.tags);
  return updateDocFields('references', id, payload);
}

async function deleteReference(id) {
  return removeDoc('references', id);
}

// ---- データのJSONバックアップ/インポート ----

const BACKUP_COLLECTIONS = [
  'members',
  'tasks',
  'milestones',
  'memos',
  'links',
  'assets',
  'references',
  'taskComments',
  'versions',
  'progressSnapshots',
];

async function exportAllData() {
  await ensureSignedIn();
  const collections = {};
  for (const col of BACKUP_COLLECTIONS) {
    collections[col] = await getAll(col);
  }
  return { exportedAt: new Date().toISOString(), collections };
}

async function deleteAllDocs(colName) {
  const existing = await getAll(colName);
  for (let i = 0; i < existing.length; i += 400) {
    const batch = writeBatch(db);
    for (const item of existing.slice(i, i + 400)) {
      batch.delete(doc(db, colName, item.id));
    }
    await batch.commit();
  }
}

async function writeAllDocs(colName, records) {
  for (let i = 0; i < records.length; i += 400) {
    const batch = writeBatch(db);
    for (const item of records.slice(i, i + 400)) {
      const { id, ...fields } = item;
      if (!id) continue;
      batch.set(doc(db, colName, id), fields);
    }
    await batch.commit();
  }
}

// バックアップの各コレクションを、既存データを全削除してから書き戻す形で復元する。
// 元のドキュメントIDを保持するので、タスクの依存関係やコメントの紐付けは維持される。
//
// membersだけは例外で、削除はせずバックアップの内容で上書き(無ければ作成)するだけに
// している。理由: 復元中に自分自身のmemberドキュメントが一瞬でも消えると、
// 「管理者かどうか」の判定(Firestoreルール側)ができなくなり、復元処理自体が
// 続行不能になるため。副作用として、バックアップ後に追加されたメンバーは
// インポートしても削除されない(手動でメンバータブから削除してください)。
async function importAllData(backup) {
  await ensureSignedIn();
  if (!backup || typeof backup !== 'object' || !backup.collections) {
    throw new Error('バックアップファイルの形式が正しくありません');
  }

  const memberRecords = Array.isArray(backup.collections.members) ? backup.collections.members : [];
  await writeAllDocs('members', memberRecords);

  // members復元後は「現在の管理者数」が実データとズレるため、meta/appInfoも合わせて更新する
  // (ズレたままだと「最後の管理者は削除できません」の判定が正しく働かなくなるため)。
  const adminCount = Math.max(memberRecords.filter((m) => m.isAdmin).length, 1);
  await setDoc(doc(db, 'meta', 'appInfo'), { bootstrapped: true, adminCount }, { merge: true });

  for (const col of BACKUP_COLLECTIONS) {
    if (col === 'members') continue;
    const records = Array.isArray(backup.collections[col]) ? backup.collections[col] : [];
    await deleteAllDocs(col);
    await writeAllDocs(col, records);
  }
}

export const api = {
  getMyClaim,
  claimMember,
  clearMyClaim,
  getNotificationSettings,
  updateDiscordWebhookUrl,
  claimDailyDiscordNotification,
  claimTaskWeekBeforeNotification,
  getProgressSnapshots,
  upsertProgressSnapshot,
  getMembers,
  createMember,
  updateMember,
  deleteMember,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getTaskComments,
  createTaskComment,
  updateTaskComment,
  deleteTaskComment,
  getVersions,
  createVersion,
  updateVersionStatus,
  deleteVersion,
  getMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  getMemos,
  createMemo,
  updateMemo,
  deleteMemo,
  markMemoRead,
  getRenderJobs,
  createRenderJob,
  updateRenderJob,
  deleteRenderJob,
  getLinks,
  createLink,
  updateLink,
  deleteLink,
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  getReferences,
  createReference,
  updateReference,
  deleteReference,
  exportAllData,
  importAllData,
};
