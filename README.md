# 補助金・助成金コンシェルジュ(デモ版)

会社のホームページを入力するだけで、活用できる補助金・助成金の候補探しから申請準備・Jグランツでの本人提出までを伴走するワンストップ支援サービスのデモです。

## 構成

- `public/index.html` — フロントエンド全体(単一ファイルSPA、ビルド不要)
- `src/index.js` — Worker本体。`/api/*` をルーティングし、それ以外は静的アセット(`public/`)を配信
- `src/analyze-company.js` — 会社HP解析→制度マッチング(Claude API)
- `src/draft.js` — 申請書類たたき台の生成(Claude API)
- `wrangler.jsonc` — Cloudflare Workers(静的アセット付き)の設定

ホスティングは Cloudflare Workers(Static Assets)。npm 依存の実行時コードはなし・ビルドステップなし(`wrangler` はデプロイ時のみ使用)。

## ローカル起動

```sh
# リポジトリ直下に .dev.vars を作成(gitignore済み)
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars

npx wrangler dev
```

http://localhost:8787 で起動します。APIキーがない場合も画面遷移・チェックリスト・ダッシュボード等のAI以外の機能は動作します。

## デプロイ

1. GitHub リポジトリを Cloudflare(Workers & Pages → Connect GitHub)に接続。ビルドコマンドは指定不要(`wrangler.jsonc` があるため `npx wrangler deploy` がそのまま動く)
2. プロジェクトの Settings → Variables and secrets に `ANTHROPIC_API_KEY` を追加(Secret として暗号化推奨)
3. `main` に push すると自動デプロイ

## 法的な設計方針(重要)

- AI下書きは申請者本人が編集して使う「自己作成支援」の範囲。書類の作成・提出の代行は行わない(行政書士法・社会保険労務士法対応)
- 想定採択率は表示しない(景品表示法対応)
- 専門家リストは資格種別(行政書士/社会保険労務士)で制度ごとに振り分け。デモ版のデータはすべて架空
- Jグランツへの提出は本人提出のみを案内(代理申請機能なし)
