"""Adaptive Learning Agent - determines next unit and difficulty."""

import os
import json
import boto3
from strands import Agent
from strands.models.bedrock import BedrockModel

BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "apac.anthropic.claude-sonnet-4-20250514-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
LEARNING_STATS_TABLE = os.environ.get("LEARNING_STATS_TABLE", "homework-bot-learning-stats")
CHILDREN_TABLE = os.environ.get("CHILDREN_TABLE", "homework-bot-children")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)

SYSTEM_PROMPT = """あなたは教育データアナリストです。
児童の学習履歴を分析し、次に出すべき単元と難易度を決定してください。
- 教科書（学習指導要領）の順番に従って単元を進行する
- 現在の単元の正解率が80%以上になったら次の単元を解放する
- 苦手分野（正解率70%未満）は重点的に出題する
- 全単元クリアで次の学年へ進級する
"""

# Unit progression threshold
UNLOCK_THRESHOLD = 0.8
WEAK_THRESHOLD = 0.7
MIN_ATTEMPTS_FOR_UNLOCK = 5


def determine_next_problem(child_id: str, current_unit_order: int) -> dict:
    """Determine the next problem parameters for a child.

    Returns:
        Dict with category, subcategory, difficulty, question_count, weak_areas
    """
    stats_table = dynamodb.Table(LEARNING_STATS_TABLE)

    # Get all stats for this child
    response = stats_table.query(
        KeyConditionExpression="child_id = :cid",
        ExpressionAttributeValues={":cid": child_id},
    )
    all_stats = response.get("Items", [])

    # Find weak areas
    weak_areas = []
    for stat in all_stats:
        if stat.get("is_unlocked") and stat.get("accuracy_rate", 1.0) < WEAK_THRESHOLD:
            if stat.get("total_attempts", 0) >= 3:
                weak_areas.append(stat["subcategory"])

    # Get current unit stats
    current_stats = next(
        (s for s in all_stats if s.get("unit_order") == current_unit_order),
        None,
    )

    # Determine if we should advance
    should_advance = False
    if current_stats:
        accuracy = current_stats.get("accuracy_rate", 0)
        attempts = current_stats.get("total_attempts", 0)
        if accuracy >= UNLOCK_THRESHOLD and attempts >= MIN_ATTEMPTS_FOR_UNLOCK:
            should_advance = True

    # Determine difficulty
    difficulty = 1
    if current_stats:
        streak = current_stats.get("streak_correct", 0)
        accuracy = current_stats.get("accuracy_rate", 0)
        if streak >= 5 or accuracy >= 0.9:
            difficulty = min(current_stats.get("current_difficulty", 1) + 1, 5)
        elif accuracy < 0.5:
            difficulty = max(current_stats.get("current_difficulty", 1) - 1, 1)
        else:
            difficulty = current_stats.get("current_difficulty", 1)

    # Decide subcategory
    from ..print_generator.entrypoint import _get_unit_label

    # Get the unit info
    units = _get_all_units()
    current_unit = next((u for u in units if u["order"] == current_unit_order), None)

    if not current_unit:
        current_unit = units[0]

    subcategory = current_unit["subcategory"]
    category = current_unit["category"]

    # If we should advance and there's a next unit
    if should_advance:
        next_unit = next((u for u in units if u["order"] == current_unit_order + 1), None)
        if next_unit:
            subcategory = next_unit["subcategory"]
            category = next_unit["category"]
            difficulty = 1  # Reset difficulty for new unit

    # Question count based on category
    question_count = 8
    if category == "word_problem":
        question_count = 4
    elif category in ("shape", "measurement", "clock", "data"):
        question_count = 5

    return {
        "category": category,
        "subcategory": subcategory,
        "difficulty": difficulty,
        "question_count": question_count,
        "weak_areas": weak_areas,
        "should_advance": should_advance,
    }


def _get_all_units() -> list[dict]:
    """Get all units in order."""
    return [
        {"order": 1, "category": "number_calculation", "subcategory": "counting_numbers"},
        {"order": 2, "category": "number_calculation", "subcategory": "ordinal_numbers"},
        {"order": 3, "category": "number_calculation", "subcategory": "composition"},
        {"order": 4, "category": "number_calculation", "subcategory": "addition_no_carry"},
        {"order": 5, "category": "number_calculation", "subcategory": "subtraction_no_borrow"},
        {"order": 6, "category": "number_calculation", "subcategory": "addition_with_carry"},
        {"order": 7, "category": "number_calculation", "subcategory": "subtraction_with_borrow"},
        {"order": 8, "category": "number_calculation", "subcategory": "three_numbers"},
        {"order": 9, "category": "number_calculation", "subcategory": "numbers_over_20"},
        {"order": 10, "category": "shape", "subcategory": "shape_play"},
        {"order": 11, "category": "shape", "subcategory": "shape_building"},
        {"order": 12, "category": "measurement", "subcategory": "length_compare"},
        {"order": 13, "category": "measurement", "subcategory": "area_compare"},
        {"order": 14, "category": "measurement", "subcategory": "volume_compare"},
        {"order": 15, "category": "clock", "subcategory": "hour_half"},
        {"order": 16, "category": "data", "subcategory": "counting_survey"},
        {"order": 17, "category": "word_problem", "subcategory": "addition_word"},
        {"order": 18, "category": "word_problem", "subcategory": "subtraction_word"},
    ]
