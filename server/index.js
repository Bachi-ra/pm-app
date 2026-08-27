require('dotenv').config();

const express = require('express');
const os = require('os');
const path = require('path');

const membersRouter = require('./routes/members');
const tasksRouter = require('./routes/tasks');
const milestonesRouter = require('./routes/milestones');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/members', membersRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/milestones', milestonesRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

function getLanUrls() {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${PORT}`);
      }
    }
  }
  return urls;
}

app.listen(PORT, () => {
  console.log('進行管理サーバーが起動しました');

  if (process.env.RENDER) {
    // クラウド(Render)上では外部URLはRenderのダッシュボードで確認する
    console.log(`ポート ${PORT} で待ち受け中です`);
    return;
  }

  console.log(`自分用URL:      http://localhost:${PORT}`);
  const lanUrls = getLanUrls();
  if (lanUrls.length > 0) {
    console.log('メンバー共有用URL (同じWi-Fi/LANに接続してアクセス):');
    lanUrls.forEach((url) => console.log(`  ${url}`));
  } else {
    console.log('LAN用のURLが見つかりませんでした。ネットワーク接続を確認してください。');
  }
});
