"""Entrypoint for Grading Agent."""

import json
import os
from datetime import datetime
import boto3
from ulid import ULID as _ULID
import uuid

def _generate_id() -> str:
    """Generate a unique ID (fallback to uuid4 if ULID fails)."""
    try:
        return str(_ULID())
    except Exception:
        return uuid.uuid4().hex

from .agent import grade_from_image, grade_from_text

S3_BUCKET = os.environ.get("BUCKET_NAME", "")
PRINTS_TABLE = os.environ.get("PRINTS_TABLE", "homework-bot-prints")
GRADING_TABLE = os.environ.get("GRADING_RESULTS_TABLE", "homework-bot-grading-results")
LEARNING_STATS_TABLE = os.environ.get("LEARNING_STATS_TABLE", "homework-bot-learning-stats")

s3_client = boto3.client("s3", region_name="ap-northeast-1")
dynamodb = boto3.resource("dynamodb", region_name="ap-northeast-1")



async def handle_grade_answer(payload: dict) -> dict:
    """Handle grading from an image.

    Args:
        payload: {
            "action": "grade_answer",
            "child_id": "...",
            "print_id": "...",
            "answer_image_s3_key": "..."
        }
    """
    child_id = payload["child_id"]
    print_id = payload["print_id"]
    image_s3_key = payload["answer_image_s3_key"]

    # Get print data
    prints_table = dynamodb.Table(PRINTS_TABLE)
    print_data = prints_table.get_item(Key={"print_id": print_id}).get("Item")
    if not print_data:
        return {"error": "Print not found"}

    questions = print_data.get("questions", [])

    # Get image from S3
    image_response = s3_client.get_object(Bucket=S3_BUCKET, Key=image_s3_key)
    image_bytes = image_response["Body"].read()

    # Grade
    grading_result = grade_from_image(image_bytes, questions)

    # Check for unreadable questions
    unreadable = grading_result.get("unreadable_questions", [])
    if unreadable:
        return {
            "status": "partial",
            "unreadable_questions": unreadable,
            "partial_results": grading_result.get("results", []),
            "print_id": print_id,
        }

    # Save full results
    return await _save_grading_results(child_id, print_id, grading_result, image_s3_key)



async def handle_grade_text_answer(payload: dict) -> dict:
    """Handle grading from text input.

    Args:
        payload: {
            "action": "grade_text_answer",
            "child_id": "...",
            "print_id": "...",
            "text_answers": [{"question_number": 2, "answer_text": "3+5=8"}]
        }
    """
    child_id = payload["child_id"]
    print_id = payload["print_id"]
    text_answers = payload["text_answers"]

    # Get print data
    prints_table = dynamodb.Table(PRINTS_TABLE)
    print_data = prints_table.get_item(Key={"print_id": print_id}).get("Item")
    if not print_data:
        return {"error": "Print not found"}

    questions = print_data.get("questions", [])

    # Grade text answers
    grading_result = grade_from_text(text_answers, questions)

    return await _save_grading_results(child_id, print_id, grading_result, "")


async def _save_grading_results(
    child_id: str,
    print_id: str,
    grading_result: dict,
    image_s3_key: str,
) -> dict:
    """Save grading results to DynamoDB."""
    results = grading_result.get("results", [])

    score = sum(1 for r in results if r.get("is_correct"))
    total = len(results)

    # Build details
    details = []
    for r in results:
        details.append({
            "question_number": r.get("question_number"),
            "child_formula": r.get("child_formula", ""),
            "child_answer": r.get("child_answer", ""),
            "is_correct": r.get("is_correct", False),
            "is_formula_correct": r.get("is_formula_correct", False),
            "error_type": r.get("error_type"),
            "input_method": "text" if not image_s3_key else "image",
        })

    result_id = _generate_id()
    grading_table = dynamodb.Table(GRADING_TABLE)
    grading_table.put_item(
        Item={
            "result_id": result_id,
            "print_id": print_id,
            "child_id": child_id,
            "graded_at": datetime.now().isoformat(),
            "score": score,
            "total": total,
            "details": details,
            "answer_image_s3_key": image_s3_key,
        }
    )

    # Update print status
    prints_table = dynamodb.Table(PRINTS_TABLE)
    prints_table.update_item(
        Key={"print_id": print_id},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "graded"},
    )

    return {
        "status": "complete",
        "result_id": result_id,
        "score": score,
        "total": total,
        "details": details,
    }
