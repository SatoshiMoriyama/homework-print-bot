# 設計ドキュメント: homework-print-bot

#[[file:requirements.md]]

---

## 1. システムアーキテクチャ

### 1.1 全体構成図

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────────────────┐
│  LINE App       │────▶│ LINE Platform    │────▶│  AWS Cloud (ap-northeast-1)         │
│ (保護者2名)     │◀────│ Messaging API    │◀────│                                     │
└─────────────────┘     └──────────────────┘     │  ┌─────────────────────────────┐   │
                                                  │  │ API Gateway (Webhook)       │   │
                                                  │  └──────────┬──────────────────┘   │
                                                  │             │                      │
                                                  │  ┌──────────▼──────────────────┐   │
                                                  │  │ Lambda: line-webhook-handler │   │
                                                  │  │ (TypeScript / Node.js)       │   │
                                                  │  └──────────┬──────────────────┘   │
                                                  │             │                      │
                                                  │  ┌──────────▼──────────────────┐   │
                                                  │  │ AgentCore Runtime            │   │
                                                  │  │ (Strands Agent / Python)     │   │
                                                  │  │                              │   │
                                                  │  │ ┌────────────────────────┐  │   │
                                                  │  │ │ Print Generator Agent  │  │   │
                                                  │  │ │ Grading Agent          │  │   │
                                                  │  │ │ Adaptive Learning Agent│  │   │
                                                  │  │ └────────────────────────┘  │   │
                                                  │  └──┬───────┬────────┬─────────┘   │
                                                  │     │       │        │             │
                                                  │  ┌──▼──┐ ┌──▼──┐ ┌──▼──┐          │
                                                  │  │ S3  │ │Dyna-│ │Bed- │          │
                                                  │  │     │ │moDB │ │rock │          │
                                                  │  └─────┘ └─────┘ └─────┘          │
                                                  └─────────────────────────────────────┘
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
│   │       └── constructs/
│   ├── functions/              ← Lambda handlers (TypeScript)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── webhook/        ← LINE Webhook handler
│   │       └── shared/         ← 共通ユーティリティ
│   └── agent/                  ← AgentCore (Python / Strands SDK)
│       ├── pyproject.toml
│       └── src/
│           ├── print_generator/
│           ├── grading/
│           └── adaptive_learning/
└── .kiro/
```


### 1.3 処理フロー

#### プリント生成フロー（メッセージ要求）
```
LINE「プリント」
  → API Gateway
    → Lambda (webhook-handler / TypeScript)
      → AgentCore (Print Generator Agent / Python)
        → Bedrock Claude Sonnet 5: 問題生成（学習履歴参照）
        → PDF/画像レンダリング
        → S3にアップロード
      → LINE Reply: プリント画像送信
```

#### 保護者修正→再生成フロー
```
LINE「もう少し簡単にして」
  → API Gateway
    → Lambda (webhook-handler)
      → AgentCore (Print Generator Agent)
        → 直前のプリント文脈を保持した状態で再生成
        → S3にアップロード
      → LINE Reply: 修正版プリント画像送信
```

#### 採点フロー
```
LINE [回答画像送信]
  → API Gateway
    → Lambda (webhook-handler)
      → S3に画像保存
      → AgentCore (Grading Agent / Python)
        → Bedrock Claude Sonnet 5 (マルチモーダル): 手書き認識
        → 正解データと比較・式を含めた採点
        → DynamoDB: 結果保存（子供単位・問題単位）
      → LINE Reply: 採点結果（間違い解説付き）
      → 自動で次のプリント生成・配信（Print Generator Agent起動）
```

#### 判読不能時のテキスト入力フロー
```
LINE [回答画像送信]
  → 採点処理中に②③が判読不能と判定
  → LINE Reply:「②と③のこたえを文字でおくってね（れい: ② 3+5=8）」
  → LINE「② 3+5=8 ③ 12-5=7」
    → Lambda (webhook-handler)
      → AgentCore (Grading Agent): テキスト回答で採点続行
      → 残りの採点結果 + 次のプリント配信
```


---

## 2. コンポーネント設計

### 2.1 Lambda: line-webhook-handler (TypeScript)

**責務**: LINEからのWebhookを受信し、メッセージ種別に応じてルーティングする

```typescript
// 概念的な構造
interface WebhookHandler {
  handleEvent(event: WebhookEvent): Promise<void>;
  handleTextMessage(event: MessageEvent<TextMessage>): Promise<void>;
  handleImageMessage(event: MessageEvent<ImageMessage>): Promise<void>;
}

// テキストメッセージのルーティング
function routeTextMessage(text: string, userId: string): Action {
  // 状態管理: 現在の子供、直前のプリントID、テキスト入力待ち等
  const state = await getUserState(userId);

  if (state.waitingForTextAnswer) {
    return { type: 'grade_text_answer', text, printId: state.pendingPrintId };
  }

  const command = parseCommand(text);
  switch (command.type) {
    case 'print_request':
      return { type: 'generate_print', childId: state.activeChildId };
    case 'history':
      return { type: 'get_history', childId: state.activeChildId };
    case 'switch_child':
      return { type: 'switch_child', childName: command.childName };
    case 'modify_print':
      return { type: 'regenerate_print', instruction: text, printId: state.lastPrintId };
    default:
      return { type: 'help' };
  }
}
```

**設計判断**:
- Lambda関数はWebhookの受信とルーティングのみを担当し、ビジネスロジックはAgentCore側に配置する
- LINE署名検証をLambda層で実施することでセキュリティを確保する
- ユーザー状態（現在の子供、テキスト入力待ち等）はDynamoDBで管理する


### 2.2 AgentCore: Print Generator Agent (Python)

**責務**: 学習プリントの問題生成とレンダリング

```python
class PrintGeneratorAgent:
    """学習プリント生成エージェント"""

    system_prompt = """
    あなたは小学生向けの学習プリントを作成する教育専門家です。
    以下のルールに従って問題を生成してください：
    - 学習指導要領に準拠した内容
    - 児童が理解できる簡単な表現
    - 1枚あたり5〜10問
    - 問題の難易度は指定されたレベルに合わせる
    - 指定された単元に従って出題する
    - 保護者から修正指示がある場合は、直前のプリント内容を踏まえて修正する
    """

    tools = [
        generate_math_problems,    # さんすう問題生成
        render_print_pdf,          # PDF生成
        render_print_image,        # 画像生成
        upload_to_s3,             # S3アップロード
        get_learning_history,      # 学習履歴取得
        get_current_unit,          # 現在の単元取得
    ]
```

**問題生成パラメータ**:
| パラメータ | 説明 | 例 |
|-----------|------|-----|
| child_id | 子供ID | "child_001" |
| category | 大分類 | "number_calculation" |
| subcategory | 小分類 | "addition_no_carry" |
| difficulty | 難易度 (1-5) | 1 (初級) 〜 5 (応用) |
| question_count | 問題数 | 1〜10（単元に応じて調整） |
| weak_areas | 苦手分野リスト | ["subtraction_with_borrow"] |
| modification | 修正指示（再生成時） | "もう少し簡単にして" |

### 2.3 AgentCore: Grading Agent (Python)

**責務**: 回答画像の読み取りと採点（式を含む）

```python
class GradingAgent:
    """回答採点エージェント"""

    system_prompt = """
    あなたは小学生の回答を採点する先生です。
    画像から手書きの回答を読み取り、正解と比較して採点してください。
    - 数字の「1」と「7」、「6」と「0」の区別に注意
    - 読み取れない場合は「判読不能」として該当問題番号を報告する
    - 答えだけでなく、式や途中計算も含めて正誤を判定する
    - 間違いの種類を分析する（計算ミス、式の立て方ミス等）
    - 答えが合っていても式が間違っていれば指摘する
    """

    tools = [
        recognize_handwriting,     # 手書き認識 (Bedrock マルチモーダル)
        compare_answers,           # 正解比較（式含む）
        analyze_error_type,        # 間違い種類の分析
        save_grading_result,       # 採点結果保存
        request_text_input,        # テキスト入力要求（判読不能時）
    ]
```


### 2.4 AgentCore: Adaptive Learning Agent (Python)

**責務**: 学習履歴に基づく単元選定と難易度調整

```python
class AdaptiveLearningAgent:
    """適応学習エージェント"""

    system_prompt = """
    あなたは教育データアナリストです。
    児童の学習履歴を分析し、次に出すべき単元と難易度を決定してください。
    - 教科書（学習指導要領）の順番に従って単元を進行する
    - 現在の単元の正解率が80%以上になったら次の単元を解放する
    - 苦手分野（正解率70%未満）は重点的に出題する
    - 全単元クリアで次の学年へ進級する
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
│   └── {child_id}/{print_id}.pdf
│   └── {child_id}/{print_id}.png
├── answers/
│   └── {child_id}/{print_id}_answer.jpg
└── templates/
    └── print_template.html
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

#### プリント生成リクエスト
```json
{
  "action": "generate_print",
  "child_id": "child_001",
  "params": {
    "category": "number_calculation",
    "subcategory": "addition_no_carry",
    "difficulty": 2,
    "question_count": 8,
    "weak_areas": ["subtraction_no_borrow"]
  }
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
  "answer_image_s3_key": "answers/child_001/01J5X7K_answer.jpg"
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


---

## 5. プリントレンダリング設計

### 5.1 レンダリングパイプライン

```
Bedrock Claude Sonnet 5 (問題JSON生成)
  → HTMLテンプレート適用 (Handlebars等)
    → Puppeteer (Chromium) でPDF/PNG変換
```

**設計判断**:
- HTML/CSSでレイアウトすることでデザインの自由度を確保する
- Puppeteer は Lambda Layer として配置（chromium-min を使用してサイズ削減）
- テンプレートはS3に配置し、単元タイプごとにレイアウトを切り替え可能にする

### 5.2 テンプレート仕様

```html
<!-- A4サイズ: 210mm x 297mm -->
<div class="print-page" style="width: 210mm; height: 297mm; padding: 15mm;">
  <header>
    <h1>さんすう プリント</h1>
    <p class="child-name">なまえ: {{childNickname}}</p>
    <p class="date">ひづけ: ____がつ____にち</p>
    <p class="unit-label">{{unitLabel}}</p>
  </header>

  <section class="questions">
    {{#each questions}}
    <div class="question">
      <span class="q-number">{{circleNumber @index}}</span>
      <span class="q-body">{{this.text}}</span>
      <span class="q-answer-space">_______</span>
    </div>
    {{/each}}
  </section>

  <footer>
    <p>がんばったね！</p>
  </footer>
</div>
```

### 5.3 フォント要件
- メインフォント: Noto Sans JP (丸ゴシック系、児童が読みやすい)
- 問題文サイズ: 18pt以上
- 回答欄: 十分な余白を確保（手書き想定）
- 問題番号: 丸数字（①②③...）


---

## 6. セキュリティ設計

### 6.1 LINE Webhook検証
- X-Line-Signature ヘッダーによるHMAC-SHA256署名検証
- Channel Secretを使用した署名の正当性確認

### 6.2 データ保護
- 回答画像は採点後30日で自動削除（S3ライフサイクルポリシー）
- DynamoDBのデータは暗号化（AWS管理キー）
- 児童の個人情報はニックネームのみ保持

### 6.3 IAMポリシー（最小権限）
```
Lambda実行ロール:
  - bedrock:InvokeModel (Claude Sonnet 5 / Haiku 4.5)
  - dynamodb:PutItem/GetItem/Query (各テーブル)
  - s3:PutObject/GetObject (プリントバケット)
  - agentcore:InvokeAgent

AgentCore実行ロール:
  - bedrock:InvokeModel
  - dynamodb:PutItem/GetItem/Query/UpdateItem (各テーブル)
  - s3:PutObject/GetObject (プリントバケット)
```

---

## 7. エラーハンドリング設計

| エラーケース | 対応 | ユーザーメッセージ |
|-------------|------|-------------------|
| Bedrock API エラー | リトライ(3回) → エラー通知 | 「ごめんなさい、いまプリントをつくれません。すこしまってからもういちどおくってね」 |
| 画像一部判読不能 | テキスト入力要求 | 「②と③がよめなかったよ。文字でこたえをおくってね（れい: ② 3+5=8）」 |
| 画像全体判読不能 | 再撮影依頼 | 「しゃしんがよくみえないよ。あかるいところでもういちどとってね」 |
| 不明なコマンド | ヘルプ表示 | 「つかいかた：\n・「プリント」→がくしゅうプリント\n・「りれき」→がくしゅうのきろく」 |
| LINE API エラー | CloudWatchアラート | （内部エラー、ユーザーには通知なし） |

---

## 8. 監視・運用設計

### 8.1 CloudWatch メトリクス
- Lambda実行時間・エラー率
- Bedrock API呼び出し回数・レイテンシ
- DynamoDBキャパシティ使用率
- プリント生成成功率
- 採点処理成功率

### 8.2 アラート設定
- Lambda エラー率 > 5%: Warning
- Lambda タイムアウト発生: Critical
- 月間コスト > 800円: Warning

### 8.3 ログ構成
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
