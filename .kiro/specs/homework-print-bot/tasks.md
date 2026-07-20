# 実装タスク: homework-print-bot

#[[file:design.md]]

---

## Phase 1: プロジェクト基盤構築

### Task 1: モノレポ初期セットアップ
- [ ] pnpm-workspace.yaml の作成
- [ ] ルート package.json の作成（workspaces設定）
- [ ] tsconfig.base.json の作成（共通TypeScript設定）
- [ ] .gitignore / .npmrc の作成
- [ ] packages/infra/package.json の作成
- [ ] packages/functions/package.json の作成
- [ ] packages/agent/pyproject.toml の作成
- [ ] pnpm install の実行と動作確認

**関連設計**: 1.2 モノレポ構成

### Task 2: CDK基盤スタック構築
- [ ] CDK App エントリーポイント作成（packages/infra/bin/app.ts）
- [ ] 共通スタック作成（DynamoDB テーブル5つ: parents, children, prints, grading_results, learning_stats, user_state）
- [ ] S3バケット作成（ライフサイクルポリシー: answers/ 30日削除）
- [ ] API Gateway 作成（POST /webhook）
- [ ] Lambda関数定義（line-webhook-handler）
- [ ] IAMロール定義（Lambda実行ロール、AgentCore実行ロール）
- [ ] cdk synth / cdk diff での動作確認

**関連設計**: 3.1 DynamoDB テーブル設計, 3.3 S3 バケット構成, 6.3 IAMポリシー

### Task 3: 単元マスタ定義
- [ ] packages/functions/src/shared/units.ts に MATH_GRADE1_UNITS 定数を定義
- [ ] 単元の型定義（Unit型: order, category, subcategory, label）
- [ ] 単元検索ユーティリティ関数（getUnitByOrder, getNextUnit, getUnitsByCategory）

**関連設計**: 3.2 単元マスタ（設定データ）

---

## Phase 2: LINE連携基盤

### Task 4: LINE Webhook Lambda実装
- [ ] packages/functions/src/webhook/handler.ts 作成
- [ ] LINE署名検証ミドルウェア実装（X-Line-Signature / HMAC-SHA256）
- [ ] Webhook Event パース処理
- [ ] メッセージ種別ルーティング（text / image）
- [ ] LINE Messaging API クライアント初期化（reply / push message）
- [ ] 環境変数設定（LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN）

**関連設計**: 2.1 Lambda: line-webhook-handler, 6.1 LINE Webhook検証

### Task 5: ユーザー状態管理の実装
- [ ] packages/functions/src/shared/state.ts 作成
- [ ] DynamoDB user_state テーブルの CRUD 操作
- [ ] getUserState(lineUserId): 現在の状態取得
- [ ] updateActiveChild(lineUserId, childId): 子供切り替え
- [ ] setWaitingForTextAnswer(lineUserId, printId, questions): テキスト入力待ち設定
- [ ] clearWaitingState(lineUserId): 待ち状態クリア

**関連設計**: 3.1 user_state テーブル

### Task 6: コマンドパーサー実装
- [ ] packages/functions/src/webhook/command-parser.ts 作成
- [ ] 「プリント」コマンドの認識
- [ ] 「りれき」コマンドの認識
- [ ] 子供切り替えコマンドの認識（「たろうくん」等、ニックネーム一致判定）
- [ ] 修正指示の判定（直前にプリント生成済みの場合のテキスト → regenerate）
- [ ] テキスト回答の判定（テキスト入力待ち状態の場合）
- [ ] 不明コマンドのヘルプ応答

**関連設計**: 2.1 routeTextMessage

### Task 7: 保護者・子供管理API実装
- [ ] packages/functions/src/shared/family.ts 作成
- [ ] DynamoDB parents テーブルの CRUD
- [ ] DynamoDB children テーブルの CRUD
- [ ] 保護者登録（初回メッセージ時に自動作成）
- [ ] family_id による保護者紐づけ（2名で同一family_id共有）
- [ ] 子供登録・ニックネーム設定
- [ ] family_id から子供一覧取得

**関連設計**: 3.1 parents テーブル, children テーブル, AC-4.1〜4.5

---

## Phase 3: プリント生成機能

### Task 8: Print Generator Agent 基盤実装
- [ ] packages/agent/src/print_generator/__init__.py 作成
- [ ] BedrockAgentCoreApp セットアップ
- [ ] PrintGeneratorAgent クラス実装（system_prompt定義）
- [ ] Bedrock Claude Sonnet 5 モデル接続設定
- [ ] エントリーポイント実装（action: generate_print / regenerate_print）

**関連設計**: 2.2 Print Generator Agent

### Task 9: 問題生成ロジック実装
- [ ] generate_math_problems ツール実装
- [ ] 単元ごとの問題テンプレート/ルール定義
  - かずとすうじ: 1〜10の数字認識
  - なんばんめ: 順序数の問題
  - いくつといくつ: 合成分解
  - たしざん（繰り上がりなし）: 和が10以下
  - たしざん（繰り上がりあり）: 和が10超
  - ひきざん（繰り下がりなし）: 10以下
  - ひきざん（繰り下がりあり）: 10超からの引き算
  - 3つのかずのけいさん
  - 20よりおおきいかず
  - 文章題（たしざん/ひきざん）
- [ ] 難易度パラメータに応じた問題調整
- [ ] 問題数の単元に応じた自動調整
- [ ] 苦手分野の重点出題ロジック
- [ ] 問題JSONフォーマット出力（問題文、正解の式、正解の答え）

**関連設計**: FR-1.1, FR-1.7

### Task 10: プリントレンダリング実装
- [ ] HTMLテンプレート作成（Handlebars形式、A4サイズ）
- [ ] Noto Sans JP フォント組み込み
- [ ] Puppeteer (chromium-min) による PDF/PNG 変換処理
- [ ] Lambda Layer としての Chromium パッケージング
- [ ] render_print_pdf ツール実装
- [ ] render_print_image ツール実装
- [ ] S3 アップロード（prints/{child_id}/{print_id}.pdf / .png）

**関連設計**: 5.1 レンダリングパイプライン, 5.2 テンプレート仕様, 5.3 フォント要件

### Task 11: プリント再生成（修正指示）実装
- [ ] regenerate_print アクション対応
- [ ] 直前のプリント内容をコンテキストとして保持
- [ ] 修正指示のプロンプト組み込み
- [ ] 再生成後のS3アップロードとDB更新

**関連設計**: FR-1.8, FR-1.9, 1.3 保護者修正→再生成フロー

---

## Phase 4: 採点機能

### Task 12: Grading Agent 基盤実装
- [ ] packages/agent/src/grading/__init__.py 作成
- [ ] GradingAgent クラス実装（system_prompt定義）
- [ ] Bedrock Claude Sonnet 5 マルチモーダル接続
- [ ] エントリーポイント実装（action: grade_answer / grade_text_answer）

**関連設計**: 2.3 Grading Agent

### Task 13: 手書き認識・採点ロジック実装
- [ ] recognize_handwriting ツール実装（画像→テキスト変換）
- [ ] S3から回答画像取得
- [ ] Claude マルチモーダルへの画像+プロンプト送信
- [ ] 認識結果のパース（問題番号ごとの回答抽出）
- [ ] compare_answers ツール実装（正解比較: 式＋答え）
- [ ] analyze_error_type ツール実装（間違い種類の分類）
- [ ] 判読不能判定と該当問題番号リスト生成

**関連設計**: FR-3.1〜3.8

### Task 14: テキスト入力による採点実装
- [ ] grade_text_answer アクション対応
- [ ] テキスト回答のパース（「② 3+5=8 ③ 12-5=7」形式）
- [ ] 既存の画像採点結果との統合
- [ ] user_state の waiting_for_text_answer フロー管理

**関連設計**: 1.3 判読不能時のテキスト入力フロー, FR-3.5〜3.6

### Task 15: 採点結果保存と LINE 応答
- [ ] DynamoDB grading_results テーブルへの保存
- [ ] details 構造の組み立て（式、答え、error_type、input_method）
- [ ] LINE Flex Message での採点結果表示（正解○/不正解✕、間違い解説）
- [ ] 採点完了後の次プリント自動生成トリガー

**関連設計**: 3.1 grading_results テーブル, FR-2.5, AC-1.2

---

## Phase 5: 適応学習エンジン

### Task 16: Adaptive Learning Agent 実装
- [ ] packages/agent/src/adaptive_learning/__init__.py 作成
- [ ] AdaptiveLearningAgent クラス実装
- [ ] 学習履歴取得（DynamoDB learning_stats クエリ）
- [ ] 次の単元・難易度の決定ロジック
  - 現単元の正解率 ≥ 80% → 次の単元解放
  - 正解率 < 70% → 重点出題
  - 連続正解 → 難易度アップ
- [ ] 全単元クリア判定（学年進級）

**関連設計**: 2.4 Adaptive Learning Agent, FR-5.1〜5.8

### Task 17: 学習統計の更新処理
- [ ] learning_stats テーブルの更新ロジック（採点完了時に呼び出し）
- [ ] accuracy_rate の再計算
- [ ] streak_correct の更新（連続正解カウント）
- [ ] current_difficulty の調整
- [ ] is_unlocked の判定と更新
- [ ] children テーブルの current_unit_order 更新

**関連設計**: 3.1 learning_stats テーブル, children テーブル

### Task 18: 学習サマリーレポート実装
- [ ] 「りれき」コマンド対応
- [ ] 子供の全単元の進捗状況取得
- [ ] 正解率・到達単元・苦手分野のサマリー生成
- [ ] LINE メッセージでの表示フォーマット

**関連設計**: FR-4.3, AC-3.4

---

## Phase 6: 結合・運用

### Task 19: エンドツーエンド結合テスト
- [ ] LINE → Webhook → Agent → S3 → LINE の一連フロー確認
- [ ] プリント要求 → 配信の動作確認
- [ ] 回答画像送信 → 採点 → 次プリント配信の動作確認
- [ ] テキスト入力フローの動作確認
- [ ] 修正指示 → 再生成の動作確認
- [ ] 子供切り替えの動作確認
- [ ] 学習履歴表示の動作確認

### Task 20: 監視・運用設定
- [ ] CloudWatch メトリクスダッシュボード作成
- [ ] アラート設定（Lambda エラー率、タイムアウト、コスト）
- [ ] 構造化ログ出力の設定
- [ ] S3ライフサイクルポリシーの適用確認（answers/ 30日削除）

**関連設計**: 8.1〜8.3 監視・運用設計

### Task 21: CI/CD パイプライン構築
- [ ] GitHub Actions ワークフロー作成
- [ ] lint / type-check / unit test の自動実行
- [ ] cdk diff の自動実行（PR時）
- [ ] cdk deploy の自動実行（mainマージ時）
- [ ] agent パッケージのデプロイ（agentcore launch）

**関連設計**: NFR-3 保守性
