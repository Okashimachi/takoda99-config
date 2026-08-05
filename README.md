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

## 使い方（ローカル）

```bash
npm install
cp .env.example .env.local   # 接続先を変える場合
npm run dev                  # http://localhost:3000
```

画面右上に管理トークン（サーバーの `CONFIG_ADMIN_TOKEN`）を入れると保存できる。閲覧だけならトークンは不要。

| 変数 | 意味 |
|---|---|
| `NEXT_PUBLIC_GAME_SERVER_URL` | ゲームサーバーのベースURL（既定 `https://takoda99.mooo.com`） |

## 画面

- **パラメータ** — `GameParameters` 全56項目を12グループで編集。全項目に説明文つき。検索・差分表示・プリセット・変更履歴・JSONプレビュー。
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
