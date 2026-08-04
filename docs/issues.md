# issue 分解

[仕様書](./仕様書.md) を実装単位に割ったもの。**各見出しがそのまま issue のタイトル・本文**になる。
着手前に仕様書の該当節を読むこと。

## 依存関係と着手順

```
#1 スキャフォールド
 ├─ #2 型ミラーとスキーマ ──┬─ #4 検証・リスク警告 ─┐
 │                          └─ #6 プリセット/履歴 ─┤
 ├─ #3 APIクライアント ──────────────────────────┴─ #5 パラメータ編集画面
 │        └─ #7 お題(words)画面 ─ #8 CSV一括入力
 └─ #9 共通レイアウト・トークン共有
                                                    └─ #10 Vercelデプロイ
```

並行できるのは **#2 / #3 / #9**。#5 が最大の山。

- 🔰 = ゲーム内部の知識がなくても閉じている（後輩に振れる）
- ⚠ = 仕様の判断が要る（りーせ）

---

## #1 スキャフォールド: Next.js + Tailwind + CI 🔰

**やること**

- `create-next-app`（App Router / TypeScript / Tailwind / ESLint、`src/` は使わない）で初期化
- 参考にする既存構成: `config-front/`（Textro99）の `package.json` / `tsconfig.json` /
  `tailwind.config.ts` / `postcss.config.mjs` / `next.config.mjs` / `app/globals.css`。
  **バージョンは最新に上げてよい**（Next 15 系以上）
- `.env.example` に `NEXT_PUBLIC_GAME_SERVER_URL=https://takoda99.mooo.com`
- `.github/workflows/ci.yml` — `npm ci && npm run build`（`config-front/.github/workflows/ci.yml` と同型）
- `app/layout.tsx` に `lang="ja"` とタイトル「たこ焼き99 運営コンソール」

**完了条件**: `npm run build` が通り、`npm run dev` でトップページが出る。CI が緑。

---

## #2 `lib/params.ts`: 型ミラーとパス方式スキーマ ⚠

仕様書 **§5.1 / §5.2**。ここが今回の設計の核。

**やること**

1. `Takoda99-Server/internal/game/params.go` の `GameParameters` を TS 型としてミラー。
   `customer.*.attribute` は `"Normal" | "Bonus" | "Claimer" | "Buzz"` の**文字列**であることに注意。
2. `defaultParameters` を `game.DefaultParameters()` と同値で定義（仕様書 §5.2 の表が既定値）。
3. `FieldSpec` / `GroupSpec` を**ドット区切りパス**で定義（仕様書 §5.1 のコード片）。
   12グループ・全56項目。**`help` は全項目必須**。
4. `getPath` / `setPath` ヘルパ。
5. `fillMissing(raw)` — 取得 JSON を土台に、**既知パスが欠けている場合だけ**デフォルトで補完する。
   Textro99 の `mergeWithDefaults` は数値前提なので流用しない。
6. `applyEdits(base, edits)` — サーバー取得 JSON をそのまま土台に、編集した数値リーフだけ上書きして返す。

**⚠ 最重要**: 保存 JSON から `customer.*.attribute` を落とさないこと。落とすと全客が Normal 扱いになる。
テストで `POST` ボディに 4つの `attribute` が残ることを確認する。

**完了条件**: `defaultParameters` を `applyEdits` に通した結果が入力と一致する。
スキーマの全 `path` が `defaultParameters` 上に実在する（型 or テストで保証）。

---

## #3 `lib/api.ts`: APIクライアント 🔰

仕様書 **§3 / §10**。

**やること**

- ベースURL = `process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "https://takoda99.mooo.com"`
- `getParams()` / `saveParams(params, token)`
- `getWords(filter?)` / `saveWords(words, mode, token)` / `deleteWord(id, token)`
- ステータスコードを**日本語メッセージに正規化**して投げる型付きエラー（仕様書 §10 の表）。
  `401` / `400`（本文をそのまま含める）/ `503` / ネットワーク・CORS を区別する
- `GET` は `cache: "no-store"`

**完了条件**: 各関数が型付きで、エラーが §10 の文言にマップされる。

---

## #4 `lib/validate.ts`: 検証とリスク警告 ⚠

仕様書 **§5.4 / §5.5**。

**やること**

- `validate(p): string[]` — サーバーの `GameParameters.Validate()` と**同じ9条件**＋フロント追加条件。
  1件でもあれば保存ボタンを無効化する
- `riskWarnings(p, maxWordLevel?): string[]` — 保存前 `confirm` に出す soft 警告
- `storm.intervalTicks === 0` / `thresholdPct === 0` の警告文は仕様書 §5.5 の通り
  （**制限時間がないので試合が終わらなくなる**という理由まで書く）

**完了条件**: サーバー側 `params_validate_test.go` が弾く値を、フロントも全部弾く。

---

## #5 パラメータ編集画面 `app/page.tsx` ⚠

仕様書 **§5.2 / §5.3 / §5.7**。#2 #3 #4 の後。

**やること**

- グループごとのセクション、各項目は数値入力＋ラベル＋単位＋`help`＋`既定 <値>`
- 3階層項目（`credit.leaveLoss.*` / `customer.*.*`）は**サブグループとして入れ子表示**する。
  特に `customer` は「属性 × weight/patience/orderCount」なので**表形式**が読みやすい
- 差分表示: 変更フィールドに `●`、サイドに「未保存の変更 N件」（`旧値 → 新値`）
- ボタン: 保存 / 再読み込み（未保存があれば confirm）/ 既定に戻す
- 保存フロー: `validate` → トークン確認 → `riskWarnings` の confirm → `POST` →
  **レスポンスをサーバー現在値として採用**（§7 のキャッシュ対策で `GET` し直さない）
- `matching` セクションに「数秒で反映（再起動不要）」、他に「次の試合から反映」のバッジ
- `matching.minFill` に「サーバーが `--bots N` 起動だと上書きされる」注記
- JSON プレビュー

**完了条件**: 仕様書 §11 の受け入れ基準 2〜5, 9。

---

## #6 `lib/storage.ts`: プリセットと変更履歴 🔰

仕様書 **§5.6**。`config-front/lib/storage.ts` をほぼそのまま移植できる。

**やること**

- localStorage キーを `takoda99-admin-token` / `takoda99-presets` / `takoda99-history` に改名
  （`t99-*` のままだと Textro99 の config-front と衝突する）
- 履歴は最大20件
- 初期プリセット `本番` / `少人数テスト`（`minPlayers: 2`, `minFill: 8`）/ `高速決着` を検討

---

## #7 お題(words)編集画面 `app/words/page.tsx` ⚠

仕様書 **§6**。#3 の後。

**やること**

- 一覧テーブル（`id / text / reading / keystrokeCount / level / category`）
- フィルタ: level、category、**テキスト部分一致はクライアント側**（サーバーは完全一致のみ）
- level ごとの件数サマリ
- 編集モデルは仕様書 §6.2 の表に従う。
  **`text` か `level` を変えたら「旧idを DELETE → 新語を POST」の2段**（一意キーが `(text, level)` で
  `id` は upsert に使われないため）
- 2段操作の途中失敗は「元の語が消えた可能性があります」と明示して一覧再取得を促す
- `keystrokeCount` は既定で空欄（サーバーが `reading` から算出）
- 編集はためて「保存」で一括送信

**完了条件**: 仕様書 §11 の受け入れ基準 6。

---

## #8 words の CSV/TSV 一括入力 🔰

仕様書 **§6.3**。#7 の後。

**やること**

- `text,reading,level,category` の行を貼れるテキストエリア（TSV も受ける）
- パース結果をプレビュー表で確認してから送信、`mode` 既定は `upsert`
- `mode: "replace"` は「既存の全語を削除して置き換える」と赤字警告＋
  **「REPLACE」と手入力させる二段確認**

**完了条件**: 仕様書 §11 の受け入れ基準 7。

---

## #9 共通レイアウト・タブ・トークン共有 🔰

仕様書 **§4 / §8**。

**やること**

- ヘッダに接続先URL表示、タブ（パラメータ / お題）、トークン入力（`type="password"`、localStorage 記憶）
- トークンは両タブで共有（#6 の `takoda99-admin-token`）
- 「このツールについて」の説明ブロック（`config-front/app/page.tsx` の `<details>` が下敷き）。
  ゲームの流れと**反映タイミング（§7 の表）**を書く

---

## #10 Vercel デプロイと CORS 疎通 ⚠

仕様書 **§9**。全部の後。

**やること**

1. Vercel に本リポを Import、`NEXT_PUBLIC_GAME_SERVER_URL` を設定
2. **払い出された URL をサーバーの `CONFIG_FRONT_ORIGIN` に追加**（忘れると CORS で全部落ちる）
3. 本番サーバーに対して GET/POST の疎通確認

---

## サーバー側に立てる issue（Takoda99-Server へ）

フロントでは埋められない穴。仕様書 §6.4 / §12。

- words の `PATCH /api/words/{id}`（id 指定更新）。現状 `text`/`level` 変更が2段になる
- `DELETE /api/words/{id}` の未存在時を `500` → `404` に
- `GET /api/params` のレスポンスに `configHash`（`game.ConfigHash()`）を含める。反映確認が楽になる
- `Takoda99-Docs/02_共通仕様/03_パラメータ仕様.md` の更新
  （`matchTimeLimitMs` 残存、`penaltyClaimer` 未実装、キー名がフラット表記）
