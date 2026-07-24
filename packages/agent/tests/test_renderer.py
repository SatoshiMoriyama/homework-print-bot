"""Tests for print_generator.renderer render_to_png, render_to_pdf, and render_html."""

from src.print_generator.renderer import render_html, render_to_pdf, render_to_png

from .conftest import SAMPLE_QUESTIONS, SAMPLE_UNIT_LABEL

# PNG magic bytes: \x89PNG\r\n\x1a\n
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

# PDF magic bytes
PDF_MAGIC = b"%PDF-"


async def test_render_to_png_returns_valid_png(sample_html: str) -> None:
    """render_to_png should return bytes starting with PNG magic and non-trivial size."""
    result = await render_to_png(sample_html)

    assert isinstance(result, bytes)
    assert result[:8] == PNG_MAGIC, "Output does not start with PNG magic bytes"
    assert len(result) > 1000, f"PNG output too small ({len(result)} bytes), likely not a real image"


async def test_render_to_pdf_returns_valid_pdf(sample_html: str) -> None:
    """render_to_pdf should return bytes starting with %PDF- and non-trivial size."""
    result = await render_to_pdf(sample_html)

    assert isinstance(result, bytes)
    assert result[:5] == PDF_MAGIC, "Output does not start with PDF magic bytes (%PDF-)"
    assert len(result) > 1000, f"PDF output too small ({len(result)} bytes), likely not a real PDF"


async def test_render_to_png_with_questions() -> None:
    """Full workflow: render_html -> render_to_png with multiple questions produces valid PNG."""
    questions = [
        {"number": 1, "text": "1 + 1 =", "correct_formula": "1+1", "correct_answer": "2"},
        {"number": 2, "text": "3 + 4 =", "correct_formula": "3+4", "correct_answer": "7"},
        {"number": 3, "text": "5 + 5 =", "correct_formula": "5+5", "correct_answer": "10"},
        {"number": 4, "text": "8 + 2 =", "correct_formula": "8+2", "correct_answer": "10"},
        {"number": 5, "text": "6 + 3 =", "correct_formula": "6+3", "correct_answer": "9"},
    ]
    html = render_html(questions=questions, unit_label="たしざん まとめ")
    result = await render_to_png(html)

    assert isinstance(result, bytes)
    assert result[:8] == PNG_MAGIC, "Output does not start with PNG magic bytes"
    assert len(result) > 1000, f"PNG output too small ({len(result)} bytes), likely not a real image"


def test_render_html_unchanged() -> None:
    """render_html should produce expected HTML structure with key elements."""
    html = render_html(questions=SAMPLE_QUESTIONS, unit_label=SAMPLE_UNIT_LABEL)

    # Verify the title
    assert "さんすう プリント" in html

    # Verify the unit label
    assert SAMPLE_UNIT_LABEL in html

    # Verify question text is present
    for q in SAMPLE_QUESTIONS:
        assert q["text"] in html

    # Verify structural elements
    assert 'class="question"' in html
    assert 'class="unit-label"' in html
    assert 'class="q-number"' in html
    assert 'class="q-body"' in html
    assert 'class="q-answer-space"' in html

    # Verify it's a complete HTML document
    assert "<!DOCTYPE html>" in html
    assert "<html lang=\"ja\">" in html
    assert "</html>" in html
