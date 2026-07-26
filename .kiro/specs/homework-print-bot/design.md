# 設計ドキュメント: homework-print-bot

#[[file:requirements.md]]

---

## 1. システムアーキテクチャ

### 1.1 全体構成図

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────────────────────┐
│  LINE App       │────▶│ LINE Platform    │────▶│  AWS Cloud (ap-northeast-1)             │
│ (保護者2名)     │◀────│ Messaging API    │◀────│                                         │
└─────────────────┘     └──────────────────┘     │  ┌─────────────────────────────┐       │
                                                  │  │ API Gateway (Webhook)       │       │
                                                  │  └──────────┬──────────────────┘       │
                                                  │             │                          │
                                                  │  ┌──────────▼──────────────────┐       │
                                                  │  │ Lambda: webhook-handler      │       │
                                                  │  │ (TypeScript / Node.js 20.x)  │       │
                                                  │  └──────┬───────────┬───────────┘       │
                                                  │         │           │                   │
                                                  │  ┌──────▼────┐  ┌──▼────────────────┐  │
                                                  │  │ AgentCore  │  │ Lambda: Renderer   │  │
                                                  │  │ Runtime    │  │ (TypeScript/Node)  │  │
                                                  │  │ (Python)   │  │ @sparticuz/chromium│  │
                                                  │  └──┬──┬──┬──┘  └────────┬───────────┘  │
                                                  │     │  │  │              │              │
                                                  │  ┌──▼──▼──▼──────────────▼──┐          │
                                                  │  │  S3  │  DynamoDB  │ Bedrock│          │
                                                  │  └──────────────────────────┘          │
                                                  └─────────────────────────────────────────┘
```


### 1.2 モノレポ構成

```
homework-print-bot/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── packages/
│   ├── infra/                  ← AWS CDK (TypeScript)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── lib/
│   │       ├── stacks/
│   │       │   └── homework-print-bot-stack.ts
│   │       └── constructs/
│   │           ├── agentcore.ts
│   │           ├── api.ts
│   │           ├── dynamodb.ts
│   │           ├── monitoring.ts
│   │           ├── renderer.ts
│   │           └── s3.ts
│   ├── functions/              ← Lambda handlers (TypeScript)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── webhook/        ← LINE Webhook handler
│   │       ├── renderer/       ← HTML→PNG Renderer Lambda
│   │       │   ├── index.ts
│   │       │   └── fonts/      ← NotoSansJP + NotoColorEmoji + fonts.conf
│   │       └── shared/         ← 共通ユーティリティ
│   │           ├── agentcore.ts
│   │           ├── renderer.ts
│   │           ├── s3.ts
│   │           ├── state.ts
│   │           └── family.ts
│   └── agent/                  ← AgentCore (Python / Strands SDK)
│       ├── pyproject.toml
│       ├── entrypoint.py
│       ├── fonts/              ← NotoSansJP + fonts.conf
│       └── src/
│           ├── print_generator/
│           │   ├── agent.py
│           │   ├── renderer.py
│           │   └── entrypoint.py
│           ├── grading/
│           └── adaptive_learning/
└── .kiro/
```


### 1.3 処理フロー

#### プリント生成フロー（2段階レンダリング）
```
LINE「プリント」
  → API Gateway
    → Lambda (webhook-handler / TypeScript)
      → AgentCore (Print Generator Agent / Python)
        → Bedrock Claude Sonnet 4: 問題JSON生成（学習履歴参照）
        → renderer.py: HTML生成（Pythonテンプレート + string replace）
        → S3にHTMLアップロード (prints/{child_id}/{print_id}.html)
        → レスポンス: { s3_key, needs_rendering: true }
      → Lambda (webhook-handler)
        → Renderer Lambda 同期Invoke (s3Key → PNG変換)
          → S3からHTMLダウンロード
          → @sparticuz/chromium + puppeteer-core でPNG変換
          → PNGをS3にアップロード (prints/{child_id}/{print_id}.png)
          → レスポンス: { pngS3Key }
        → S3 presigned URL生成（有効期限6時間）
        → LINE画像メッセージ送信
```

#### 保護者修正→再生成フロー
```
LINE「もう少し簡単にして」
  → API Gateway
    → Lambda (webhook-handler)
      → AgentCore (Print Generator Agent)
        → 直前のプリント文脈を保持した状態で再生成
        → HTML生成 → S3にアップロード
      → Renderer Lambda同期Invoke → PNG変換
      → LINE Reply: 修正版プリント画像送信
```

#### 採点フロー
```
LINE [回答画像送信]
  → API Gateway
    → Lambda (webhook-handler)
      → LINE APIから画像ダウンロード
      → S3に画像保存 (answers/{child_id}/{messageId}.jpg)
      → AgentCore (Grading Agent / Python)
        → Bedrock Claude Sonnet 4 (マルチモーダル): 手書き認識
        → 正解データと比較・式を含めた採点
        → DynamoDB: 結果保存（子供単位・問題単位）
      → LINE Reply: 採点結果（間違い解説付き）
```

#### 判読不能時のテキスト入力フロー
```
LINE [回答画像送信]
  → 採点処理中に②③が判読不能と判定
  → LINE Reply:「②と③のこたえを文字でおくってね（れい: ② 3+5=8）」
  → LINE「② 3+5=8 ③ 12-5=7」
    → Lambda (webhook-handler)
      → AgentCore (Grading Agent): テキスト回答で採点続行
      → LINE Reply: 採点結果
```


---

## 2. コンポーネント設計

### 2.1 Lambda: webhook-handler (TypeScript)

**責務**: LINEからのWebhookを受信し、メッセージ種別に応じてルーティングする

```typescript
// 主要な処理フロー
interface WebhookHandler {
  handleEvent(event: WebhookEvent): Promise<void>;
  handleTextMessage(replyToken, userId, text, familyId, state): Promise<void>;
  handleImageMessage(replyToken, userId, messageId, state): Promise<void>;
}

// テキストメッセージのルーティング (command-parser.ts)
function parseCommand(text: string, childNames: string[]): Command {
  // "プリント" / "ぷりんと" / "もんだい" → print_request
  // "りれき" → history
  // "登録 ○○くん" → register_child
  // 登録済み子供名 → switch_child
  // 修正指示検出 → modify_print (isModificationInstruction)
  // その他 → help
}
```

**設計判断**:
- Lambda関数はWebhookの受信とルーティングのみを担当し、ビジネスロジックはAgentCore側に配置する
- LINE署名検証をLambda層で実施することでセキュリティを確保する
- ユーザー状態（現在の子供、テキスト入力待ち等）はDynamoDBで管理する
- LINEシークレットはSSM Parameter Store（SecureString）からコールドスタート時に取得しキャッシュする
- Renderer Lambdaの同期Invokeにより、HTML→PNG変換を処理する

### 2.2 Lambda: Renderer (TypeScript)

**責務**: S3上のHTMLファイルをPNG画像に変換する

```typescript
interface RendererEvent {
  s3Key: string;       // 入力HTMLのS3キー（.html拡張子必須）
  bucketName?: string; // S3バケット名（省略時は環境変数BUCKET_NAME）
}

interface RendererResponse {
  pngS3Key: string;    // 出力PNGのS3キー（.htmlを.pngに置換）
}
```

**動作**:
1. S3からHTMLダウンロード
2. `/tmp/fonts` にNoto Sans JP + Noto Color Emoji + fonts.confをコピー（ウォームスタート時はスキップ）
3. `FONTCONFIG_PATH`/`FONTCONFIG_FILE` 環境変数を設定
4. `@sparticuz/chromium` でChromiumバイナリを取得し `puppeteer-core` でブラウザ起動
5. ビューポート 794×1123（A4@96dpi）でHTMLレンダリング → fullPage screenshot
6. PNGをS3にアップロード（拡張子 `.html` → `.png`）

**CDK構成** (`RendererConstruct`):
- `NodejsFunction` (Node.js 20.x, 2048MB, 60秒タイムアウト)
- `nodeModules`: `@sparticuz/chromium`, `puppeteer-core`
- `commandHooks.afterBundling`: フォントファイル3点をバンドルにコピー


### 2.3 AgentCore: Print Generator Agent (Python)

**責務**: 学習プリントの問題生成とHTML出力

```python
# agent.py - Strands Agents SDK ベース
BEDROCK_MODEL_ID = "jp.anthropic.claude-sonnet-4-6"

class PrintGeneratorAgent:
    """学習プリント生成エージェント (Strands Agent)"""

    system_prompt = """
    あなたは小学生向けの学習プリントを作成する教育専門家です。
    - 学習指導要領に準拠した内容
    - 児童が理解できる簡単な表現
    - 問題の難易度は指定されたレベルに合わせる
    - 指定された単元に従って出題する
    - 必ずJSON形式で問題を出力すること
    """

    tools = [generate_math_problems]  # @tool デコレータで定義
```

**問題生成パラメータ**:
| パラメータ | 説明 | 例 |
|-----------|------|-----|
| child_id | 子供ID | "child_001" |
| subcategory | 小分類 | "addition_no_carry" |
| difficulty | 難易度 (1-5) | 1 (初級) 〜 5 (応用) |
| question_count | 問題数 | 1〜10（デフォルト8問） |
| weak_areas | 苦手分野リスト | ["subtraction_with_borrow"] |
| modification_instruction | 修正指示（再生成時） | "もう少し簡単にして" |

**レンダリング** (`renderer.py`):
- 問題JSONをHTMLに変換（Pythonインラインテンプレート + string replace）
- プレースホルダー: `{{UNIT_LABEL}}`, `{{QUESTIONS_HTML}}`
- 問題番号は丸数字（①②③...）で表示
- Playwright（オプション）でPDF/PNG直接出力も可能（ローカル開発・テスト用）
- 本番環境ではHTMLをS3にアップロードし、Renderer Lambdaに変換を委譲する

### 2.4 AgentCore: Grading Agent (Python)

**責務**: 回答画像の読み取りと採点（式を含む）

```python
class GradingAgent:
    """回答採点エージェント (Strands Agent)"""

    system_prompt = """
    あなたは小学生の回答を採点する先生です。
    - 画像から手書きの回答を読み取り、正解と比較して採点する
    - 読み取れない場合は「判読不能」として該当問題番号を報告する
    - 答えだけでなく、式や途中計算も含めて正誤を判定する
    - 間違いの種類を分析する（計算ミス、式の立て方ミス等）
    """
```

### 2.5 AgentCore: Adaptive Learning Agent (Python)

**責務**: 学習履歴に基づく単元選定と難易度調整

```python
class AdaptiveLearningAgent:
    """適応学習エージェント (Strands Agent)"""

    system_prompt = """
    あなたは教育データアナリストです。
    - 教科書（学習指導要領）の順番に従って単元を進行する
    - 現在の単元の正解率が80%以上になったら次の単元を解放する
    - 苦手分野（正解率70%未満）は重点的に出題する
    """
```


---

## 3. データモデル

### 3.1 DynamoDB テーブル設計

#### parents テーブル
| 属性名 | 型 | キー | 説明 |
|--------|-----|------|------|
| line_user_id | String | PK | LINE UserID |
| family_id | String | - | 家族ID（保護者2名で共有） |
| display_name | String | - | LINE表示名 |
| created_at | String | - | 登録日時 (ISO8601) |

#### children テーブル
| 属性名 | 型 | キー | 説明 |
|--------|-----|------|------|
| child_id | String | PK | 子供一意ID (ULID) |
| family_id | String | GSI-PK | 家族ID |
| nickname | String | - | ニックネーム（例: たろうくん） |
| current_grade | Number | - | 現在の学年 (1〜6) |
| current_unit_order | Number | - | 現在到達している単元の順番 |
| created_at | String | - | 登録日時 |

#### prints テーブル
| 属性名 | 型 | キー | 説明 |
|--------|-----|------|------|
| print_id | String | PK | プリント一意ID (ULID) |
| child_id | String | GSI-PK | 子供ID |
| created_at | String | GSI-SK | 作成日時 |
| category | String | - | 大分類 (number_calculation等) |
| subcategory | String | - | 小分類 (addition_no_carry等) |
| difficulty | Number | - | 難易度 (1-5) |
| questions | List | - | 問題リスト（問題文、正解の式、正解の答え） |
| s3_key | String | - | プリント画像のS3キー |
| status | String | - | ステータス (generated/submitted/graded) |

#### grading_results テーブル
| 属性名 | 型 | キー | 説明 |
|--------|-----|------|------|
| result_id | String | PK | 採点結果ID (ULID) |
| print_id | String | GSI-PK | 対応するプリントID |
| child_id | String | GSI-PK | 子供ID |
| graded_at | String | GSI-SK | 採点日時 |
| score | Number | - | 正解数 |
| total | Number | - | 問題数 |
| details | List | - | 各問の詳細（下記参照） |
| answer_image_s3_key | String | - | 回答画像のS3キー |

**details の構造（各問）:**
```json
{
  "question_number": 1,
  "question_text": "3 + 5 = ?",
  "correct_formula": "3 + 5 = 8",
  "correct_answer": "8",
  "child_formula": "3 + 5 = 8",
  "child_answer": "8",
  "is_correct": true,
  "is_formula_correct": true,
  "error_type": null,
  "input_method": "image"
}
```

**error_type の種類:**
- `calculation_error`: 計算ミス（式は合っているが計算結果が違う）
- `formula_error`: 式の立て方ミス（引き算を足し算にしている等）
- `transcription_error`: 文字の書き間違い
- `partial_correct`: 答えは合っているが式が間違い
- `unreadable`: 判読不能（テキスト入力に切り替え）

**input_method:**
- `image`: 画像から読み取り
- `text`: テキスト手入力


#### learning_stats テーブル
| 属性名 | 型 | キー | 説明 |
|--------|-----|------|------|
| child_id | String | PK | 子供ID |
| subcategory | String | SK | "addition_no_carry" 等 |
| category | String | - | 大分類 |
| total_attempts | Number | - | 総回答数 |
| correct_count | Number | - | 正解数 |
| accuracy_rate | Number | - | 正解率 (0.0〜1.0) |
| current_difficulty | Number | - | 現在の難易度 |
| last_attempted_at | String | - | 最終回答日時 |
| streak_correct | Number | - | 連続正解数 |
| unit_order | Number | - | 教科書上の単元順序 |
| is_unlocked | Boolean | - | 解放済みか |

#### user_state テーブル
| 属性名 | 型 | キー | 説明 |
|--------|-----|------|------|
| line_user_id | String | PK | LINE UserID |
| active_child_id | String | - | 現在選択中の子供ID |
| last_print_id | String | - | 直前に生成したプリントID |
| waiting_for_text_answer | Boolean | - | テキスト入力待ち状態か |
| pending_questions | List | - | テキスト入力を待っている問題番号リスト |
| updated_at | String | - | 最終更新日時 |

### 3.2 単元マスタ（設定データ）

```typescript
// 教科書順に定義する単元マスタ
const MATH_GRADE1_UNITS = [
  // 大分類: 数と計算
  { order: 1, category: "number_calculation", subcategory: "counting_numbers", label: "かずとすうじ" },
  { order: 2, category: "number_calculation", subcategory: "ordinal_numbers", label: "なんばんめ" },
  { order: 3, category: "number_calculation", subcategory: "composition", label: "いくつといくつ" },
  { order: 4, category: "number_calculation", subcategory: "addition_no_carry", label: "たしざん（くりあがりなし）" },
  { order: 5, category: "number_calculation", subcategory: "subtraction_no_borrow", label: "ひきざん（くりさがりなし）" },
  { order: 6, category: "number_calculation", subcategory: "addition_with_carry", label: "たしざん（くりあがりあり）" },
  { order: 7, category: "number_calculation", subcategory: "subtraction_with_borrow", label: "ひきざん（くりさがりあり）" },
  { order: 8, category: "number_calculation", subcategory: "three_numbers", label: "3つのかずのけいさん" },
  { order: 9, category: "number_calculation", subcategory: "numbers_over_20", label: "20よりおおきいかず" },
  // 大分類: 図形
  { order: 10, category: "shape", subcategory: "shape_play", label: "かたちあそび" },
  { order: 11, category: "shape", subcategory: "shape_building", label: "かたちづくり" },
  // 大分類: 測定
  { order: 12, category: "measurement", subcategory: "length_compare", label: "ながさくらべ" },
  { order: 13, category: "measurement", subcategory: "area_compare", label: "ひろさくらべ" },
  { order: 14, category: "measurement", subcategory: "volume_compare", label: "かさくらべ" },
  // 大分類: 時計
  { order: 15, category: "clock", subcategory: "hour_half", label: "なんじ なんじはん" },
  // 大分類: データ
  { order: 16, category: "data", subcategory: "counting_survey", label: "ものの数しらべ" },
  // 大分類: 文章題
  { order: 17, category: "word_problem", subcategory: "addition_word", label: "たしざんの文章題" },
  { order: 18, category: "word_problem", subcategory: "subtraction_word", label: "ひきざんの文章題" },
];
```


### 3.3 S3 バケット構成

```
homework-print-bot-{account-id}/
├── prints/
│   └── {child_id}/
│       ├── {print_id}.html       ← Agent生成のHTML（中間ファイル）
│       └── {print_id}.png        ← Renderer Lambda変換後のPNG
└── answers/
    └── {child_id}/
        └── {messageId}.jpg       ← LINE画像メッセージから保存した回答画像
```

---

## 4. API設計

### 4.1 LINE Webhook エンドポイント

```
POST /webhook
Content-Type: application/json
X-Line-Signature: {signature}

Body: LINE Webhook Event Object
```

### 4.2 内部API（AgentCore呼び出し）

**呼び出し方式**: `@aws-sdk/client-bedrock-agentcore` の `InvokeAgentRuntimeCommand`
- `agentRuntimeArn`: AgentCoreランタイムのARN（環境変数 `AGENTCORE_RUNTIME_ARN`）
- `runtimeSessionId`: LINE user ID（セッションアフィニティ）
- `payload`: JSON文字列をUTF-8エンコードしたバイト列

**レスポンス形式**: event-stream（`data: ` プレフィックス付きの行区切り）
- 最後の `data: ` 行に最終JSONレスポンスが含まれる
- パース戦略: 全行を結合 → 最後の `data: ` 行のJSON → plain JSONフォールバック

#### プリント生成リクエスト
```json
{
  "action": "generate_print",
  "child_id": "child_001",
  "params": {
    "subcategory": "addition_no_carry",
    "difficulty": 2,
    "question_count": 8
  }
}
```

**レスポンス**:
```json
{
  "print_id": "01J5X7K...",
  "s3_key": "prints/child_001/01J5X7K....html",
  "needs_rendering": true
}
```

#### プリント再生成リクエスト（修正指示）
```json
{
  "action": "regenerate_print",
  "child_id": "child_001",
  "print_id": "01J5X7K...",
  "modification_instruction": "もう少し簡単にして"
}
```

#### 採点リクエスト（画像）
```json
{
  "action": "grade_answer",
  "child_id": "child_001",
  "print_id": "01J5X7K...",
  "answer_image_s3_key": "answers/child_001/msg123456.jpg"
}
```

#### 採点リクエスト（テキスト入力）
```json
{
  "action": "grade_text_answer",
  "child_id": "child_001",
  "print_id": "01J5X7K...",
  "text_answers": [
    { "question_number": 2, "answer_text": "3+5=8" },
    { "question_number": 3, "answer_text": "12-5=7" }
  ]
}
```

#### 学習履歴リクエスト
```json
{
  "action": "get_learning_summary",
  "child_id": "child_001"
}
```

### 4.3 Renderer Lambda呼び出し

**呼び出し方式**: `@aws-sdk/client-lambda` の `InvokeCommand`（同期 `RequestResponse`）
- `FunctionName`: 環境変数 `RENDERER_FUNCTION_NAME`

```json
// リクエスト
{
  "s3Key": "prints/child_001/01J5X7K....html",
  "bucketName": "homework-print-bot-123456789"
}
// レスポンス
{
  "pngS3Key": "prints/child_001/01J5X7K....png"
}
```


---

## 5. プリントレンダリング設計

### 5.1 レンダリングパイプライン（2段階構成）

```
Bedrock Claude Sonnet 4 (問題JSON生成)
  → Python Agent (renderer.py): HTML生成（インラインテンプレート + string replace）
    → S3にHTMLアップロード
      → Renderer Lambda: @sparticuz/chromium + puppeteer-core でPNG変換
        → S3にPNGアップロード
```

**設計判断**:
- HTML/CSSでレイアウトすることでデザインの自由度を確保する
- テンプレートはPythonコード内にインライン定義（S3やHandlebarsは使用しない）
- プレースホルダーは `{{UNIT_LABEL}}` と `{{QUESTIONS_HTML}}` の単純なstring replace
- Renderer Lambdaは `NodejsFunction` CDK構成で `@sparticuz/chromium` + `puppeteer-core` を使用
- Python Agent側にもPlaywrightによるローカルレンダリング機能あり（開発・テスト用）
- 本番フローではHTMLをS3に保存し、Webhook HandlerがRenderer Lambdaを同期Invokeする

### 5.2 テンプレート仕様（renderer.py インライン）

```html
<!-- A4サイズ: 210mm x 297mm, Pythonインラインテンプレート -->
<div class="print-page" style="width: 210mm; height: 297mm; padding: 15mm;">
  <header>
    <h1>さんすう プリント</h1>
    <div class="meta-row">
      <span>なまえ: __________________</span>
      <span>ひづけ: ____がつ____にち</span>
    </div>
    <p class="unit-label">{{UNIT_LABEL}}</p>
  </header>

  <section class="questions">
    {{QUESTIONS_HTML}}
    <!-- 各問題: <div class="question"><span class="q-number">①</span>
         <span class="q-body">3 + 5 = </span>
         <span class="q-answer-space"></span></div> -->
  </section>

  <footer>
    <p>がんばったね！ ⭐</p>
  </footer>
</div>
```

**HTML生成関数** (`render_html`):
- 引数: `questions` (list[dict]), `unit_label` (str), `child_nickname` (str, optional)
- 問題番号は丸数字 ①②③...⑩ で自動付番
- child_nickname 指定時は「なまえ:」欄に名前を埋め込む

### 5.3 フォント要件
- メインフォント: Noto Sans JP（`@font-face` で `/tmp/fonts/NotoSansJP-Regular.ttf` を参照）
- 絵文字フォント: Noto Color Emoji（Renderer Lambdaでバンドル）
- 問題文サイズ: 20pt（`.question`クラス）
- ヘッダーサイズ: 24pt
- fontconfig: `/tmp/fonts/fonts.conf` で設定（`FONTCONFIG_PATH`/`FONTCONFIG_FILE` 環境変数）
- フォントファイルはLambdaコールドスタート時に `/tmp/fonts` にコピー（ウォームスタート時はスキップ）


---

## 6. CDKインフラストラクチャ設計

### 6.1 スタック構成

`HomeworkPrintBotStack` — 単一スタックに全リソースを配置

```typescript
// homework-print-bot-stack.ts
const dynamodb = new DynamoDbConstruct(this, "DynamoDB");
const s3 = new S3Construct(this, "S3");
const api = new ApiConstruct(this, "Api", { tables, bucket });
const renderer = new RendererConstruct(this, "Renderer", { bucket });
// renderer → webhook-handler の Invoke権限付与
renderer.rendererFunction.grantInvoke(api.webhookHandler);
api.webhookHandler.addEnvironment("RENDERER_FUNCTION_NAME", renderer.rendererFunction.functionName);
new AgentCoreConstruct(this, "AgentCore", { tables, bucket, webhookHandler });
new MonitoringConstruct(this, "Monitoring", { webhookHandler });
```

### 6.2 CDKコンストラクト一覧

| コンストラクト | 責務 | 主要リソース |
|--------------|------|-------------|
| `DynamoDbConstruct` | テーブル定義 | 6テーブル (parents, children, prints, grading_results, learning_stats, user_state) |
| `S3Construct` | ファイルストレージ | S3バケット |
| `ApiConstruct` | Webhook API | API Gateway + webhook-handler Lambda (Node.js 20.x, 256MB, 60s) |
| `RendererConstruct` | HTML→PNG変換 | Renderer Lambda (`NodejsFunction`, Node.js 20.x, 2048MB, 60s) |
| `AgentCoreConstruct` | AIエージェント基盤 | `agentcore.Runtime` + `AgentRuntimeArtifact.fromCodeAsset` (Python 3.12) |
| `MonitoringConstruct` | 監視 | CloudWatchアラーム |

### 6.3 IAMポリシー（最小権限）

```
Webhook Handler Lambda:
  - ssm:GetParameter (/homework-bot/*)
  - kms:Decrypt (SSMパラメータ復号)
  - dynamodb:PutItem/GetItem/Query (全テーブル)
  - s3:PutObject/GetObject (プリントバケット)
  - bedrock:InvokeModel
  - lambda:InvokeFunction (Renderer Lambda)
  - bedrockagentcore:InvokeAgentRuntime (AgentCoreから付与)

Renderer Lambda:
  - s3:GetObject/PutObject (プリントバケット)

AgentCore Runtime:
  - bedrock:InvokeModel
  - bedrock:InvokeModelWithResponseStream
  - dynamodb:PutItem/GetItem/Query/UpdateItem (全テーブル)
  - s3:PutObject/GetObject (プリントバケット)
```

### 6.4 AgentCore構成

```typescript
// AgentCoreConstruct
const artifact = agentcore.AgentRuntimeArtifact.fromCodeAsset({
  path: "packages/agent",
  runtime: agentcore.AgentCoreRuntime.PYTHON_3_12,
  entrypoint: ["entrypoint.py"],
});

new agentcore.Runtime(this, "HomeworkPrintBot", {
  runtimeName: "HomeworkPrintBot",
  agentRuntimeArtifact: artifact,
  environmentVariables: {
    CHILDREN_TABLE, PRINTS_TABLE, GRADING_RESULTS_TABLE,
    LEARNING_STATS_TABLE, BUCKET_NAME,
    BEDROCK_MODEL_ID: "jp.anthropic.claude-sonnet-4-6",
    FONTCONFIG_PATH: "/tmp/fonts",
  },
});
```


---

## 7. セキュリティ設計

### 7.1 LINE Webhook検証
- X-Line-Signature ヘッダーによるHMAC-SHA256署名検証
- Channel Secret を SSM Parameter Store (SecureString) から取得

### 7.2 シークレット管理
- LINEチャネルシークレット: `/homework-bot/line-channel-secret` (SSM SecureString)
- LINEアクセストークン: `/homework-bot/line-channel-access-token` (SSM SecureString)
- Lambda実行時にSSMから取得し、グローバル変数にキャッシュ（ウォームスタートで再取得しない）

### 7.3 データ保護
- 回答画像は採点後30日で自動削除（S3ライフサイクルポリシー）
- DynamoDBのデータは暗号化（AWS管理キー）
- 児童の個人情報はニックネームのみ保持
- S3 presigned URLの有効期限は6時間（`DEFAULT_EXPIRES_IN = 21600`）

---

## 8. エラーハンドリング設計

| エラーケース | 対応 | ユーザーメッセージ |
|-------------|------|-------------------|
| AgentCore呼び出しエラー | catch → pushText | 「プリント生成中にエラーが発生しました。もう一度試してね。」 |
| 画像一部判読不能 | status: "partial" + pending_questions | 「一部読み取れない問題がありました（②③番）。テキストで回答を送ってね。」 |
| 画像全体判読不能 | エラーメッセージ | 「しゃしんがよくみえないよ。あかるいところでもういちどとってね」 |
| 不明なコマンド | HELP_MESSAGE表示 | 「つかいかた：\n・「プリント」→がくしゅうプリント\n・「りれき」→がくしゅうのきろく」 |
| LINE署名検証失敗 | 403 返却 | （レスポンスなし） |
| Renderer Lambda エラー | FunctionError検出 → throw | 「プリント生成中にエラーが発生しました。」 |
| S3キー拡張子不正 | Renderer側でthrow | 内部エラー（ユーザーには生成エラーとして通知） |

---

## 9. 監視・運用設計

### 9.1 CloudWatch メトリクス
- Lambda実行時間・エラー率（webhook-handler, renderer）
- AgentCore Runtime実行時間
- Bedrock API呼び出し回数・レイテンシ
- DynamoDBキャパシティ使用率
- プリント生成成功率
- 採点処理成功率

### 9.2 アラート設定
- Lambda エラー率 > 5%: Warning
- Lambda タイムアウト発生: Critical
- 月間コスト > 800円: Warning

### 9.3 ログ構成
```json
{
  "level": "INFO",
  "timestamp": "2026-07-20T10:00:00Z",
  "request_id": "xxx",
  "child_id": "child_001",
  "action": "generate_print",
  "subcategory": "addition_no_carry",
  "duration_ms": 5200,
  "status": "success"
}
```
