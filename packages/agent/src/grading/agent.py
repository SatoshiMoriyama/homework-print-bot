"""Grading Agent - reads handwritten answers and grades them."""

import json
import os
import base64
from strands import Agent, tool
from strands.models.bedrock import BedrockModel

BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-5-v1")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")

SYSTEM_PROMPT = """あなたは小学生の回答を採点する先生です。
画像から手書きの回答を読み取り、正解と比較して採点してください。

ルール:
- 数字の「1」と「7」、「6」と「0」の区別に注意
- 読み取れない場合は「判読不能」として該当問題番号を報告する
- 答えだけでなく、式や途中計算も含めて正誤を判定する
- 間違いの種類を分析する（計算ミス、式の立て方ミス等）
- 答えが合っていても式が間違っていれば指摘する

出力形式（JSON）:
{
  "results": [
    {
      "question_number": 1,
      "child_formula": "読み取った式",
      "child_answer": "読み取った答え",
      "is_correct": true/false,
      "is_formula_correct": true/false,
      "error_type": null/"calculation_error"/"formula_error"/etc,
      "readable": true/false
    }
  ],
  "unreadable_questions": [2, 3]
}
"""



def grade_from_image(
    image_bytes: bytes,
    questions: list[dict],
) -> dict:
    """Grade answers from a handwritten image.

    Args:
        image_bytes: The image bytes (JPEG/PNG)
        questions: List of questions with correct answers

    Returns:
        Grading results dict.
    """
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    questions_text = json.dumps(questions, ensure_ascii=False, indent=2)

    prompt = f"""以下の問題の正解情報と、添付画像の手書き回答を比較して採点してください。

問題と正解:
{questions_text}

添付画像には子供の手書き回答があります。
各問題について回答を読み取り、採点してください。
読み取れない箇所は「判読不能」として報告してください。

JSON形式で出力してください:
{{
  "results": [
    {{
      "question_number": 1,
      "child_formula": "読み取った式（あれば）",
      "child_answer": "読み取った答え",
      "is_correct": true,
      "is_formula_correct": true,
      "error_type": null,
      "readable": true
    }}
  ],
  "unreadable_questions": []
}}
"""

    model = BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=AWS_REGION,
    )

    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT)

    # Use multimodal - pass image with the prompt
    response = agent(
        prompt,
        images=[{"format": "jpeg", "source": {"bytes": image_bytes}}],
    )

    response_text = str(response)
    try:
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(response_text[json_start:json_end])
    except json.JSONDecodeError:
        pass

    return {"results": [], "unreadable_questions": [], "error": "Failed to parse"}



def grade_from_text(
    text_answers: list[dict],
    questions: list[dict],
) -> dict:
    """Grade answers provided as text input.

    Args:
        text_answers: List of {"question_number": int, "answer_text": str}
        questions: List of questions with correct answers

    Returns:
        Grading results dict.
    """
    answers_text = json.dumps(text_answers, ensure_ascii=False, indent=2)
    questions_text = json.dumps(questions, ensure_ascii=False, indent=2)

    prompt = f"""以下の問題の正解情報と、テキストで提出された回答を比較して採点してください。

問題と正解:
{questions_text}

テキスト回答:
{answers_text}

各問題について回答を正解と比較し、採点してください。
式も含めて正誤を判定し、間違いの種類を分析してください。

JSON形式で出力してください:
{{
  "results": [
    {{
      "question_number": 1,
      "child_formula": "回答の式",
      "child_answer": "回答の答え",
      "is_correct": true,
      "is_formula_correct": true,
      "error_type": null,
      "readable": true
    }}
  ],
  "unreadable_questions": []
}}
"""

    model = BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=AWS_REGION,
    )

    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT)
    response = agent(prompt)

    response_text = str(response)
    try:
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(response_text[json_start:json_end])
    except json.JSONDecodeError:
        pass

    return {"results": [], "unreadable_questions": [], "error": "Failed to parse"}
