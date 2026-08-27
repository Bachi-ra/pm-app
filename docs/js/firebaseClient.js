import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Firebaseコンソール(プロジェクトの設定 → マイアプリ)で発行される設定値に置き換えてください。
// apiKeyなどは公開されても問題ない値です(実際のアクセス制御はFirestoreのセキュリティルールで行います)。
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

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
