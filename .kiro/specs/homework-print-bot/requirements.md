# 要件定義: homework-print-bot

## 概要

小学生向けの学習プリントをAIで自動生成し、LINEを通じて配信・回答受付・自動採点を行うシステム。
過去の回答結果を蓄積し、児童の理解度に応じた問題を生成する適応学習機能を備える。
初期リリースでは小学1年生の内容からスタートし、学習の進捗に応じて2年生・3年生以降の内容へ段階的に進化する。

---

## ユーザーストーリー

### US-1: 学習プリントの受信
**As a** 保護者（LINEユーザー）
**I want to** LINEで子供のレベルに合った学習プリントを受け取る
**So that** 子供に家庭学習をさせることができる

#### 受入基準
- AC-1.1: LINEでメッセージを送って新しいプリントを要求できる（例:「プリント」「ぷりんと」「もんだい」）
- AC-1.2: 回答を提出して採点が完了すると、次のプリントが自動で配信される
- AC-1.3: 生成されるプリントは学習指導要領に準拠した内容である
- AC-1.4: プリントはPNG画像形式で配信される（S3 presigned URL経由でLINE画像メッセージとして送信）
- AC-1.5: 科目指定は将来対応（初期はさんすう固定）
- AC-1.6: 生成されたプリントの内容を保護者が確認し、修正指示をテキストで伝えて再生成できる
- AC-1.7: 修正指示の例:「もう少し簡単にして」「ひき算を増やして」「問題数を減らして」


### US-2: 回答の提出と採点
**As a** 保護者（LINEユーザー）
**I want to** 子供が回答した学習プリントをカメラで撮影してLINEで送信し、自動採点してもらう
**So that** すぐに正誤を確認でき、子供にフィードバックを与えられる

#### 受入基準
- AC-2.1: LINEでカメラ撮影した回答画像を送信すると、自動的に採点が行われる
- AC-2.2: 採点結果（正解数/問題数、各問の正誤）がLINEメッセージで返信される
- AC-2.3: 各問題について正解・不正解が明示される
- AC-2.4: 不正解の問題には正しい答えだけでなく、どこが間違っていたか（式や途中経過の誤り）が説明される
- AC-2.5: 画像が不鮮明・判読不能な場合は、該当箇所をテキストで手入力するよう促すメッセージが返される
- AC-2.6: 手入力で回答を送信した場合も同様に採点される（①②等の丸数字または番号で回答を指定）
- AC-2.7: 算数の場合、答えだけでなく式も含めて正誤を判定する（例: 答えが合っていても式が間違っていれば指摘する）

### US-3: 学習履歴に基づく問題生成
**As a** 保護者（LINEユーザー）
**I want to** 子供の過去の回答結果に基づいて適切な難易度の問題が出題される
**So that** 苦手分野を重点的に学習でき、効率的に学力を向上できる

#### 受入基準
- AC-3.1: 過去に不正解だった問題の類似問題が優先的に出題される
- AC-3.2: 正解率の高い分野は徐々に難易度が上がる
- AC-3.3: 学習履歴が蓄積されるほど、個別最適化された問題が生成される
- AC-3.4: 「りれき」とメッセージを送ると、これまでの学習サマリーが確認できる

### US-4: ユーザー登録とセットアップ
**As a** 保護者（LINEユーザー）
**I want to** 複雑な設定なしに利用を開始できる
**So that** すぐ使い始められる

#### 受入基準
- AC-4.1: 保護者2名のLINEアカウントで運用する（同一チャネルを共有）
- AC-4.2: 初回メッセージ送信時にウェルカムメッセージが表示され、使い方が案内される
- AC-4.3: 「登録 ○○くん」コマンドで子供をニックネーム登録し、学習履歴を個別に管理できる
- AC-4.4: 登録済みの子供のニックネームを含むメッセージで対象を切り替えられる
- AC-4.5: どちらの保護者からメッセージを送っても同じファミリーの子供の学習履歴にアクセスできる

---

## 機能要件

### FR-1: 学習プリント生成
- FR-1.1: さんすうの問題を生成できる（単元分類は以下の2階層で管理）
  - 数と計算: かずとすうじ / なんばんめ / いくつといくつ / たしざん（繰り上がりなし） / たしざん（繰り上がりあり） / ひきざん（繰り下がりなし） / ひきざん（繰り下がりあり） / 3つのかずのけいさん / 20よりおおきいかず
  - 図形: かたちあそび / かたちづくり
  - 測定: ながさくらべ / ひろさくらべ / かさくらべ
  - 時計: なんじ なんじはん
  - データ: ものの数しらべ
  - 文章題: たしざんの文章題 / ひきざんの文章題
- FR-1.2: こくごの問題生成は将来対応とする（初期スコープ外）
- FR-1.3: A4サイズ（210mm × 297mm）1枚に収まるレイアウトで出力する
- FR-1.4: 問題数は1枚あたり最大10問とする（単元に応じて調整、デフォルト8問）
- FR-1.5: 児童が読める大きめのフォントサイズ（18pt以上）を使用する
- FR-1.6: 出力形式はPNG画像を主とし、Python Agent側ではPDF出力もサポートする
- FR-1.7: AWS Bedrock（Claude Sonnet 4 — `jp.anthropic.claude-sonnet-4-6`）を利用して問題文を生成する
- FR-1.8: 保護者からのテキスト修正指示を受けてプリントを再生成できる
- FR-1.9: 直前に生成したプリントの文脈を保持し、修正指示に対して差分反映する
- FR-1.10: 問題はJSON形式で生成し（番号・問題文・正解の式・正解）、HTMLテンプレートでレイアウトする
- FR-1.11: 難易度は5段階（1: とても簡単 〜 5: 難しい）で指定できる

### FR-2: LINE連携
- FR-2.1: LINE Messaging APIを利用したWebhookでメッセージを受信する
- FR-2.2: テキストメッセージによるコマンド受付（「プリント」「りれき」「登録 ○○くん」等）
- FR-2.3: 画像メッセージの受信とS3への保存
- FR-2.4: S3 presigned URL（有効期限6時間）経由でLINE画像メッセージとしてプリントを送信する
- FR-2.5: LINE Webhook署名検証によるリクエスト認証
- FR-2.6: LINEチャネルシークレットおよびアクセストークンはAWS SSM Parameter Store（SecureString）で管理する
- FR-2.7: テキストメッセージで修正指示を検出し、直前のプリントを再生成する

### FR-3: 回答画像の認識と採点
- FR-3.1: 撮影された回答画像からマルチモーダルAIで回答を読み取る
- FR-3.2: AWS Bedrock（Claude Sonnet 4 マルチモーダル）を利用して手書き文字を認識する
- FR-3.3: 読み取った回答と正解を比較して採点する
- FR-3.4: 採点結果を構造化データとして保存する
- FR-3.5: 判読不能な箇所がある場合、該当問題番号を特定しテキスト入力を促す
- FR-3.6: ユーザーがテキストで送信した回答も受け付けて採点する（丸数字または番号形式）
- FR-3.7: 算数の採点では答えだけでなく式・途中計算の正誤も判定する
- FR-3.8: 間違いの種類を分析する（計算ミス、式の立て方ミス、文字の書き間違い等）

### FR-4: 学習履歴管理
- FR-4.1: 子供ごとの回答履歴を保持する
- FR-4.2: 分野ごとの正解率を算出する
- FR-4.3: 学習サマリーレポートを生成できる
- FR-4.4: 出題した問題を子供単位・問題単位で保持する（問題文、正解、出題日時）
- FR-4.5: 各問題に対する子供の解答内容（式・答え）をそのまま保持する
- FR-4.6: 正誤だけでなく、間違いの内容・種類も履歴として記録する

### FR-5: 適応学習エンジン
- FR-5.1: 過去の正解率に基づいて問題の難易度を調整する
- FR-5.2: 苦手分野の問題を優先的に出題する
- FR-5.3: 一定期間正解し続けた分野は出題頻度を下げる
- FR-5.4: 現学年の内容を十分に習得した場合、次の学年の内容に進む
- FR-5.5: 学年進級の判定基準: 全分野の正解率が80%以上を継続した場合
- FR-5.6: 単元は大分類×小分類の2階層で管理する
- FR-5.7: 単元の進行順序は教科書（学習指導要領）の順番に従う
- FR-5.8: 現在の単元の正解率が基準に達したら次の単元を解放する

### FR-6: HTML→PNG レンダリングパイプライン
- FR-6.1: Agent（Python）が問題JSONからHTMLを生成し、S3にアップロードする
- FR-6.2: 専用のRenderer Lambda（TypeScript/Node.js）がS3上のHTMLファイルをPNGに変換する
- FR-6.3: Renderer Lambdaは `@sparticuz/chromium` + `puppeteer-core` を使用してヘッドレスレンダリングを行う
- FR-6.4: Webhook Handler LambdaがRenderer Lambdaを同期的にInvokeし、変換されたPNGのS3キーを取得する
- FR-6.5: レンダリング結果のPNGはS3に保存され、presigned URLでLINEに配信する
- FR-6.6: 日本語フォント（Noto Sans JP）および絵文字フォント（Noto Color Emoji）をバンドルし、fontconfigで設定する
- FR-6.7: フォントファイルは `/tmp/fonts` にコピーし、`FONTCONFIG_PATH`/`FONTCONFIG_FILE` 環境変数でChromiumに認識させる

---

## 非機能要件

### NFR-1: セキュリティ
- 児童の個人情報は最小限の収集とする
- 回答画像は採点後に一定期間で自動削除する
- HTTPS通信の強制
- LINEチャネルシークレット・アクセストークンはSSM Parameter Store（SecureString）で管理し、Lambda実行時に復号取得する
- LINE Webhook署名検証による不正リクエスト防止

### NFR-2: コスト
- AWS無料利用枠を最大限活用する
- Bedrock APIコールの回数を最適化する
- 月額運用コスト目標: 1,000円以下（家庭内利用）

### NFR-3: 保守性
- Infrastructure as Code（AWS CDK）によるリソース管理
- ログの集約とモニタリング（CloudWatch）
- CI/CDパイプラインによる自動デプロイ

### NFR-4: パフォーマンス
- Renderer Lambdaはメモリ2048MB、タイムアウト60秒で構成する
- SSMパラメータはLambdaコールドスタート時に取得しキャッシュする（ウォームスタートで再取得しない）
- S3 presigned URLの有効期限は6時間とする

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| AIエージェント基盤 | AWS Bedrock AgentCore (`aws-cdk-lib/aws-bedrockagentcore`) + Strands Agents SDK (Python) |
| AgentCoreランタイム | `bedrock-agentcore[strands-agents]` + `strands-agents` (Python 3.12) |
| AgentCore呼び出し | `@aws-sdk/client-bedrock-agentcore` — `InvokeAgentRuntimeCommand` (ストリーミング応答、event-stream形式) |
| セッション管理 | LINE user IDを `runtimeSessionId` として使用（セッションアフィニティ） |
| LLM | Amazon Bedrock — Claude Sonnet 4 (`jp.anthropic.claude-sonnet-4-6`) |
| LINE連携 | LINE Messaging API (`@line/bot-sdk`) |
| LINE秘密情報管理 | AWS SSM Parameter Store (SecureString) — `@aws-sdk/client-ssm` |
| Webhook Lambda | AWS Lambda (Node.js 20.x / TypeScript) |
| HTMLレンダリング（Lambda） | `@sparticuz/chromium` + `puppeteer-core` (専用Renderer Lambda、2048MB、60秒タイムアウト) |
| HTMLレンダリング（Agent） | Playwright (Python、自動インストール対応) |
| Renderer呼び出し | `@aws-sdk/client-lambda` — 同期Invoke |
| 画像配信 | S3 presigned URL (`@aws-sdk/s3-request-presigner`、有効期限6時間) |
| API Gateway | Amazon API Gateway |
| データストア | Amazon DynamoDB (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`) |
| ファイルストレージ | Amazon S3 |
| IaC | AWS CDK (TypeScript) |
| 言語 | TypeScript (Webhook・Renderer Lambda) / Python (AgentCoreランタイム) |
| パッケージマネージャ | pnpm (モノレポ構成: pnpm workspaces) / uv (Python Agent) |
| ランタイム | Node.js 20.x / Python 3.12 |
| フォント | Noto Sans JP (日本語) + Noto Color Emoji (絵文字) |
| フォント設定 | fontconfig (`/tmp/fonts` にコピー、`FONTCONFIG_PATH`/`FONTCONFIG_FILE` 環境変数) |

---

## アーキテクチャ概要

```
LINE App
  ↓ Webhook (HTTPS)
API Gateway
  ↓
Webhook Handler Lambda (TypeScript/Node.js)
  ├── LINE署名検証
  ├── SSM Parameter Storeからシークレット取得（キャッシュ）
  ├── コマンド解析（プリント要求 / 採点 / りれき / 登録 / 修正指示）
  ├── AgentCore Runtime呼び出し（InvokeAgentRuntimeCommand、sessionId=LINE userId）
  ├── Renderer Lambda同期Invoke（HTML→PNG変換）
  └── S3 presigned URL生成 → LINE画像メッセージ送信

AgentCore Runtime (Python 3.12)
  ├── Print Generator Agent（Strands SDK + Bedrock Claude Sonnet 4）
  │   ├── 問題JSON生成 → HTMLレンダリング → S3アップロード
  │   └── Playwright (PDF/PNG出力、fontconfig設定済み)
  ├── Grading Agent（マルチモーダル画像認識 + 採点）
  └── Adaptive Learning Agent（学習統計 + 難易度調整）

Renderer Lambda (TypeScript/Node.js, 2048MB, 60秒)
  ├── S3からHTML取得
  ├── @sparticuz/chromium + puppeteer-core でPNGレンダリング
  ├── バンドルフォント: NotoSansJP + NotoColorEmoji
  └── PNG を S3 にアップロード（.html → .png）
```

---

## 制約事項

- C-1: LINE Messaging APIの無料プラン（月1,000通）の範囲で運用開始する
- C-2: 初期リリースは小学1年生のさんすうのみ対応する（こくご・上位学年は将来拡張）
- C-3: 対応科目は将来的にこくごも追加予定
- C-4: 日本語のみ対応する
- C-5: AWS東京リージョン（ap-northeast-1）を使用する
- C-6: Renderer Lambdaのs3Keyは `.html` 拡張子のみ受け付ける（出力は `.png` 拡張子に変換）
