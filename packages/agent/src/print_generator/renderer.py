"""Print renderer - converts questions JSON to PDF/PNG using HTML templates."""

import json
import os
import tempfile
from pathlib import Path

TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap');

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 18pt;
}

.print-page {
  width: 210mm;
  height: 297mm;
  padding: 15mm;
  display: flex;
  flex-direction: column;
}

header {
  margin-bottom: 10mm;
  border-bottom: 2px solid #333;
  padding-bottom: 5mm;
}

header h1 {
  font-size: 24pt;
  text-align: center;
  margin-bottom: 3mm;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 14pt;
  margin-top: 3mm;
}

.unit-label {
  font-size: 14pt;
  color: #555;
  text-align: center;
  margin-top: 2mm;
}

.questions {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8mm;
  margin-top: 5mm;
}

.question {
  display: flex;
  align-items: center;
  gap: 5mm;
  font-size: 20pt;
  min-height: 12mm;
}

.q-number {
  font-weight: bold;
  min-width: 10mm;
}

.q-body {
  flex: 1;
}

.q-answer-space {
  border-bottom: 2px solid #333;
  min-width: 25mm;
  height: 10mm;
}

footer {
  margin-top: auto;
  text-align: center;
  font-size: 14pt;
  color: #666;
  padding-top: 5mm;
  border-top: 1px solid #ccc;
}
</style>
</head>
<body>
<div class="print-page">
  <header>
    <h1>さんすう プリント</h1>
    <div class="meta-row">
      <span>なまえ: __________________</span>
      <span>ひづけ: ____がつ____にち</span>
    </div>
    <p class="unit-label">{{UNIT_LABEL}}</p>
  </header>

  <section class="questions">
    {{QUESTIONS_HTML}}
  </section>

  <footer>
    <p>がんばったね！ ⭐</p>
  </footer>
</div>
</body>
</html>"""

CIRCLE_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]


def render_html(questions: list[dict], unit_label: str, child_nickname: str = "") -> str:
    """Render questions to an HTML string.

    Args:
        questions: List of question dicts with 'number', 'text', 'correct_formula', 'correct_answer'
        unit_label: The unit label to display (e.g., 'たしざん（くりあがりなし）')
        child_nickname: Optional child's nickname for personalization

    Returns:
        HTML string ready for PDF/PNG conversion.
    """
    questions_html = ""
    for i, q in enumerate(questions):
        num = CIRCLE_NUMBERS[i] if i < len(CIRCLE_NUMBERS) else f"({i + 1})"
        text = q.get("text", "")
        questions_html += f"""    <div class="question">
      <span class="q-number">{num}</span>
      <span class="q-body">{text}</span>
      <span class="q-answer-space"></span>
    </div>\n"""

    html = TEMPLATE.replace("{{UNIT_LABEL}}", unit_label)
    html = html.replace("{{QUESTIONS_HTML}}", questions_html)

    if child_nickname:
        html = html.replace("なまえ: __________________", f"なまえ: {child_nickname}")

    return html


def save_html_to_file(html: str, output_path: str) -> str:
    """Save HTML to a file for later conversion.

    Args:
        html: The rendered HTML string
        output_path: Path to save the HTML file

    Returns:
        The output path.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    return output_path


async def render_to_pdf(html: str) -> bytes:
    """Render HTML to PDF using Puppeteer/Playwright.

    Note: In production, this would use Puppeteer with chromium-min in a Lambda Layer.
    For now, returns HTML bytes as a placeholder.

    Args:
        html: The rendered HTML string

    Returns:
        PDF bytes.
    """
    # In production, this would use:
    # from playwright.async_api import async_playwright
    # async with async_playwright() as p:
    #     browser = await p.chromium.launch()
    #     page = await browser.new_page()
    #     await page.set_content(html)
    #     pdf_bytes = await page.pdf(format='A4')
    #     await browser.close()
    #     return pdf_bytes

    # Placeholder: return HTML as bytes
    return html.encode("utf-8")


async def render_to_png(html: str) -> bytes:
    """Render HTML to PNG using Puppeteer/Playwright.

    Note: In production, this would use Puppeteer with chromium-min in a Lambda Layer.
    For now, returns empty bytes as a placeholder.

    Args:
        html: The rendered HTML string

    Returns:
        PNG bytes.
    """
    # In production, this would use:
    # from playwright.async_api import async_playwright
    # async with async_playwright() as p:
    #     browser = await p.chromium.launch()
    #     page = await browser.new_page()
    #     await page.set_viewport_size({"width": 794, "height": 1123})  # A4 at 96dpi
    #     await page.set_content(html)
    #     png_bytes = await page.screenshot(full_page=True)
    #     await browser.close()
    #     return png_bytes

    # TODO: This is a placeholder that returns UTF-8 encoded HTML, NOT a valid PNG.
    # Downstream code uploads this as ContentType=image/png, which will be invalid.
    # This will NOT produce a valid PNG until Puppeteer/Playwright is integrated.
    # Placeholder
    return html.encode("utf-8")
