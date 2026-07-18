"""Input sanitization helpers.

Defense in depth:
1. bleach strips all HTML from user text before it reaches the LLM or templates.
2. Jinja2 autoescape is ON in the template engine (second layer).
3. The MomExtraction schema strips markup from LLM output (third layer).
"""
import re

import bleach

# Phrases commonly used to hijack an LLM from inside user-provided content.
_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(a|an)\s", re.IGNORECASE),
    re.compile(r"system\s*prompt", re.IGNORECASE),
    re.compile(r"</?\s*(system|assistant|user)\s*>", re.IGNORECASE),
    re.compile(r"BEGIN\s+TRANSCRIPT|END\s+TRANSCRIPT", re.IGNORECASE),
]


def sanitize_text(value: str, max_length: int | None = None) -> str:
    """Strip all HTML tags and control characters from user text."""
    cleaned = bleach.clean(value, tags=[], attributes={}, strip=True)
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
    if max_length is not None:
        cleaned = cleaned[:max_length]
    return cleaned.strip()


def neutralize_prompt_injection(transcript: str) -> str:
    """Defang known injection phrases inside the transcript.

    We do not delete user content (it may be legitimate meeting talk); we break
    the exact trigger phrases so they cannot act as instructions, and the
    transcript is additionally fenced with delimiters in the prompt.
    """
    result = transcript
    for pattern in _INJECTION_PATTERNS:
        result = pattern.sub(lambda m: "[filtered] " + m.group(0).replace(" ", "_"), result)
    return result
