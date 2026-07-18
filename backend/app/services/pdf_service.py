"""PDF generation from rendered template HTML.

Two interchangeable backends, tried in order (configurable via PDF_ENGINE):

1. weasyprint  — best print fidelity (real @page rules, page counters). Needs
   native GTK/Pango libraries. Shipped in the Docker image / Linux.
2. chromium    — headless Chromium via Playwright. No system libraries required,
   renders the exact same HTML/CSS as the in-app preview iframe. Works on bare
   Windows/macOS dev machines (`playwright install chromium`).

Whichever is available is used automatically. If neither loads, a clear,
actionable error is raised.
"""
from __future__ import annotations

from pathlib import Path

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger("pdf")


class PdfUnavailableError(RuntimeError):
    pass


# ---------------------------------------------------------------- backend probes
def _weasyprint_pdf(html: str, out_path: Path) -> bool:
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as exc:  # OSError: missing native libs
        logger.info("WeasyPrint backend unavailable: %s", exc)
        return False
    HTML(string=html).write_pdf(str(out_path))
    return True


def _chromium_pdf(html: str, out_path: Path) -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        logger.info("Playwright backend unavailable: %s", exc)
        return False

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            try:
                page = browser.new_page()
                page.set_content(html, wait_until="networkidle")
                # prefer_css_page_size honors the template's @page A4 + margins.
                page.pdf(path=str(out_path), print_background=True, prefer_css_page_size=True)
            finally:
                browser.close()
        return True
    except Exception as exc:  # chromium not installed, launch failure, etc.
        logger.warning("Chromium PDF backend failed: %s", exc)
        return False


_BACKENDS = {"weasyprint": _weasyprint_pdf, "chromium": _chromium_pdf}


def html_to_pdf(html: str, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    engine = get_settings().pdf_engine.lower()
    if engine in _BACKENDS:
        order = [engine] + [name for name in _BACKENDS if name != engine]
    else:  # "auto" or unknown
        order = list(_BACKENDS)

    tried = []
    for name in order:
        tried.append(name)
        if _BACKENDS[name](html, out_path):
            logger.info("PDF generated via %s backend", name)
            return out_path

    raise PdfUnavailableError(
        "No PDF backend available. Install one of:\n"
        "  - WeasyPrint + GTK/Pango (bundled in the Docker image), or\n"
        "  - Playwright Chromium:  pip install playwright && playwright install chromium\n"
        f"Backends tried: {', '.join(tried)}. "
        "DOCX export and the in-app preview work without a PDF backend."
    )
