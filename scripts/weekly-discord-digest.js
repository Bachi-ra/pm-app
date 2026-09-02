// チーム全体の進捗まとめを週1回Discordに自動投稿するスクリプト。
// GitHub Actions(.github/workflows/weekly-digest.yml)から定期実行される。
//
// サービスアカウントの読み込み:
//   CI(GitHub Actions): 環境変数 FIREBASE_SERVICE_ACCOUNT_JSON にJSON文字列として設定
//   ローカル実行: FIREBASE_SERVICE_ACCOUNT_KEY_PATH、または未設定ならプロジェクト直下の
//                 serviceAccountKey.json(migrate-mongo-to-firestore.jsと同じもの)を使用
//
// 実行:
//   node scripts/weekly-discord-digest.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const keyPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(keyPath)) {
    console.error(`Firebaseのサービスアカウントキーが見つかりません: ${keyPath}`);
    console.error(
      '環境変数 FIREBASE_SERVICE_ACCOUNT_JSON にJSON文字列を設定するか、プロジェクト直下に'
    );
    console.error('serviceAccountKey.json を配置してください。');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

function buildDigestMessage(tasks, milestones, today) {
  const counts = { 未着手: 0, 進行中: 0, 完了: 0 };
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;

  const overdueTasks = tasks
    .filter((t) => t.status !== '完了' && t.endDate && t.endDate < today)
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));

  const upcomingMilestones = milestones
    .filter((m) => m.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 2);

  const lines = [];
  lines.push('【週次進捗まとめ】');
  lines.push(`未着手: ${counts['未着手']}件 / 進行中: ${counts['進行中']}件 / 完了: ${counts['完了']}件`);
  lines.push('');

  if (overdueTasks.length > 0) {
    lines.push(`■ 期限超過タスク (${overdueTasks.length}件)`);
    for (const t of overdueTasks.slice(0, 10)) {
      lines.push(`・${t.title}(締切: ${formatDate(t.endDate)})`);
    }
    if (overdueTasks.length > 10) lines.push(`他 ${overdueTasks.length - 10}件`);
  } else {
    lines.push('■ 期限超過タスクはありません');
  }
  lines.push('');

  if (upcomingMilestones.length > 0) {
    lines.push('■ 直近のマイルストーン');
    for (const m of upcomingMilestones) {
      lines.push(`・${formatDate(m.date)} ${m.title}`);
    }
  } else {
    lines.push('■ 直近のマイルストーンはありません');
  }

  return lines.join('\n');
}

async function main() {
  const serviceAccount = loadServiceAccount();
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const firestore = admin.firestore();

  const [tasksSnap, milestonesSnap, notificationsSnap] = await Promise.all([
    firestore.collection('tasks').get(),
    firestore.collection('milestones').get(),
    firestore.collection('meta').doc('notifications').get(),
  ]);

  const webhookUrl = notificationsSnap.exists ? notificationsSnap.data().discordWebhookUrl : null;
  if (!webhookUrl) {
    console.log('Discord Webhook URLが設定されていないため、何もせず終了します。');
    return;
  }

  const tasks = tasksSnap.docs.map((d) => d.data());
  const milestones = milestonesSnap.docs.map((d) => d.data());
  const content = buildDigestMessage(tasks, milestones, todayIso());

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discordへの投稿に失敗しました(status ${res.status})`);
  }

  console.log('週次進捗まとめをDiscordに投稿しました。');
}

main().catch((err) => {
  console.error('週次進捗まとめの投稿に失敗しました:', err);
  process.exit(1);
});
