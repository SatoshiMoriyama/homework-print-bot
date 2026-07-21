# homework-print-bot

LINE を通じて子供向け学習プリントを AI で自動生成・採点するシステムです。

## 主な機能

- **プリント生成**: 小学生向けのさんすう問題を AI（Amazon Bedrock Claude）で自動生成し、PDF/画像で配信
- **画像採点**: 回答を撮影して LINE で送信すると、手書き認識で自動採点（式・途中計算の正誤判定を含む）
- **適応学習**: 過去の回答履歴に基づき、苦手分野を重点出題・難易度を自動調整
- **学習履歴**: 子供ごとの学習進捗を記録し、サマリーレポートを確認可能

## アーキテクチャ

モノレポ構成（pnpm workspace）で以下の 3 パッケージから構成されます。

| パッケージ | 説明 | 言語/ランタイム |
|-----------|------|----------------|
| `packages/functions` | LINE Webhook Lambda ハンドラ | TypeScript / Node.js 20 |
| `packages/agent` | Bedrock AgentCore + Strands Agents | Python 3.12 |
| `packages/infra` | AWS CDK インフラ定義 | TypeScript |

### AWS サービス構成

- **Amazon API Gateway** - LINE Webhook エンドポイント
- **AWS Lambda** - Webhook 処理、エージェント呼び出し
- **Amazon DynamoDB** - ユーザー状態、学習履歴、採点結果の保存
- **Amazon S3** - プリント画像/PDF、回答画像の保存
- **Amazon Bedrock** - Claude Sonnet 5（問題生成・手書き認識・採点）、Claude Haiku 4.5（コマンド解析）

## 前提条件

- Node.js >= 20
- pnpm >= 9
- Python >= 3.12
- [uv](https://docs.astral.sh/uv/)（Python パッケージマネージャ）
- AWS CLI（設定済み）
- AWS CDK CLI
- LINE Developers アカウント（Channel Secret / Channel Access Token）

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/SatoshiMoriyama/homework-print-bot.git
cd homework-print-bot
```

### 2. 依存パッケージのインストール

```bash
# Node.js 依存（functions / infra）
pnpm install

# Python 依存（agent）
cd packages/agent
uv sync
cd ../..
```

### 3. LINE チャネルの作成

1. [LINE Official Account Manager](https://www.linebiz.com/jp/entry/) で LINE 公式アカウントを作成する
2. LINE Official Account Manager の **設定 → Messaging API** で「Messaging API の利用を有効にする」を実行
3. プロバイダーを選択し、Messaging API チャネルを作成する
4. [LINE Developers コンソール](https://developers.line.biz/console/) にログインし、作成されたチャネルを開く
5. **「チャネル基本設定」タブ** → 「チャネルシークレット」をコピー
6. **「Messaging API設定」タブ** → ページ下部の「チャネルアクセストークン（長期）」で「発行」をクリックし、トークンをコピー

> **Note**: LINE Developers コンソールから直接 Messaging API チャネルを作成することはできません（2024年9月以降）。必ず LINE Official Account Manager 経由で作成してください。

### 4. シークレットの登録（AWS SSM Parameter Store）

LINE のシークレットは AWS Systems Manager Parameter Store に `SecureString` として登録します。

```bash
aws ssm put-parameter \
  --name "/homework-bot/line-channel-secret" \
  --type "SecureString" \
  --value "<チャネルシークレット>" \
  --region ap-northeast-1

aws ssm put-parameter \
  --name "/homework-bot/line-channel-access-token" \
  --type "SecureString" \
  --value "<チャネルアクセストークン>" \
  --region ap-northeast-1
```

| パラメータ名 | 説明 |
|-------------|------|
| `/homework-bot/line-channel-secret` | LINE チャネルシークレット |
| `/homework-bot/line-channel-access-token` | LINE チャネルアクセストークン（長期） |

> **Tip**: ローカル開発用には `.env` ファイルに値を記載できます（`.gitignore` 済み）。デプロイ時は SSM Parameter Store が使用されます。

## デプロイ手順

### 1. CDK Bootstrap（初回のみ）

```bash
pnpm cdk bootstrap
```

### 2. デプロイ

```bash
pnpm cdk deploy
```

### 3. LINE Webhook URL の設定

デプロイ完了後に出力される API Gateway エンドポイント URL を、LINE Developers コンソールの Webhook URL に設定してください。

```
https://{api-id}.execute-api.ap-northeast-1.amazonaws.com/webhook
```

## 開発コマンド

```bash
# 全パッケージのビルド
pnpm build

# Lint
pnpm lint

# 型チェック
pnpm typecheck

# テスト
pnpm test
```

## プロジェクト構成

```
homework-print-bot/
├── .github/workflows/ci.yml
├── .gitignore
├── .npmrc
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── agent/                          # Bedrock AgentCore (Python)
│   │   ├── .bedrock_agentcore.yaml
│   │   ├── pyproject.toml
│   │   └── src/
│   │       ├── __init__.py
│   │       ├── main.py
│   │       ├── adaptive_learning/      # 適応学習エージェント
│   │       │   ├── __init__.py
│   │       │   ├── agent.py
│   │       │   └── stats.py
│   │       ├── grading/                # 採点エージェント
│   │       │   ├── __init__.py
│   │       │   ├── agent.py
│   │       │   └── entrypoint.py
│   │       └── print_generator/        # プリント生成エージェント
│   │           ├── __init__.py
│   │           ├── agent.py
│   │           ├── entrypoint.py
│   │           └── renderer.py
│   ├── functions/                      # LINE Webhook Lambda (TypeScript)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── shared/
│   │       │   ├── family.ts
│   │       │   ├── state.ts
│   │       │   └── units.ts
│   │       └── webhook/
│   │           ├── command-parser.ts
│   │           └── handler.ts
│   └── infra/                          # AWS CDK (TypeScript)
│       ├── bin/app.ts
│       ├── cdk.json
│       ├── package.json
│       ├── tsconfig.json
│       └── lib/
│           ├── constructs/
│           │   ├── api.ts
│           │   ├── dynamodb.ts
│           │   ├── monitoring.ts
│           │   └── s3.ts
│           └── stacks/
│               └── homework-print-bot-stack.ts
└── .kiro/specs/homework-print-bot/
    ├── design.md
    ├── requirements.md
    └── tasks.md
```

## ライセンス

このプロジェクトはプライベートリポジトリです。
