import { storage, ensureSignedIn } from './firebaseClient.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024;

function sanitizeFileName(name) {
  return (name || 'file').replace(/[\\/:*?"<>|]/g, '_');
}

// references・assets・linksの添付ファイルをCloud Storageにアップロードし、
// Firestoreに保存する添付メタデータ(パス・ダウンロードURL・ファイル名など)を返す。
export async function uploadAttachment(folder, file) {
  if (!file) return null;
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error('ファイルサイズが大きすぎます(15MBまで)');
  }

  await ensureSignedIn();
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${sanitizeFileName(file.name)}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);

  return { path, url, fileName: file.name, size: file.size, contentType: file.type || '' };
}

// 添付ファイルの削除。既に消えている場合などは無視する(呼び出し元の処理は止めない)。
export async function deleteAttachment(path) {
  if (!path) return;
  try {
    await ensureSignedIn();
    await deleteObject(ref(storage, path));
  } catch (err) {
    // 既に削除済み・見つからない場合などは無視する
  }
}
