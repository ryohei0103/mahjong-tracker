# 麻雀収支メモ

3〜4人麻雀の半荘ごとの収支とチップをまとめて記録するツール。Supabaseでログイン・保存を行う、フレームワーク不使用の素のHTML/CSS/JSです。

## ファイル構成

```
mahjong-tracker-project/
├── index.html          画面構造（HTML）
├── style.css            見た目（CSS）
├── config.js             SupabaseのURL・anon keyの設定
├── app.js                アプリのロジック（認証・保存・描画すべて）
└── supabase/
    └── schema.sql        Supabaseに適用済みのテーブル・RLS定義
```

依存はCDN経由の2つだけです（`index.html`内でread込み済み）。
- `@supabase/supabase-js@2`（Supabaseクライアント）
- Google Fonts（Shippori Mincho / Zen Kaku Gothic New）

ビルドツールは使っていません。`index.html` をブラウザで開けばそのまま動きます。

## Supabase

- プロジェクト: `Ryohei Project`（project_id: `wrvgorwctmdmhznviams`, リージョン: `ap-northeast-1`）
- テーブルは `game_sessions` の1つのみ。1行 = 1つの「記録」で、点数・チップ・レートなどをまとめて `state` (jsonb) 列に保存しています。
- `active = true` の行がユーザーの「現在編集中の記録」、`false` になった行が「過去の記録」一覧に出てきます。
- Row Level Security が有効で、`auth.uid() = user_id` の行しか見えない・書けない設定です。
- スキーマの詳細・再現用SQLは `supabase/schema.sql` を参照してください。

### 新規登録時のメール確認について

デフォルトでSupabaseは新規登録時に確認メールを送る設定です。友人にすぐ使ってもらいたい場合は、Supabaseダッシュボードの
`Authentication → Providers → Email` で「Confirm email」をオフにすると、登録後すぐログインできるようになります。

## 今後の開発について

`config.js` の anon key はクライアントに公開される前提の値です（RLSで保護されるので安全です）。ただし、別環境やGit管理する場合は
`config.js` を `.gitignore` して環境ごとに用意する、あるいはビルド時に環境変数から生成する形にすると管理しやすくなります。

主な改修ポイントの見取り図:
- `app.js` 内の `defaultState()` … 1レコードのデータ形
- `computeTotals()` … 半荘・チップ・合計の計算ロジック
- `render*()` 系関数 … 各パネルの再描画
- `loadCurrentSession()` / `doSaveState()` / `loadHistory()` … Supabaseとの読み書き
