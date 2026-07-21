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

### 3. 環境変数の設定

以下の環境変数を設定してください（`.env` ファイルまたは AWS Systems Manager Parameter Store 等で管理）。

| 変数名 | 説明 |
|--------|------|
| `LINE_CHANNEL_SECRET` | LINE チャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャネルアクセストークン |
| `AWS_REGION` | AWS リージョン（`ap-northeast-1`） |

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
