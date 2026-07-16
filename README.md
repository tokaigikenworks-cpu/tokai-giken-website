# トカイ技研 Webサイト

CURRENT SITE VERSION: V8

Cloudflare Pagesへの配置を想定した静的サイトです。問い合わせのみPages Functionを使用します。

## 構成

- `index.html`：トップ
- `service.html`：対応範囲
- `process.html`：進め方・基本料金
- `contact.html`：相談・見積フォーム
- `contact-complete.html`：送信完了
- `functions/api/contact.js`：問い合わせ受付API
- `migrations/0001_contact.sql`：問い合わせ保存用D1スキーマ

## 問い合わせ機能の本番設定

次のCloudflareバインディング・環境変数が未設定の状態では、APIは成功を返しません。

### バインディング

- `CONTACT_DB`：D1 Database。`migrations/0001_contact.sql`を適用する
- `CONTACT_RATE_LIMIT`：KV Namespace。10分間に5回までの送信制限に使用
- `CONTACT_FILES`：R2 Bucket。添付ファイルを受け付ける場合に必要

### 環境変数・シークレット

- `ALLOWED_ORIGIN`：公開サイトのオリジン。複数の場合はカンマ区切り
- `RESEND_API_KEY`：ResendのAPIキー（CloudflareのSecretとして登録）
- `CONTACT_NOTIFICATION_TO`：通知先メールアドレス。複数の場合はカンマ区切り
- `CONTACT_FROM`：Resendで認証済みの送信元アドレス

APIキーや通知先はHTML・JavaScriptへ記載しないでください。

## 問い合わせデータ

D1には受付日時、問い合わせID、名前、会社名、メール、希望納期、相談原文、対象物、車種・型式、予算感、3Dデータ有無、添付資料情報、処理ステータスを保存します。添付本体はR2へ保存します。

許可形式はJPG、PNG、WebP、HEIC/HEIF、PDF、STL、STEP/STPです。上限は10点、1ファイル10MB、合計20MBです。拡張子、MIMEタイプ、主要形式のファイルシグネチャをサーバー側で確認します。

## 公開・確認手順

1. GitHubの`main`へV8を反映する。
2. Cloudflare PagesのProduction deploymentが、そのV8コミットを参照していることを確認する。
3. D1、KV、R2、環境変数をProduction環境へ設定する。
4. 本番URLから添付なし・添付ありを各1件送信する。
5. 完了画面、D1保存、R2保存、管理者メール通知を確認する。
6. 必須エラー、不正形式、上限超過、連続送信時のエラー表示を確認する。
7. ページソースの`<meta name="site-version" content="v8">`とGitHubのHTMLを照合する。

本ZIPの作成時点では、本番用Cloudflareバインディングとメール認証情報が提供されていないため、実送信テストは未実施です。設定後に上記手順で必ず確認してください。

## Cloudflare Pages

Framework presetは`None`、Build commandは空欄、Output directoryは`/`を指定します。`functions/`はPages Functionsとして自動検出されます。
