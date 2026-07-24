"""Shared fixtures for renderer tests."""

import pytest

from src.print_generator.renderer import render_html

SAMPLE_QUESTIONS = [
    {"number": 1, "text": "2 + 3 =", "correct_formula": "2+3", "correct_answer": "5"},
    {"number": 2, "text": "4 + 1 =", "correct_formula": "4+1", "correct_answer": "5"},
    {"number": 3, "text": "7 + 2 =", "correct_formula": "7+2", "correct_answer": "9"},
]

SAMPLE_UNIT_LABEL = "たしざん（くりあがりなし）"


@pytest.fixture(autouse=True)
async def reset_browser_state():
    """Reset the global browser state before each test to avoid cross-event-loop issues."""
    import asyncio

    import src.print_generator.renderer as renderer_mod

    renderer_mod._browser = None
    renderer_mod._playwright_context = None
    renderer_mod._browser_lock = asyncio.Lock()
    yield
    # Clean up after test
    if renderer_mod._browser is not None and renderer_mod._browser.is_connected():
        await renderer_mod._browser.close()
    if renderer_mod._playwright_context is not None:
        await renderer_mod._playwright_context.stop()
    renderer_mod._browser = None
    renderer_mod._playwright_context = None
    renderer_mod._browser_lock = asyncio.Lock()


@pytest.fixture
def sample_html() -> str:
    """Produce sample HTML from render_html for use in rendering tests."""
    return render_html(questions=SAMPLE_QUESTIONS, unit_label=SAMPLE_UNIT_LABEL)
