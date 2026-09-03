// チーム全体の進捗まとめ、および各メンバー個人の担当タスク・進捗まとめを
// 週1回Discordに自動投稿するスクリプト。
// GitHub Actions(.github/workflows/weekly-digest.yml)から定期実行される。
// 個人宛の投稿は、そのメンバーのドキュメントに discordWebhookUrl が
// 設定されている場合のみ行われる(メンバー管理画面から設定可能)。
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

const EVERYONE_ROLE = '全員';

// メンバーの役職一覧を返す。新形式のroles(配列)を優先し、旧形式の
// role(単一文字列)しか無いメンバーはそれを1件配列として扱う
// (docs/js/utils.js の memberRoles() と同じ考え方)。
function memberRoles(member) {
  if (!member) return [];
  if (Array.isArray(member.roles)) {
    return member.roles.map((r) => String(r).trim()).filter(Boolean);
  }
  if (member.role) {
    return [String(member.role).trim()].filter(Boolean);
  }
  return [];
}

function isAssignedToMember(task, member) {
  if (!task.assigneeRole) return false;
  if (task.assigneeRole === EVERYONE_ROLE) return true;
  return memberRoles(member).includes(task.assigneeRole);
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

function buildPersonalDigestMessage(member, tasks, today) {
  const mine = tasks.filter((t) => isAssignedToMember(t, member));
  const lines = [`【${member.name}さんの担当タスクまとめ】`];

  if (mine.length === 0) {
    lines.push('現在担当中のタスクはありません。');
    return lines.join('\n');
  }

  const notDone = mine.filter((t) => t.status !== '完了');
  const doneCount = mine.length - notDone.length;
  lines.push(`担当タスク: ${mine.length}件(完了 ${doneCount}件)`);
  lines.push('');

  const overdue = notDone
    .filter((t) => t.endDate && t.endDate < today)
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
  const others = notDone
    .filter((t) => !(t.endDate && t.endDate < today))
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));

  if (overdue.length > 0) {
    lines.push(`■ 期限超過 (${overdue.length}件)`);
    for (const t of overdue) {
      lines.push(`・${t.title}(締切: ${formatDate(t.endDate)} / 進捗${t.progress}% / ${t.status})`);
    }
    lines.push('');
  }

  if (others.length > 0) {
    lines.push(`■ 進行中・未着手 (${others.length}件)`);
    for (const t of others.slice(0, 15)) {
      lines.push(`・${t.title}(締切: ${formatDate(t.endDate)} / 進捗${t.progress}% / ${t.status})`);
    }
    if (others.length > 15) lines.push(`他 ${others.length - 15}件`);
  } else if (overdue.length === 0) {
    lines.push('進行中・未着手のタスクはありません。お疲れ様でした!');
  }

  return lines.join('\n');
}

async function postToDiscord(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discordへの投稿に失敗しました(status ${res.status})`);
  }
}

async function main() {
  const serviceAccount = loadServiceAccount();
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const firestore = admin.firestore();

  const [tasksSnap, milestonesSnap, notificationsSnap, membersSnap] = await Promise.all([
    firestore.collection('tasks').get(),
    firestore.collection('milestones').get(),
    firestore.collection('meta').doc('notifications').get(),
    firestore.collection('members').get(),
  ]);

  const tasks = tasksSnap.docs.map((d) => d.data());
  const milestones = milestonesSnap.docs.map((d) => d.data());
  const members = membersSnap.docs.map((d) => d.data());
  const today = todayIso();

  let hadError = false;

  const teamWebhookUrl = notificationsSnap.exists ? notificationsSnap.data().discordWebhookUrl : null;
  if (teamWebhookUrl) {
    try {
      await postToDiscord(teamWebhookUrl, buildDigestMessage(tasks, milestones, today));
      console.log('週次進捗まとめ(チーム全体)をDiscordに投稿しました。');
    } catch (err) {
      hadError = true;
      console.error('チーム全体の週次進捗まとめの投稿に失敗しました:', err);
    }
  } else {
    console.log('チーム全体のDiscord Webhook URLが設定されていないため、チーム宛の投稿はスキップします。');
  }

  const membersWithWebhook = members.filter((m) => m.discordWebhookUrl);
  if (membersWithWebhook.length === 0) {
    console.log('個人のDiscord Webhook URLが設定されているメンバーがいないため、個人宛の投稿はスキップします。');
  }
  for (const member of membersWithWebhook) {
    try {
      await postToDiscord(member.discordWebhookUrl, buildPersonalDigestMessage(member, tasks, today));
      console.log(`個人宛の進捗まとめを投稿しました: ${member.name}`);
    } catch (err) {
      hadError = true;
      console.error(`個人宛の進捗まとめの投稿に失敗しました(${member.name}):`, err);
    }
  }

  if (hadError) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('週次進捗まとめの投稿に失敗しました:', err);
  process.exit(1);
});
