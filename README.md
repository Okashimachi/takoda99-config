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

## 状態

**設計フェーズ**。スキャフォールドは issue #1 から。

## 前作との違い（Textro99 `config-front` からの変更点）

1. パラメータが**入れ子構造**になった（`customer.buzz.weight` 等）。フラットな `Record<string, number>`
   前提のスキーマは流用できない → パス方式に作り直し（仕様書 §5.1）
2. **お題（words）編集画面が追加**（仕様書 §6）
3. `matching.*` が**再起動なしで反映**されるようになった（仕様書 §7）
4. 試合の制限時間が廃止され、**決着を保証するのが `storm` だけ**になった。
   `storm.intervalTicks = 0` は「試合が終わらない」設定 → 強い警告が要る
