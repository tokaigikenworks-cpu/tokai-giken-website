# トカイ技研 Webサイト

Cloudflare Pages への配置を想定した、ビルド不要の静的サイトです。

## 構成

- `index.html`：トップ
- `service.html`：対応範囲
- `process.html`：進め方・料金目安
- `contact.html`：相談・見積フォーム

## 公開時に行うこと

1. このフォルダを GitHub リポジトリへアップロードする。
2. Cloudflare Pages で GitHub リポジトリを接続する。
3. Framework preset は `None`、Build command は空欄、Output directory は `/` を指定する。
4. 独自ドメイン取得後に、Cloudflare Pages の Custom domains から接続する。

## フォームについて

`contact.html` のフォームは Netlify Forms 記法を仮置きしています。Cloudflare Pages ではそのままメール送信されません。
公開前に Cloudflare Workers / Pages Functions + メール送信サービス、または外部フォームサービスへ接続します。

