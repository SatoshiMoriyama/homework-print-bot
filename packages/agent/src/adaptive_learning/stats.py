"""Learning statistics update logic."""

import os
from datetime import datetime
from decimal import Decimal
import boto3

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
LEARNING_STATS_TABLE = os.environ.get("LEARNING_STATS_TABLE", "homework-bot-learning-stats")
CHILDREN_TABLE = os.environ.get("CHILDREN_TABLE", "homework-bot-children")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)

UNLOCK_THRESHOLD = 0.8
MIN_ATTEMPTS_FOR_UNLOCK = 5


def update_learning_stats(child_id: str, grading_details: list[dict], subcategory: str, category: str) -> dict:
    """Update learning statistics after grading.

    Args:
        child_id: The child's ID
        grading_details: List of grading detail dicts
        subcategory: The subcategory that was tested
        category: The category that was tested

    Returns:
        Updated stats dict.
    """
    stats_table = dynamodb.Table(LEARNING_STATS_TABLE)

    # Get current stats
    response = stats_table.get_item(Key={"child_id": child_id, "subcategory": subcategory})
    current = response.get("Item")

    # Calculate new stats
    new_correct = sum(1 for d in grading_details if d.get("is_correct"))
    new_total = len(grading_details)

    if current:
        total_attempts = current.get("total_attempts", 0) + new_total
        correct_count = current.get("correct_count", 0) + new_correct
        accuracy_rate = correct_count / total_attempts if total_attempts > 0 else 0

        # Update streak
        all_correct = all(d.get("is_correct") for d in grading_details)
        streak = (current.get("streak_correct", 0) + len(grading_details)) if all_correct else 0

        # Update difficulty
        current_difficulty = current.get("current_difficulty", 1)
        if streak >= 5 or accuracy_rate >= 0.9:
            current_difficulty = min(current_difficulty + 1, 5)
        elif accuracy_rate < 0.5 and total_attempts >= 5:
            current_difficulty = max(current_difficulty - 1, 1)
    else:
        total_attempts = new_total
        correct_count = new_correct
        accuracy_rate = correct_count / total_attempts if total_attempts > 0 else 0
        streak = new_total if all(d.get("is_correct") for d in grading_details) else 0
        current_difficulty = 1

    # Determine if unit should be unlocked
    is_unlocked = True  # Current unit is always unlocked
    unit_order = _get_unit_order(subcategory)

    # Save stats
    stats_table.put_item(
        Item={
            "child_id": child_id,
            "subcategory": subcategory,
            "category": category,
            "total_attempts": total_attempts,
            "correct_count": correct_count,
            "accuracy_rate": Decimal(str(round(accuracy_rate, 3))),
            "current_difficulty": current_difficulty,
            "last_attempted_at": datetime.now().isoformat(),
            "streak_correct": streak,
            "unit_order": unit_order,
            "is_unlocked": is_unlocked,
        }
    )

    # Check if child should advance to next unit
    should_advance = accuracy_rate >= UNLOCK_THRESHOLD and total_attempts >= MIN_ATTEMPTS_FOR_UNLOCK
    if should_advance:
        _try_unlock_next_unit(child_id, unit_order)

    return {
        "accuracy_rate": accuracy_rate,
        "total_attempts": total_attempts,
        "streak_correct": streak,
        "should_advance": should_advance,
    }


def _try_unlock_next_unit(child_id: str, current_order: int) -> None:
    """Try to unlock the next unit for the child."""
    next_order = current_order + 1
    next_subcategory = _get_subcategory_by_order(next_order)

    if not next_subcategory:
        # All units complete - grade advancement would happen here
        return

    stats_table = dynamodb.Table(LEARNING_STATS_TABLE)

    # Check if next unit already exists
    response = stats_table.get_item(Key={"child_id": child_id, "subcategory": next_subcategory})
    if not response.get("Item"):
        # Create initial stats for next unit
        stats_table.put_item(
            Item={
                "child_id": child_id,
                "subcategory": next_subcategory,
                "category": _get_category_by_order(next_order),
                "total_attempts": 0,
                "correct_count": 0,
                "accuracy_rate": Decimal("0"),
                "current_difficulty": 1,
                "last_attempted_at": "",
                "streak_correct": 0,
                "unit_order": next_order,
                "is_unlocked": True,
            }
        )

    # Update child's current unit order
    children_table = dynamodb.Table(CHILDREN_TABLE)
    children_table.update_item(
        Key={"child_id": child_id},
        UpdateExpression="SET current_unit_order = :u",
        ExpressionAttributeValues={":u": next_order},
    )


def get_learning_summary(child_id: str) -> dict:
    """Get a learning summary for a child.

    Returns:
        Summary dict with progress info.
    """
    stats_table = dynamodb.Table(LEARNING_STATS_TABLE)

    response = stats_table.query(
        KeyConditionExpression="child_id = :cid",
        ExpressionAttributeValues={":cid": child_id},
    )
    all_stats = response.get("Items", [])

    if not all_stats:
        return {"message": "まだ学習りれきがないよ！「プリント」と送ってはじめよう！"}

    # Calculate summary
    total_problems = sum(s.get("total_attempts", 0) for s in all_stats)
    total_correct = sum(s.get("correct_count", 0) for s in all_stats)
    overall_accuracy = total_correct / total_problems if total_problems > 0 else 0

    # Find weak areas
    weak = [s["subcategory"] for s in all_stats if s.get("accuracy_rate", 1) < 0.7 and s.get("total_attempts", 0) >= 3]

    # Find strong areas
    strong = [s["subcategory"] for s in all_stats if s.get("accuracy_rate", 0) >= 0.9 and s.get("total_attempts", 0) >= 5]

    # Current progress
    unlocked = [s for s in all_stats if s.get("is_unlocked")]
    max_order = max((s.get("unit_order", 0) for s in unlocked), default=1)

    labels = _get_all_labels()

    return {
        "total_problems": total_problems,
        "total_correct": total_correct,
        "overall_accuracy": round(overall_accuracy * 100, 1),
        "current_unit": labels.get(_get_subcategory_by_order(max_order), ""),
        "units_completed": max_order - 1,
        "total_units": 18,
        "weak_areas": [labels.get(w, w) for w in weak],
        "strong_areas": [labels.get(s, s) for s in strong],
    }


def _get_unit_order(subcategory: str) -> int:
    """Get the order number for a subcategory."""
    orders = {
        "counting_numbers": 1, "ordinal_numbers": 2, "composition": 3,
        "addition_no_carry": 4, "subtraction_no_borrow": 5,
        "addition_with_carry": 6, "subtraction_with_borrow": 7,
        "three_numbers": 8, "numbers_over_20": 9,
        "shape_play": 10, "shape_building": 11,
        "length_compare": 12, "area_compare": 13, "volume_compare": 14,
        "hour_half": 15, "counting_survey": 16,
        "addition_word": 17, "subtraction_word": 18,
    }
    return orders.get(subcategory, 1)


def _get_subcategory_by_order(order: int) -> str:
    """Get subcategory by order number."""
    subcategories = {
        1: "counting_numbers", 2: "ordinal_numbers", 3: "composition",
        4: "addition_no_carry", 5: "subtraction_no_borrow",
        6: "addition_with_carry", 7: "subtraction_with_borrow",
        8: "three_numbers", 9: "numbers_over_20",
        10: "shape_play", 11: "shape_building",
        12: "length_compare", 13: "area_compare", 14: "volume_compare",
        15: "hour_half", 16: "counting_survey",
        17: "addition_word", 18: "subtraction_word",
    }
    return subcategories.get(order, "")


def _get_category_by_order(order: int) -> str:
    """Get category by order number."""
    if order <= 9:
        return "number_calculation"
    elif order <= 11:
        return "shape"
    elif order <= 14:
        return "measurement"
    elif order == 15:
        return "clock"
    elif order == 16:
        return "data"
    else:
        return "word_problem"


def _get_all_labels() -> dict:
    """Get all subcategory labels."""
    return {
        "counting_numbers": "かずとすうじ",
        "ordinal_numbers": "なんばんめ",
        "composition": "いくつといくつ",
        "addition_no_carry": "たしざん（くりあがりなし）",
        "subtraction_no_borrow": "ひきざん（くりさがりなし）",
        "addition_with_carry": "たしざん（くりあがりあり）",
        "subtraction_with_borrow": "ひきざん（くりさがりあり）",
        "three_numbers": "3つのかずのけいさん",
        "numbers_over_20": "20よりおおきいかず",
        "shape_play": "かたちあそび",
        "shape_building": "かたちづくり",
        "length_compare": "ながさくらべ",
        "area_compare": "ひろさくらべ",
        "volume_compare": "かさくらべ",
        "hour_half": "なんじ なんじはん",
        "counting_survey": "ものの数しらべ",
        "addition_word": "たしざんの文章題",
        "subtraction_word": "ひきざんの文章題",
    }
