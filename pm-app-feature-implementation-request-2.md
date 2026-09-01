# 卒制チームページ 機能追加 実装依頼書(2) — レンダーキュー / 既読管理 / ダークモード

このファイルをリポジトリのルートに置き、Claude Codeに
「このファイルを読んで、書いてある内容に沿って実装してください」
と伝えて使ってください。3つとも独立した機能なので、1つずつ順番に
依頼するのがおすすめです(例:「まずダークモードだけ実装して」)。

## 前提・背景

- リポジトリ: `Bachi-ra/pm-app`(公開URL: https://bachi-ra.github.io/pm-app/）
- 構成: サーバーレス。ブラウザから直接Firebase Firestoreに接続。
  GitHub Pagesで `/docs` を配信。ビルドツールなし、素のES Modules。
- 現在のタブ構成(`docs/js/app.js` の `TABS`):
  ダッシュボード / タスク一覧 / スケジュール / メンバー / メモ / リンク集 /
  素材 / 資料
- 現在のFirestoreコレクション: `members` / `tasks` / `milestones` /
  `memos` / `links` / `taskComments` / `versions` / `assets` /
  `references` / `memberClaims` / `progressSnapshots`、および
  `meta/appInfo` / `meta/notifications`
- 設計パターン: 各タブは `renderXxx(container, ctx)` という関数で描画され、
  `ctx` に `members` / `tasks` / `currentMember` / `isAdmin` / `api` /
  `refresh` / `goToTab` などが渡される。`docs/js/utils.js` に
  `escapeHtml` / `formatDate` / `formatDateTime` / `STATUS_LIST` /
  `PRIORITY_LIST` + `priorityColor()` / `VERSION_STATUS_LIST` +
  `versionStatusColor()` のような「一覧定数+色を返す関数」のペアが
  何組も定義されている。新しいステータス系の値もこのパターンに合わせる
- `docs/js/api.js` には `getAll(colName)` / `createDoc(colName, payload)` /
  `updateDocFields(colName, id, payload)` / `removeDoc(colName, id)` という
  汎用ヘルパーがあり、各コレクション用の `getTasks()` / `createMemo()` などは
  これらを薄くラップして作られている。新しいコレクションもこのヘルパーを
  使って実装する
- 権限モデル: 管理者(PM)は全操作可能。一般メンバーは自分の役職
  (または「全員」)が割り当てられたタスクの状態/進捗更新、メモの投稿・
  自分の投稿の編集削除などが可能。`firestore.rules` では
  `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`
  というパターンで「特定フィールドだけは本人以外/誰でも更新可能」という
  例外を表現している(例: `meta/notifications` の `lastDiscordNotifyDate`)。
  新しいルールもこのパターンを踏襲する

## 進め方についての指示

1. 実装前に必ず現在のコード(特に `utils.js` / `app.js` / 関連するタブのjs /
   `firestore.rules`)を読み、既存の命名規則・関数構成・CSSクラス・UIの
   見た目に合わせること。以前の実装依頼で追加された `assets.js` /
   `references.js` / `versions` まわりのコードは特に参考になる
2. 新しいFirestoreコレクション/フィールドを追加する場合は
   `firestore.rules` も必ず更新する
3. 3つの機能はそれぞれ独立しているので、1機能ずつ
   「実装 → `npx serve docs` などでローカル確認 → コミット」という単位で
   進める。コミットメッセージは日本語で機能単位がわかるようにする
4. UIの文言はすべて日本語。絵文字は使わない(既存のボタンは
   「Excel出力」「+ 新規タスク」のようにテキストのみ)
5. 外部ライブラリやビルドツールは新たに導入しない
6. 各機能の実装が終わったら、READMEの該当セクションに簡潔に追記する

---

## 機能1: 共有PC/レンダーキュー管理

Mayaのレンダリングなど共有マシンを使う場面で、「誰が・どのPCで・
いつまで使用中か」を一覧化するための新タブ。

**データモデル**: 新規コレクション `renderJobs`
- `pcName`: string(PC名。例:「編集PC1」「Mayaレンダリング用PC」。
  自由入力だが、`tasks.js` のカテゴリ入力にある `<datalist>` と同じ要領で
  過去に使われたPC名を候補表示し、表記ゆれを防ぐ)
- `memberId`: string(登録した本人。`claimedMemberId` と一致させる)
- `title`: string(何を実行中か。例:「第3カット 最終レンダリング」)
- `startedAt`: string(ISO日時。登録時に自動設定し `formatDateTime` で表示)
- `estimatedEndAt`: string | null(終了予定時刻。任意入力、
  `<input type="datetime-local">` を使う)
- `status`: `'実行中' | '完了' | '中断'`
  (`utils.js` に `RENDER_STATUS_LIST` とその表示色を返す
  `renderStatusColor()` を、既存の `VERSION_STATUS_LIST` /
  `versionStatusColor()` と同じ形で追加する)
- `note`: string(任意メモ)

**UI**: 新規ファイル `docs/js/renderQueue.js` を作成し、
`renderRenderQueue(container, ctx)` をエクスポート。`app.js` の `TABS` に
「レンダー」として登録する
- 「実行中」のジョブを一覧表示(PC名・使用者・内容・開始時刻・終了予定・
  経過時間)。経過時間はタブを開いた時点で計算すればよく、リアルタイム
  更新は不要
- 終了予定時刻を過ぎてもステータスが「実行中」のままの場合、タスク一覧の
  「先行タスク未完了」バッジと同様のスタイルで「予定時刻超過」バッジを表示
- 「使用開始」ボタンから新規登録(メモ投稿フォームと同様のシンプルな
  インラインフォームでよい)
- 自分が登録したジョブ、またはPMは「完了にする」「中断にする」「削除」が
  可能(メモの権限モデルと同じ: 本人+PM)
- 完了/中断になったジョブは「履歴」として折りたたみ表示(直近10件程度)

**firestore.rules**(既存の `memos` ルールに近い形):
- `read`: signedIn なら誰でも
- `create`: signedIn かつ `memberId` が自分の `claimedMemberId` と一致
- `update`: 本人またはPMが、`status` / `note` / `estimatedEndAt` の
  いずれかのみを変更する場合に許可
  (`diff(...).affectedKeys().hasOnly(['status', 'note', 'estimatedEndAt'])`)
- `delete`: 本人またはPM

**その他**: `app.js` の `data` / `loadData()` に `renderJobs` を追加し、
`api.js` に `getRenderJobs` / `createRenderJob` / `updateRenderJob` /
`deleteRenderJob` を既存の汎用ヘルパー経由で追加する。

余裕があれば: ダッシュボードに「レンダー中: ○件」のような小さな表示を
追加すると、タブを開かなくても状況がわかって便利(必須ではない)。

---

## 機能2: メモの既読管理

**データモデル**: `memos` コレクションの各ドキュメントに
`readBy: string[]`(既読したメンバーIDの配列。デフォルト `[]`)を追加する。

**挙動**:
- メモ投稿時、投稿者自身の `memberId` を最初から `readBy` に含めておく
  (自分の投稿は既読扱い)
- メモタブ(`memos.js`)の一覧が描画されたタイミングで、表示されている
  各メモについて、自分がまだ `readBy` に含まれていなければ
  `arrayUnion(currentMember.id)` で自分のIDを追加する
  (`api.markMemoRead(memoId, memberId)` のような関数を追加してよい)
- 各メモに「既読 3/5」のように、現在の全メンバー数に対する既読人数を
  表示する。クリック/展開すると、誰が読んだか・まだのメンバー名一覧が
  見られるようにする(`<details>` タグでの開閉など、簡易な実装でよい)
- `app.js` の `tabsNav` を描画している部分で、「メモ」タブの表示に
  自分が未読のメモ件数をバッジ表示する(未読 = `readBy` に自分の
  `memberId` を含まないメモの数)。これにより、タブを開かなくても
  連絡の見落としに気づけるようにする

**firestore.rules**: 既存の `memos` の `update` ルールは
「投稿者本人が `content` のみ編集可能」という制限になっている。
これとは別に「誰でも `readBy` フィールドだけは更新できる」という
例外を追加する必要がある。`meta/notifications` の
`lastDiscordNotifyDate` に使われているのと同じパターンで、

```
allow update: if (投稿者本人が content のみ更新する場合) || (
  signedIn() &&
  request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readBy'])
);
```

のように、既存の条件に `||` で追加してください(具体的な条件式は
既存の `memos` ルールの書き方に合わせること)。

---

## 機能3: ダークモード

`docs/css/style.css` の `:root` に色・背景などが既にCSS変数として
定義されているので、それを活かして実装する。

**実装方針**:
- `:root` の変数一式を「ライトモード」のデフォルト値として残しつつ、
  `[data-theme="dark"]` セレクタで同じ変数名(`--bg`, `--bg-card`,
  `--border`, `--text`, `--text-muted`, `--primary` 系, `--todo` /
  `--doing` / `--done`, `--shadow-sm` / `--shadow-md` など)の
  暗い配色セットを定義する
- `roleColor()` / `priorityColor()` / `versionStatusColor()` など
  JSでハードコードされているバッジ色は、ダークモードでも十分な
  コントラストが出るか確認し、必要なら明度を調整する
- テーマの状態は `<html>` 要素の `data-theme` 属性で管理し、
  `localStorage`(キー例: `theme`)に保存する
  (`dashboard.js` の `BROWSER_NOTIFY_KEY` と同様、既存アプリでも
  `localStorage` は使われているので同じ流儀でよい)
- 初回アクセス時は `prefers-color-scheme: dark` を尊重してデフォルトを
  決め、それ以降はユーザーがトグルボタンで選んだ設定を優先する
- 画面が一瞬ライトで表示されてからダークに切り替わる「ちらつき」を
  防ぐため、`docs/index.html` の `<head>` 内、CSS読み込みより前に
  小さなインラインスクリプトを置き、`localStorage` の値(または
  OS設定)に応じて `<html>` に `data-theme` 属性を即座にセットする
- 切り替えボタンは `app-header` 内、`h1` と `header-user` の間あたりに
  常時表示の要素として追加する(ログイン前や閲覧専用モードでも
  使えるように、`renderHeader()` が描画する `#header-user` の中ではなく
  `index.html` に直接ボタンとして置く)。文言は絵文字を使わず、
  現在と反対の状態を表す形(「ダークモード」/「ライトモード」)にする
- Firestoreへの保存は不要(端末ごとの表示設定のため)。
  `firestore.rules` の変更もなし

## 補足

- 3つとも独立した機能なので、好きな順番・単位で依頼して構いません。
  強いて言えば、ダークモードはデータモデルの変更がなく見た目だけの
  変更なので、最初に試すと進め方の確認がしやすいかもしれません
- 実装中に、既存のコード(特に `firestore.rules` や `utils.js` の
  現在の中身)がこの依頼書に書いた内容と食い違っている場合は、
  最新のコードの方を優先し、必要であれば実装方針について質問してください
