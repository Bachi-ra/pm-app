const dns = require('dns');
const { MongoClient } = require('mongodb');

// RenderなどのホスティングではDNS解決がIPv6を優先し、Atlas側とのTLSハンドシェイクが
// "tlsv1 alert internal error" で失敗することがある。IPv4を優先させて回避する。
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {
  // Node のバージョンによっては存在しないため無視して問題ない
}

let client;
let dbPromise;

function connect() {
  if (dbPromise) return dbPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return Promise.reject(
      new Error('MONGODB_URI が設定されていません(.env またはホスティング先の環境変数を確認してください)')
    );
  }

  client = new MongoClient(uri, { family: 4 });
  dbPromise = client
    .connect()
    .then(() => client.db(process.env.MONGODB_DB || 'pmapp'))
    .catch((err) => {
      // 接続失敗を永久にキャッシュしない。次回呼び出しで再接続を試みられるようにする
      dbPromise = null;
      throw err;
    });
  return dbPromise;
}

async function getCollection(name) {
  const db = await connect();
  return db.collection(name);
}

async function readAll(name) {
  const col = await getCollection(name);
  return col.find({}, { projection: { _id: 0 } }).toArray();
}

async function writeAll(name, records) {
  const col = await getCollection(name);
  await col.deleteMany({});
  if (records.length > 0) {
    await col.insertMany(records);
  }
}

module.exports = { readAll, writeAll };
