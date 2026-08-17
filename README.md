# takoda99-config

Takoda99（たこ焼き経営バトルロイヤル）の **運営用 管理UI**。
イベント当日にビルド・デプロイなしで、ゲームバランス（`GameParameters`）とお題（words）を変える。

`Takoda99-Server` の HTTP API を叩くだけの薄いフロント（Next.js / Vercel）。DB は持たない。

- 📄 **[仕様書](docs/仕様書.md)** — 実装前に読む。API契約・全パラメータ・反映タイミング。
- 📋 **[issue一覧](docs/issues.md)** — 作業の分解と着手順。

## 依存する正典

| 対象 | 正典 |
|---|---|
| パラメータの型・既定値 | `Takoda99-Server/internal/game/params.go` |
| API契約 | `Takoda99-Server/internal/configapi/` |
| 仕様の背景 | `Takoda99-Docs/02_共通仕様/03_パラメータ仕様.md` |

本リポの TS 型は `params.go` の**手動ミラー**。サーバー側で項目が増減したら両方を揃える。

### 🔴 既定値は必ず2リポで揃える（事故が起きた箇所）

`lib/params.ts` の `defaultParameters` は「画面の好みの値」ではなく、**サーバー内蔵デフォルトの写し**。

**DB に無いキーはこの値で補完されて、そのまま本番DBへ保存される。**
2026-08-16 に `heat.perElapsedSec` をサーバー側で 0.12 にしたのにこちらを 0.11 のまま
直し忘れ、画面を開いた瞬間に 0.11 が本番へ保存されて、誰も気付かないまま本番が
意図と違う値で走った。

ズレは画面上部の**ドリフト警告**（`lib/drift.ts`）が両方向で出す:

| 向き | 意味 |
|---|---|
| サーバーが返すのに画面が知らない | 「未対応の項目」に自動描画して触れるようにする（黄色） |
| 画面が持つのにサーバーが返さない | **効かないツマミ**。保存すると画面側の既定値が本番へ書かれる（赤） |

警告が出たら `lib/params.ts` を直すのが正しい対処。`npm test` が既定値の一致を検査している。

## 使い方（ローカル）

```bash
npm install
cp .env.example .env.local   # 接続先を変える場合
npm run dev                  # http://localhost:3000

npm run typecheck            # 型検査
npm test                     # ドリフト検出・保存ロジックの回帰（node:test。追加依存なし）
```

画面右上に管理トークン（サーバーの `CONFIG_ADMIN_TOKEN`）を入れると保存できる。閲覧だけならトークンは不要。

| 変数 | 意味 |
|---|---|
| `NEXT_PUBLIC_GAME_SERVER_URL` | ゲームサーバーのベースURL（既定 `https://takoda99.mooo.com`） |

## 画面

- **パラメータ** — `GameParameters` を13グループで編集。全項目に説明文つき。検索・差分表示・プリセット・変更履歴・JSONプレビュー。
  - 上部にサーバーの **`configHash`**（設定の身元）を常時表示。保存前後で変われば「保存が本当に届いた」証拠になる
  - **ドリフト警告**（上記）と、未対応項目の**自動描画**
  - **JSONで書き出し / 読み込み** — プリセットと履歴は localStorage にしか無いので、別端末への引き継ぎはこれ
  - 未保存のまま離脱しようとすると確認する
- **お題（words）** — 語の追加・編集・削除、CSV/TSV一括入力、レベル分布の確認。

## デプロイ（Vercel）

1. 本リポを Import（Framework: Next.js 自動検出）
2. `NEXT_PUBLIC_GAME_SERVER_URL` を設定
3. **払い出された URL をサーバーの `CONFIG_FRONT_ORIGIN` に追加**（忘れると CORS で全機能が落ちる）

## 前作との違い（Textro99 `config-front` からの変更点）

1. パラメータが**入れ子構造**になった（`customer.buzz.weight` 等）。フラットな `Record<string, number>`
   前提のスキーマは流用できない → パス方式に作り直し（仕様書 §5.1）
2. **お題（words）編集画面が追加**（仕様書 §6）
3. `matching.*` が**再起動なしで反映**されるようになった（仕様書 §7）
4. 試合の制限時間が廃止され、**決着を保証するのが `storm` だけ**になった。
   `storm.intervalTicks = 0` は「試合が終わらない」設定 → 強い警告が要る
