// Atlas(MongoDB)に入っている既存データをFirestoreへ一度だけ移行するスクリプト。
//
// 事前準備:
//   1. .env に MONGODB_URI(これまで使っていた接続文字列)を設定
//   2. Firebaseコンソール → プロジェクトの設定 → サービスアカウント →
//      「新しい秘密鍵の生成」でJSONをダウンロードし、
//      プロジェクト直下に serviceAccountKey.json として保存(.gitignore済み)
//
// 実行:
//   node scripts/migrate-mongo-to-firestore.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const admin = require('firebase-admin');

const COLLECTIONS = ['members', 'tasks', 'milestones'];

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI が設定されていません。.env を確認してください。');
    process.exit(1);
  }

  const keyPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(keyPath)) {
    console.error(`Firebaseのサービスアカウントキーが見つかりません: ${keyPath}`);
    console.error(
      'Firebaseコンソール → プロジェクトの設定 → サービスアカウント → 「新しい秘密鍵の生成」でダウンロードし、'
    );
    console.error('プロジェクト直下に serviceAccountKey.json として保存してください。');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const firestore = admin.firestore();

  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const mongoDb = mongoClient.db(process.env.MONGODB_DB || 'pmapp');

  for (const name of COLLECTIONS) {
    const records = await mongoDb
      .collection(name)
      .find({}, { projection: { _id: 0 } })
      .toArray();

    const existing = await firestore.collection(name).get();
    const batch = firestore.batch();
    existing.forEach((docSnap) => batch.delete(docSnap.ref));
    for (const record of records) {
      const { id, ...rest } = record;
      const ref = id ? firestore.collection(name).doc(id) : firestore.collection(name).doc();
      batch.set(ref, rest);
    }
    await batch.commit();
    console.log(`${name}: ${records.length}件を移行しました`);
  }

  await mongoClient.close();
  console.log('移行が完了しました');
}

main().catch((err) => {
  console.error('移行に失敗しました:', err);
  process.exit(1);
});
