import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

// Firebaseコンソール(プロジェクトの設定 → マイアプリ)で発行される設定値に置き換えてください。
// apiKeyなどは公開されても問題ない値です(実際のアクセス制御はFirestoreのセキュリティルールで行います)。
const firebaseConfig = {
  apiKey: 'AIzaSyANZhOItAcSFEzS6nQmKHU9MnDvLWI3N2g',
  authDomain: 'pm-app-73a12.firebaseapp.com',
  projectId: 'pm-app-73a12',
  storageBucket: 'pm-app-73a12.firebasestorage.app',
  messagingSenderId: '954580475571',
  appId: '1:954580475571:web:18ffcaf5ee7104679b5ac6',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

const auth = getAuth(app);

let readyPromise = null;

export function ensureSignedIn() {
  if (!readyPromise) {
    readyPromise = signInAnonymously(auth).catch((err) => {
      readyPromise = null;
      throw new Error(
        `Firebaseへのサインインに失敗しました。Authenticationで匿名認証が有効か確認してください。 (${err.message})`
      );
    });
  }
  return readyPromise;
}

export async function currentUid() {
  await ensureSignedIn();
  return auth.currentUser.uid;
}
