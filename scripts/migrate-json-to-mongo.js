// server/data/*.json の内容を MongoDB Atlas に一括投入するワンショットスクリプト。
// 事前に .env で MONGODB_URI を設定してから、1回だけ実行してください。
//   node scripts/migrate-json-to-mongo.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const COLLECTIONS = ['members', 'tasks', 'milestones'];
const DATA_DIR = path.join(__dirname, '..', 'server', 'data');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI が設定されていません。.env を確認してください。');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'pmapp');

  for (const name of COLLECTIONS) {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`${name}: ファイルが見つからないためスキップします`);
      continue;
    }

    const records = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
    const col = db.collection(name);
    await col.deleteMany({});
    if (records.length > 0) {
      await col.insertMany(records);
    }
    console.log(`${name}: ${records.length}件を移行しました`);
  }

  await client.close();
  console.log('移行が完了しました');
}

main().catch((err) => {
  console.error('移行に失敗しました:', err);
  process.exit(1);
});
