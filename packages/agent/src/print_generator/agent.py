"""Print Generator Agent - generates math worksheets for elementary students."""

import json
import os
from strands import Agent, tool
from strands.models.bedrock import BedrockModel

BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "jp.anthropic.claude-sonnet-4-6")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")

SYSTEM_PROMPT = """あなたは小学生向けの学習プリントを作成する教育専門家です。
以下のルールに従って問題を生成してください：
- 学習指導要領に準拠した内容
- 児童が理解できる簡単な表現
- 問題の難易度は指定されたレベルに合わせる
- 指定された単元に従って出題する
- 保護者から修正指示がある場合は、直前のプリント内容を踏まえて修正する
- 必ずJSON形式で問題を出力すること

出力形式:
{
  "questions": [
    {
      "number": 1,
      "text": "3 + 5 = ",
      "correct_formula": "3 + 5 = 8",
      "correct_answer": "8"
    }
  ]
}
"""


def create_agent() -> Agent:
    """Create the Print Generator Agent."""
    model = BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=AWS_REGION,
    )

    return Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[generate_math_problems],
    )


@tool
def generate_math_problems(
    subcategory: str,
    difficulty: int = 1,
    question_count: int = 8,
    weak_areas: str = "",
) -> str:
    """Generate math problems for a given subcategory and difficulty.

    Args:
        subcategory: The unit subcategory (e.g., 'addition_no_carry')
        difficulty: Difficulty level 1-5
        question_count: Number of questions to generate (1-10)
        weak_areas: Comma-separated list of weak areas to focus on
    """
    prompt = _build_generation_prompt(subcategory, difficulty, question_count, weak_areas)

    model = BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=AWS_REGION,
    )

    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT)
    response = agent(prompt)

    return str(response)


def _build_generation_prompt(subcategory: str, difficulty: int, question_count: int, weak_areas: str) -> str:
    """Build the prompt for problem generation based on subcategory."""
    unit_descriptions = {
        "counting_numbers": "1から10までの数を数える問題、数字を書く問題",
        "ordinal_numbers": "順序数の問題（前から何番目、後ろから何番目）",
        "composition": "数の合成分解（5はいくつといくつ）",
        "addition_no_carry": "繰り上がりなしのたし算（和が10以下）",
        "subtraction_no_borrow": "繰り下がりなしのひき算（10以下からの引き算）",
        "addition_with_carry": "繰り上がりありのたし算（和が10を超える）",
        "subtraction_with_borrow": "繰り下がりありのひき算（10を超える数からの引き算）",
        "three_numbers": "3つの数のたし算・ひき算（例: 3+2+4, 10-3-2）",
        "numbers_over_20": "20より大きい数（〜100までの数の読み書き、大小比較）",
        "shape_play": "形の仲間分け（箱・筒・ボールの形）",
        "shape_building": "三角形・四角形を使った形づくり",
        "length_compare": "長さくらべ（直接比較・間接比較）",
        "area_compare": "広さくらべ（広い・狭い）",
        "volume_compare": "かさくらべ（多い・少ない）",
        "hour_half": "時計の読み方（なんじ、なんじはん）",
        "counting_survey": "ものの数を調べて簡単なグラフにする",
        "addition_word": "たし算の文章題（あわせていくつ、ふえるといくつ）",
        "subtraction_word": "ひき算の文章題（のこりはいくつ、ちがいはいくつ）",
    }

    description = unit_descriptions.get(subcategory, "")
    difficulty_desc = {
        1: "とても簡単（基本中の基本）",
        2: "簡単（基本問題）",
        3: "ふつう（標準的な問題）",
        4: "少し難しい（応用的な問題）",
        5: "難しい（チャレンジ問題）",
    }

    prompt = f"""以下の条件で{question_count}問の算数の問題を生成してください。

単元: {subcategory}
内容: {description}
難易度: {difficulty}（{difficulty_desc.get(difficulty, '')}）
問題数: {question_count}問

"""
    if weak_areas:
        prompt += f"苦手分野（重点的に出題）: {weak_areas}\n"

    prompt += """
必ず以下のJSON形式で出力してください。他のテキストは不要です:
{
  "questions": [
    {
      "number": 1,
      "text": "問題文（例: 3 + 5 = ）",
      "correct_formula": "正解の式（例: 3 + 5 = 8）",
      "correct_answer": "正解（例: 8）"
    }
  ]
}
"""
    return prompt


def generate_print(
    child_id: str,
    subcategory: str,
    difficulty: int = 1,
    question_count: int = 8,
    weak_areas: list[str] | None = None,
) -> dict:
    """Generate a print with math problems.

    Returns a dict with questions list ready for rendering.
    """
    weak_str = ",".join(weak_areas) if weak_areas else ""
    prompt = _build_generation_prompt(subcategory, difficulty, question_count, weak_str)

    model = BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=AWS_REGION,
    )

    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT)
    response = agent(prompt)

    # Parse JSON from response
    response_text = str(response)
    try:
        # Try to extract JSON from the response
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            questions_data = json.loads(response_text[json_start:json_end])
            return questions_data
    except json.JSONDecodeError:
        pass

    return {"questions": [], "error": "Failed to parse response"}


def regenerate_print(
    previous_questions: list[dict],
    modification_instruction: str,
) -> dict:
    """Regenerate a print based on modification instructions from parent.

    Args:
        previous_questions: The questions from the previous print
        modification_instruction: The parent's modification request
    """
    prompt = f"""前回のプリントの内容:
{json.dumps(previous_questions, ensure_ascii=False, indent=2)}

保護者からの修正指示: {modification_instruction}

修正指示に従って問題を修正し、以下のJSON形式で出力してください:
{{
  "questions": [
    {{
      "number": 1,
      "text": "問題文",
      "correct_formula": "正解の式",
      "correct_answer": "正解"
    }}
  ]
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

    return {"questions": [], "error": "Failed to parse response"}
