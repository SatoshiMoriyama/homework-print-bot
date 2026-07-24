"""Entrypoint for Print Generator Agent - handles AgentCore invocation."""

import json
import os
import boto3
from ulid import ULID as _ULID
import uuid

def _generate_id() -> str:
    """Generate a unique ID (fallback to uuid4 if ULID fails)."""
    try:
        return str(_ULID())
    except Exception:
        return uuid.uuid4().hex

from .agent import generate_print, regenerate_print
from .renderer import render_html, render_to_png

S3_BUCKET = os.environ.get("BUCKET_NAME", "")
PRINTS_TABLE = os.environ.get("PRINTS_TABLE", "homework-bot-prints")

s3_client = boto3.client("s3", region_name="ap-northeast-1")
dynamodb = boto3.resource("dynamodb", region_name="ap-northeast-1")


async def handle_generate_print(payload: dict) -> dict:
    """Handle print generation request.

    Args:
        payload: {
            "action": "generate_print",
            "child_id": "...",
            "params": {
                "category": "...",
                "subcategory": "...",
                "difficulty": 1,
                "question_count": 8,
                "weak_areas": [...]
            }
        }

    Returns:
        Dict with print_id, s3_key, questions.
    """
    child_id = payload["child_id"]
    params = payload.get("params", {})

    subcategory = params.get("subcategory", "addition_no_carry")
    difficulty = params.get("difficulty", 1)
    question_count = params.get("question_count", 8)
    weak_areas = params.get("weak_areas", [])

    # Generate questions
    result = generate_print(
        child_id=child_id,
        subcategory=subcategory,
        difficulty=difficulty,
        question_count=question_count,
        weak_areas=weak_areas,
    )

    questions = result.get("questions", [])
    if not questions:
        return {"error": "Failed to generate questions"}

    # Get unit label
    unit_label = _get_unit_label(subcategory)

    # Render to HTML then PNG
    html = render_html(questions, unit_label)
    png_bytes = await render_to_png(html)

    # Determine if Playwright was available (render_to_png returns HTML bytes as fallback)
    print_id = _generate_id()
    needs_rendering = False

    # If png_bytes is actually HTML (Playwright was not available), save as .html
    try:
        html_decoded = png_bytes.decode("utf-8")
        if html_decoded.strip().startswith("<!DOCTYPE html>") or html_decoded.strip().startswith("<html"):
            # Playwright was not available, save as HTML
            needs_rendering = True
            s3_key = f"prints/{child_id}/{print_id}.html"
            content_type = "text/html"
            body = png_bytes
        else:
            s3_key = f"prints/{child_id}/{print_id}.png"
            content_type = "image/png"
            body = png_bytes
    except (UnicodeDecodeError, AttributeError):
        # Binary PNG data
        s3_key = f"prints/{child_id}/{print_id}.png"
        content_type = "image/png"
        body = png_bytes

    # Upload to S3
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=body,
        ContentType=content_type,
    )

    # Save to DynamoDB
    table = dynamodb.Table(PRINTS_TABLE)
    table.put_item(
        Item={
            "print_id": print_id,
            "child_id": child_id,
            "created_at": _generate_id(),  # Use timestamp
            "category": params.get("category", ""),
            "subcategory": subcategory,
            "difficulty": difficulty,
            "questions": questions,
            "s3_key": s3_key,
            "status": "generated",
        }
    )

    response = {
        "print_id": print_id,
        "s3_key": s3_key,
        "questions": questions,
        "unit_label": unit_label,
    }
    if needs_rendering:
        response["needs_rendering"] = True

    return response


async def handle_regenerate_print(payload: dict) -> dict:
    """Handle print regeneration with modification instructions.

    Args:
        payload: {
            "action": "regenerate_print",
            "child_id": "...",
            "print_id": "...",
            "modification_instruction": "..."
        }
    """
    child_id = payload["child_id"]
    print_id = payload["print_id"]
    modification = payload["modification_instruction"]

    # Get previous print
    table = dynamodb.Table(PRINTS_TABLE)
    response = table.get_item(Key={"print_id": print_id})
    previous_print = response.get("Item")

    if not previous_print:
        return {"error": "Previous print not found"}

    previous_questions = previous_print.get("questions", [])
    subcategory = previous_print.get("subcategory", "")

    # Regenerate
    result = regenerate_print(previous_questions, modification)
    questions = result.get("questions", [])

    if not questions:
        return {"error": "Failed to regenerate questions"}

    # Render
    unit_label = _get_unit_label(subcategory)
    html = render_html(questions, unit_label)
    png_bytes = await render_to_png(html)

    # Determine if Playwright was available (render_to_png returns HTML bytes as fallback)
    new_print_id = _generate_id()
    needs_rendering = False

    # If png_bytes is actually HTML (Playwright was not available), save as .html
    try:
        html_decoded = png_bytes.decode("utf-8")
        if html_decoded.strip().startswith("<!DOCTYPE html>") or html_decoded.strip().startswith("<html"):
            # Playwright was not available, save as HTML
            needs_rendering = True
            s3_key = f"prints/{child_id}/{new_print_id}.html"
            content_type = "text/html"
            body = png_bytes
        else:
            s3_key = f"prints/{child_id}/{new_print_id}.png"
            content_type = "image/png"
            body = png_bytes
    except (UnicodeDecodeError, AttributeError):
        # Binary PNG data
        s3_key = f"prints/{child_id}/{new_print_id}.png"
        content_type = "image/png"
        body = png_bytes

    # Upload to S3
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=body,
        ContentType=content_type,
    )

    # Save to DynamoDB
    table.put_item(
        Item={
            "print_id": new_print_id,
            "child_id": child_id,
            "created_at": _generate_id(),
            "category": previous_print.get("category", ""),
            "subcategory": subcategory,
            "difficulty": previous_print.get("difficulty", 1),
            "questions": questions,
            "s3_key": s3_key,
            "status": "generated",
        }
    )

    response_data = {
        "print_id": new_print_id,
        "s3_key": s3_key,
        "questions": questions,
        "unit_label": unit_label,
    }
    if needs_rendering:
        response_data["needs_rendering"] = True

    return response_data


def _get_unit_label(subcategory: str) -> str:
    """Get human-readable label for a subcategory."""
    labels = {
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
    return labels.get(subcategory, subcategory)
