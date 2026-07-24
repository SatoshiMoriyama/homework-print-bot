"""Print renderer - converts questions JSON to PDF/PNG using HTML templates."""

import asyncio
import atexit
import logging
from pathlib import Path

from playwright.async_api import Browser, async_playwright

logger = logging.getLogger(__name__)

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


# ---------------------------------------------------------------------------
# Browser lifecycle management
# ---------------------------------------------------------------------------

_browser: Browser | None = None
_playwright_context = None
_browser_lock = asyncio.Lock()


async def _ensure_chromium_installed() -> None:
    """Ensure Chromium is installed for Playwright. Attempts installation if missing.

    Uses asyncio.create_subprocess_exec to avoid blocking the event loop.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "python", "-m", "playwright", "install", "chromium", "--with-deps",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(
                f"Failed to install Chromium via playwright install: {stderr.decode()}"
            )
        logger.info("Chromium installed successfully")
    except FileNotFoundError as e:
        raise RuntimeError(
            "Playwright is not available. Install it with: pip install playwright"
        ) from e
    except TimeoutError as e:
        raise RuntimeError(
            "Chromium installation timed out after 300 seconds"
        ) from e


async def _get_browser() -> Browser:
    """Get or create a shared browser instance (lazy initialization).

    Launches Chromium on first call and reuses the instance for subsequent calls.
    If Chromium is not installed, attempts to install it via subprocess.
    Uses an asyncio.Lock to prevent concurrent initialization attempts.

    Returns:
        A Playwright Browser instance.

    Raises:
        RuntimeError: If Chromium cannot be launched or installed.
    """
    global _browser, _playwright_context

    if _browser is not None and _browser.is_connected():
        return _browser

    async with _browser_lock:
        # Double-check after acquiring lock
        if _browser is not None and _browser.is_connected():
            return _browser

        if _playwright_context is None:
            pw = async_playwright()
            _playwright_context = await pw.start()

        try:
            _browser = await _playwright_context.chromium.launch(headless=True)
        except Exception as first_error:
            logger.warning("Chromium launch failed, attempting to install: %s", first_error)
            await _ensure_chromium_installed()
            try:
                _browser = await _playwright_context.chromium.launch(headless=True)
            except Exception as second_error:
                raise RuntimeError(
                    "Failed to launch Chromium even after installation attempt. "
                    "Ensure Playwright and Chromium are properly installed: "
                    "pip install playwright && python -m playwright install chromium --with-deps"
                ) from second_error

    return _browser


async def shutdown_browser() -> None:
    """Shut down the shared browser instance and stop the Playwright context.

    Call this to cleanly release browser resources at process exit or when
    the browser is no longer needed.
    """
    global _browser, _playwright_context

    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            logger.warning("Error closing browser during shutdown", exc_info=True)
        _browser = None

    if _playwright_context is not None:
        try:
            await _playwright_context.stop()
        except Exception:
            logger.warning("Error stopping Playwright context during shutdown", exc_info=True)
        _playwright_context = None


def _atexit_shutdown() -> None:
    """atexit handler that schedules browser shutdown."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(shutdown_browser())
        else:
            loop.run_until_complete(shutdown_browser())
    except RuntimeError:
        # No event loop available; nothing to clean up
        pass


atexit.register(_atexit_shutdown)


async def render_to_pdf(html: str) -> bytes:
    """Render HTML to PDF using Playwright.

    Args:
        html: The rendered HTML string

    Returns:
        PDF bytes.
    """
    browser = await _get_browser()
    page = await browser.new_page()
    try:
        await page.set_content(html, wait_until="networkidle")
        pdf_bytes = await page.pdf(format="A4")
        return pdf_bytes
    finally:
        await page.close()


async def render_to_png(html: str) -> bytes:
    """Render HTML to PNG using Playwright.

    Args:
        html: The rendered HTML string

    Returns:
        PNG bytes.
    """
    browser = await _get_browser()
    page = await browser.new_page()
    try:
        await page.set_viewport_size({"width": 794, "height": 1123})  # A4 at 96dpi
        await page.set_content(html, wait_until="networkidle")
        png_bytes = await page.screenshot(full_page=True)
        return png_bytes
    finally:
        await page.close()
