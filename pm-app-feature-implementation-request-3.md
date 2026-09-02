# 卒制チームページ 機能追加 実装依頼書(3) — Discord通知の強化

このファイルをリポジトリのルートに置き、Claude Codeに
「このファイルを読んで、書いてある内容に沿って実装してください」
と伝えて使ってください。2つとも独立した機能なので、1つずつ順番に
依頼するのがおすすめです。

## 今回追加する2つの機能

1. タスクの期限が1週間を切ったとき、そのタスクについて1回だけ
   Discordに通知する
2. 週に1回、決まった曜日・時刻に、チーム全体の進捗まとめをDiscordに
   自動投稿する

どちらも**課金なし**で実現します。②はGitHub Actionsの無料枠を使い、
Firebase側は現状のSparkプラン(無料)のままで変更ありません。

## 前提・背景

- リポジトリ: `Bachi-ra/pm-app`(公開URL: https://bachi-ra.github.io/pm-app/）
- 構成: サーバーレス。ブラウザから直接Firebase Firestoreに接続。
  GitHub Pagesで `/docs` を配信。ビルドツールなし、素のES Modules
- 既存のDiscord連携: `meta/notifications` ドキュメントに
  `discordWebhookUrl` を保存(PMがリンク集タブの折りたたみメニューから
  設定)。`docs/js/dashboard.js` の `maybeSendDiscordNotification()` が、
  3日以内に締切の未完了タスクを1日1回まとめて `fetch(webhookUrl, {...})`
  でプレーンテキスト投稿している。この関数・仕組みには手を加えず、
  今回の2機能は**別の仕組みとして追加**する
- 既存のNode.jsスクリプト `scripts/migrate-mongo-to-firestore.js` は
  CommonJS(`require`)で書かれており、`firebase-admin` パッケージを
  使ってFirestoreにアクセスしている(サービスアカウントJSONを使って
  `admin.initializeApp({ credential: admin.credential.cert(...) })`)。
  今回追加するNode.jsスクリプトもこの流儀に合わせる
  (CommonJS、`firebase-admin` 経由でのアクセス)
- `package.json` に既に `firebase-admin` が依存関係として入っている

## ユーザー側の事前準備(Claude Codeの作業とは別に、あなた自身が行うこと)

①は既存の仕組みの延長なので追加の準備は不要です。②のために、以下の
2つだけ行ってください。

1. **Firebaseサービスアカウントキーの発行**
   Firebaseコンソール →「プロジェクトの設定」→「サービスアカウント」→
   「新しい秘密鍵の生成」でJSONファイルをダウンロードする
   (`scripts/migrate-mongo-to-firestore.js` の手順と同じもの)。
   このJSONの中身は**絶対にリポジトリにコミットしない**こと
2. **GitHub Secretsへの登録**
   リポジトリの Settings → Secrets and variables → Actions で、
   `FIREBASE_SERVICE_ACCOUNT_JSON` という名前のSecretを作り、
   1でダウンロードしたJSONファイルの中身をそのまま貼り付ける

## 進め方についての指示(Claude Codeへ)

1. 実装前に必ず現在のコード(`dashboard.js` / `api.js` / `utils.js` /
   `firestore.rules` / `scripts/migrate-mongo-to-firestore.js` /
   `package.json`)を読み、既存の命名規則・関数構成に合わせること
2. ①→②の順で1つずつ実装し、それぞれ動作確認・コミットしてから
   次に進める
3. サービスアカウントのJSONなど秘密情報は、コード中に直接書かず、
   必ず環境変数(ローカルは `.gitignore` 済みの `.env` やファイル、
   CI環境はGitHub Secrets)経由で読み込む
4. 各機能の実装が終わったら、READMEに簡潔に追記する
5. UIの文言・Discordへの投稿文言はすべて日本語

---

## 機能1: 期限1週間前の通知(タスクごとに1回)

**データモデル**: `tasks` の各ドキュメントに
`discordNotifiedWeekBefore: boolean`(デフォルト `false` または未設定)を
追加する。

**挙動**:
- 既存の3日前デイリーリマインド(`maybeSendDiscordNotification`)とは
  別に、新しい関数(例: `maybeSendWeekBeforeDiscordNotification`)を
  `dashboard.js` に追加する
- ダッシュボード表示時に、`残り日数 <= 7 かつ 0以上`・`status !== '完了'`・
  `discordNotifiedWeekBefore !== true` の条件を満たすタスクを抽出する
- 該当タスクがあれば、それぞれ(またはまとめて1通で複数列挙)
  `meta/notifications` の `discordWebhookUrl` 宛に
  「【1週間前通知】○○ の締切まであと△日です」のような内容で投稿する
- 送信後、そのタスクの `discordNotifiedWeekBefore` を `true` に更新する
  (以後そのタスクについては再送しない)

**firestore.rules**: `tasks` の既存 `update` ルールに、
「`discordNotifiedWeekBefore` のみを変更する場合は signedIn なら誰でも
許可」という例外を追加する(`meta/notifications` の
`lastDiscordNotifyDate` や、既存の `tasks` ルールと同じ
`diff(...).affectedKeys().hasOnly([...])` パターンを使う)。

---

## 機能2: 週次進捗まとめ(GitHub Actions)

**スクリプト**: 新規ファイル `scripts/weekly-discord-digest.js` を
CommonJSで作成する。`scripts/migrate-mongo-to-firestore.js` と同様に
`firebase-admin` を使うが、サービスアカウントは
`process.env.FIREBASE_SERVICE_ACCOUNT_JSON`(JSON文字列)から
`JSON.parse` して読み込めるようにする(CI環境でファイルパスを使えない
ため。ローカル実行時のためにファイルパス読み込みにもフォールバック
できると尚良い)。

スクリプトの内容:
- Firestoreから `tasks` / `milestones` / `meta/notifications`
  (`discordWebhookUrl` を取得するため)を読む
- 以下を含む進捗まとめメッセージを組み立てる:
  - ステータス別件数(未着手/進行中/完了)
  - 直近1週間で完了になったタスク数(可能であれば。難しければ省略可)
  - 締切を過ぎているのに未完了のタスク一覧
  - 直近のマイルストーン(次の1〜2件)
- `discordWebhookUrl` が設定されていれば、そこにPOSTする
  (未設定ならログを出して何もしない)

**GitHub Actionsワークフロー**: 新規ファイル
`.github/workflows/weekly-digest.yml` を作成する
- `on.schedule` に `cron: '0 0 * * 1'` を指定する
  (UTC 0:00 = JST 月曜9:00。GitHub Actionsのscheduleは実行時刻が
  多少前後する場合がある点に注意)
- `on.workflow_dispatch` も追加し、手動実行してテストできるようにする
- Node.jsをセットアップし、`npm install` 後に
  `node scripts/weekly-discord-digest.js` を実行する
- `env` に `FIREBASE_SERVICE_ACCOUNT_JSON: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}`
  を設定する

## 補足

- 2つとも独立しているので、①→②の順で1つずつ確認しながら進めてください
- どちらもブラウザ+Firestore+GitHub Actionsだけで完結し、今の設計の
  延長です。新しい外部サービスへの登録や課金プランの変更は不要です
- コマンドでタスク・スケジュールを確認する機能(Discordのスラッシュ
  コマンド)は、セットアップが少し複雑なため今回は見送っています。
  必要になったら改めて実装依頼書としてまとめます
