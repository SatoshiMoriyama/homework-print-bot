"""Main entrypoint for AgentCore Runtime."""

import json
import asyncio
from decimal import Decimal
from bedrock_agentcore import BedrockAgentCoreApp

from .print_generator.entrypoint import handle_generate_print, handle_regenerate_print
from .grading.entrypoint import handle_grade_answer, handle_grade_text_answer
from .adaptive_learning.stats import get_learning_summary

app = BedrockAgentCoreApp()


def _convert_decimals(obj):
    """Recursively convert Decimal values to int or float for JSON serialization."""
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    elif isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    return obj


@app.entrypoint
def invoke(payload: dict) -> dict:
    """Main dispatch for all agent actions."""
    action = payload.get("action", "")

    handlers = {
        "generate_print": handle_generate_print,
        "regenerate_print": handle_regenerate_print,
        "grade_answer": handle_grade_answer,
        "grade_text_answer": handle_grade_text_answer,
        "get_learning_summary": _handle_summary,
    }

    handler = handlers.get(action)
    if not handler:
        return {"error": f"Unknown action: {action}"}

    # Run async handlers
    if asyncio.iscoroutinefunction(handler):
        result = asyncio.run(handler(payload))
    else:
        result = handler(payload)

    return _convert_decimals(result)


def _handle_summary(payload: dict) -> dict:
    """Handle learning summary request."""
    child_id = payload.get("child_id", "")
    if not child_id:
        return {"error": "child_id is required"}
    return get_learning_summary(child_id)


if __name__ == "__main__":
    app.run()
