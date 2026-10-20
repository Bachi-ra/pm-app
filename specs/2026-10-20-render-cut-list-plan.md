# レンダー「カット一覧」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レンダータブの「共有PC使用状況」を、Excelと同じ列構成のカット一覧(即時変更できるプルダウン・一括取り込み付き)に置き換える。

**Architecture:** 新Firestoreコレクション `renderCuts` を既存の `assets` と同じ作法(api.js のCRUD + 画面モジュール1つ)で追加する。Excel貼り付けの解析は副作用の無い純関数として別ファイルに分け、画面側はプレビュー件数の計算と確定ボタンだけを持つ。最後に旧 renderJobs 一式を削除し、ダッシュボードのタイルを差し替える。

**Tech Stack:** 素のES Modules(ビルド無し)、Firebase JS SDK 10.14.1(Firestore)、GitHub Pages。

**Spec:** [specs/2026-10-20-render-cut-list-design.md](2026-10-20-render-cut-list-design.md)

## Global Constraints

- 選択肢(spec「データモデル」より、表記は完全一致):
  - 可否 `RENDERABLE_LIST = ['可能', '不可能']`(未設定は `''`)
  - 優先度は既存 `PRIORITY_LIST = ['高', '中', '低']`(未設定は `''`。タスクと違い既定値「中」にはしない)
  - 進行状況 `RENDER_CUT_STATUS_LIST = ['未着手', 'レンダリング中', 'やり直し', '完了']`(既定 `'未着手'`)
- 権限: 閲覧・追加・編集=サインイン済みメンバー全員、削除・一括取り込み=PMのみ
- 色はテーマ変数(`--done` / `--danger` / `--doing` / `--todo` / `--text-muted`)で指定し、ダークモードでも読めること
- コメントは日本語・最小限(既存コードに合わせる)。コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- push は各タスクでは行わない(最後にユーザー確認のうえで1回)
- 自動テスト環境は無い。各タスクの確認は「差分レビュー + 指定のブラウザ確認」

## Review Focus

1. **Excelのセル内改行**: 改行を含むセルはコピー時に `"…"` で囲まれ複数行にまたがる。行が分断されず1カットとして取り込まれること(Task 2 の確認項目)
2. **フレーム `0`**: 開始フレーム0が `null`(空)にならず `0` のまま保存・表示されること(Task 1・2)
3. **貼り付け内の重複カット番号**: 同じカット番号が2行あれば後の行が勝ち、件数は1件として数えること(Task 2・3)
4. **空欄の優先度・可否**: Excelで空欄のセルは「未設定」として保存され、勝手に「中」や「可能」にならないこと(Task 1・2)
5. **PM以外の画面**: 削除ボタンと一括取り込みパネルが出ないこと、かつルール側でも削除が拒否されること(Task 1・3)

---

### Task 1: データ層(定数・API・ルール・バックアップ)

**Files:**
- Modify: `docs/js/utils.js`(`PRIORITY_LIST` 付近に定数と比較関数を追加)
- Modify: `docs/js/api.js`(assets セクションの後に renderCuts セクション、`BACKUP_COLLECTIONS`、`export const api`)
- Modify: `firestore.rules`(`renderJobs` ブロックの直後に追加。renderJobs の削除は Task 4)

**Interfaces:**
- Produces(utils.js):
  - `RENDERABLE_LIST: string[]`、`RENDER_CUT_STATUS_LIST: string[]`
  - `compareCutNumber(a: string, b: string): number` — `String(a||'').localeCompare(String(b||''), 'ja', { numeric: true })`
- Produces(api.js、`api` オブジェクト経由):
  - `getRenderCuts(): Promise<Cut[]>`
  - `createRenderCut(data): Promise<Cut>` — `cutNumber` 空なら `Error('カット番号は必須です')`
  - `updateRenderCut(id, data): Promise` — 渡されたフィールドだけ正規化して更新
  - `deleteRenderCut(id): Promise`
  - `upsertRenderCuts(rows: Cut[], existing: Cut[]): Promise<{created: number, updated: number}>` — `existing` を cutNumber で引き、あれば `batch.set(ref, fields, {merge:false})` で上書き、無ければ新規ID。400件ずつ `writeBatch`
  - 内部: `sanitizeRenderCut(data, {partial})` — 文字列は trim、選択値は Global Constraints の一覧と完全一致しなければ既定値、`startFrame`/`endFrame` は「空文字・null・数値化不可 → null、それ以外 → Number」(`0` は 0 のまま)、`dueDate` は `/^\d{4}-\d{2}-\d{2}$/` 以外なら `''`

- [ ] **Step 1: utils.js に定数と `compareCutNumber` を追加**
- [ ] **Step 2: api.js に上記5関数と `sanitizeRenderCut` を追加し、`api` に公開、`BACKUP_COLLECTIONS` に `'renderCuts'` を追加**
- [ ] **Step 3: firestore.rules に spec の `renderCuts` ブロックを追加**(read: `signedIn()`、create/update: `signedIn() && hasClaim()`、delete: `isAdmin()`)
- [ ] **Step 4: 差分レビュー** — `git diff` で、(a) `startFrame: 0` が null にならない分岐、(b) 優先度の既定が `''` であること、(c) upsert が `existing` 照合で既存IDに書くこと、を目視確認
- [ ] **Step 5: Commit** — `git commit -m "レンダーのカット一覧用データ層(renderCuts)を追加"`

### Task 2: Excel貼り付けの解析(純関数)

**Files:**
- Create: `docs/js/renderCutImport.js`

**Interfaces:**
- Consumes: なし(正規化は Task 1 の api 側で行うので、ここは生の文字列を列に割り当てるだけ)
- Produces: `parseRenderCutPaste(text: string): Array<{cutNumber, renderable, reason, priority, assignee, dueDate, status, config, startFrame, endFrame, cameraName, scenePath}>`
  - 解析はタブ区切り(TSV)。`"` で始まるセルは対応する閉じ `"` まで改行を含めて1セル、`""` は `"` 1文字
  - 列順は A〜L(spec 一括取り込み参照)
  - 1列目を trim して空、`'カット番号'`、または `'レンダリング状況'` を含む行は捨てる
  - `dueDate`: `YYYY/M/D` または `YYYY-M-D` → `YYYY-MM-DD`(0埋め)、それ以外 → `''`
  - `startFrame`/`endFrame`: 文字列のまま返す(数値化は api 側)
  - `scenePath`: 前後の `"` を除去
  - 同じ cutNumber が複数あれば後の行で置き換え、出現順は最初の位置を保つ

- [ ] **Step 1: `parseRenderCutPaste` を実装**
- [ ] **Step 2: 差分レビューで次の入力→出力を机上確認**(コメントやテストファイルは残さない)
  - `"C001\t不可能\tレンダリングなし\t高\t\t\t完了\tArnold_simple\t\t\t\t"` → cutNumber `C001`、renderable `不可能`、priority `高`、status `完了`
  - `"C026\t可能\t\"ワイヤーフレームが出力されてい\nない\"\t高\t坂井\t2026/7/7\t完了"` → 1件、reason に改行を含む、dueDate `2026-07-07`
  - 見出し2行(`レンダリング状況（カット一覧）` / `カット番号\tレンダリング可否…`)を含む貼り付け → 見出し行は0件
  - `C001` が2回 → 1件、後の行の値
- [ ] **Step 3: Commit** — `git commit -m "Excel貼り付けからカット一覧を読み取る解析処理を追加"`

### Task 3: カット一覧画面

**Files:**
- Create: `docs/js/renderCuts.js`(`export function renderRenderCuts(container, ctx)`)
- Modify: `docs/css/style.css`(末尾付近に `.render-cut-*` のスタイル)

**Interfaces:**
- Consumes: `ctx.renderCuts`(Task 4 で app.js が読み込む。Task 3 単体の確認時は Task 4 と合わせて行う)、`ctx.api.{createRenderCut, updateRenderCut, deleteRenderCut, upsertRenderCuts}`、`parseRenderCutPaste`、`compareCutNumber`、`RENDERABLE_LIST`、`RENDER_CUT_STATUS_LIST`、`PRIORITY_LIST`、`ctx.isAdmin`、`ctx.isReadonly`、`ctx.refresh()`
- Produces: `renderRenderCuts(container, ctx)`

画面の構成は spec「画面」1〜5 のとおり。決めておくこと:
- 絞り込み状態はモジュール内変数 `let statusFilter = 'all'`(tasks.js の `filterState` と同じ作法)
- プルダウンは `data-cut-id` と `data-field`(`renderable` / `priority` / `status`)を持ち、`change` で `updateRenderCut(id, {[field]: value})` → `ctx.refresh()`。失敗時は `alert(err.message)`
- 未設定の選択肢は表示ラベル `-`、値 `''`
- 色は値ごとのクラス: `.cut-ok`(可能・完了)、`.cut-ng`(不可能・やり直し・高)、`.cut-doing`(レンダリング中)、`.cut-mid`(中)、`.cut-muted`(低・未着手・未設定)。select 自体に付与
- 左右の境目: 使用コンフィグ列の `th`/`td` に `.cut-divider`(`border-left: 2px solid var(--border)`)
- シーンパス: `max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` + `title`
- 閲覧専用URL(`ctx.isReadonly`)では追加・編集・プルダウン変更を出さず、選択値はバッジ表示
- 編集モーダルは `#render-cut-modal-root`。全12項目、期限は `type="date"`、フレームは `type="number"`。PMにのみ「削除」(confirm あり)
- 一括取り込みパネルは `<details class="milestone-admin">`(既存のPM向け折りたたみと同じ見た目)、PMのみ。「プレビュー」で `parseRenderCutPaste` → `ctx.renderCuts` の cutNumber と照合して「新規 N 件・更新 M 件」表示、0件なら「取り込めるカットがありません」。「取り込む」で `upsertRenderCuts(rows, ctx.renderCuts)` → 完了件数を表示 → `ctx.refresh()`

- [ ] **Step 1: `renderCuts.js` を実装**
- [ ] **Step 2: style.css に `.render-cut-*` / `.cut-*` を追加**(ライト/ダーク両方でテーマ変数のみ使用)
- [ ] **Step 3: 差分レビュー** — Review Focus 3(プレビュー件数が重複を1件と数える=解析結果をそのまま数えるので自動的に満たす)と 5(`isAdmin` 判定で削除・取り込みが出ない)を目視
- [ ] **Step 4: Commit** — `git commit -m "レンダータブ用のカット一覧画面を追加"`

### Task 4: 組み込み・旧機能の削除・ダッシュボード・README

**Files:**
- Modify: `docs/js/app.js`(import・`TABS.renderQueue` の render 差し替え・`data` 初期値と `loadData` の renderJobs → renderCuts)
- Modify: `docs/js/dashboard.js`(「レンダー中」タイル → 「レンダー完了」)
- Delete: `docs/js/renderQueue.js`
- Modify: `docs/js/api.js`(renderJobs 系4関数・`RENDER_STATUS_LIST` import・`api` 公開から削除)
- Modify: `docs/js/utils.js`(`RENDER_STATUS_LIST` / `RENDER_STATUS_COLORS` / `renderStatusColor` を削除)
- Modify: `firestore.rules`(`renderJobs` ブロック削除)
- Modify: `docs/css/style.css`(renderQueue.js だけが使っていたクラスを削除。削除前に `Grep` で他の参照が無いことを確認)
- Modify: `README.md`(レンダーの説明、データ保存先のコレクション一覧 `renderJobs` → `renderCuts`、バックアップ注意)

**Interfaces:**
- Consumes: `renderRenderCuts`(Task 3)、`api.getRenderCuts`(Task 1)
- Produces: `ctx.renderCuts: Cut[]`
- タブのキー `renderQueue` はそのまま(ダッシュボードの `data-tab="renderQueue"` 等の参照を壊さないため)。ラベルも「レンダー」のまま
- ダッシュボードのタイル: 値 `${完了数}/${全カット数}`、ラベル `レンダー完了`、`data-tab="renderQueue"`、クラス `stat-card-done`

- [ ] **Step 1: app.js・dashboard.js を差し替え**
- [ ] **Step 2: 旧 renderJobs 一式を削除**し、`Grep` で `renderJobs|renderQueue.js|RENDER_STATUS|renderStatusColor|getRenderJobs` が README 以外に残っていないことを確認(タブキー `renderQueue` は残って正しい)
- [ ] **Step 3: README を更新**
- [ ] **Step 4: Commit** — `git commit -m "レンダータブをPC使用状況からカット一覧に置き換え"`

### Task 5: 公開と動作確認

- [ ] **Step 1: ユーザーに push の可否を確認**し、許可後に `git push origin main`
- [ ] **Step 2: firestore.rules の再公開をユーザーに依頼**(未公開だとカット一覧の読み書きがすべて権限エラーになる旨を明記)
- [ ] **Step 3: ブラウザ確認**(Chrome拡張が使えればこちらで、使えなければユーザーに依頼)— spec「テスト・確認」の全項目 + Review Focus 1〜5。特に、実際のExcelから C001〜C023_plus4 を貼り付けて件数・日付・フレーム0・空欄の優先度を確認
