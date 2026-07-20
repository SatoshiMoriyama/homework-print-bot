"""Main entrypoint for AgentCore Runtime."""

import json
import asyncio
from bedrock_agentcore import BedrockAgentCoreApp

from .print_generator.entrypoint import handle_generate_print, handle_regenerate_print
from .grading.entrypoint import handle_grade_answer, handle_grade_text_answer
from .adaptive_learning.stats import get_learning_summary

app = BedrockAgentCoreApp()


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
        return asyncio.run(handler(payload))
    return handler(payload)


def _handle_summary(payload: dict) -> dict:
    """Handle learning summary request."""
    child_id = payload.get("child_id", "")
    if not child_id:
        return {"error": "child_id is required"}
    return get_learning_summary(child_id)


if __name__ == "__main__":
    app.run()
