"""AI extraction service.

Pipeline: preprocess -> LLM -> validate (Pydantic) -> repair/retry -> MomExtraction.

Providers:
- openai: GPT-4.1 through Instructor (schema-enforced structured output)
- gemini: Gemini 2.5 Pro with JSON response mode
- mock:   deterministic rule-based extractor, used when no API key is configured
          (keeps local dev and CI fully offline; never hallucinates by design)
"""
from __future__ import annotations

import json
import re

from pydantic import ValidationError

from app.config import get_settings
from app.prompts import CURRENT_PROMPT_VERSION, build_messages
from app.schemas.mom import ActionItem, AgendaItem, Decision, DiscussionPoint, MomExtraction
from app.utils.logging import get_logger
from app.utils.sanitize import neutralize_prompt_injection, sanitize_text

logger = get_logger("extractor")


class ExtractionError(Exception):
    """Raised when every provider attempt fails validation."""


def preprocess_transcript(transcript: str, max_chars: int) -> str:
    """Step 2 of the pipeline: sanitize, normalize whitespace, cap length."""
    text = sanitize_text(transcript, max_length=max_chars)
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return neutralize_prompt_injection(text)


# --------------------------------------------------------------------------- #
# Deterministic language cleanup for the offline mock extractor.
# This is NOT document formatting (templates own that) — it is light text
# normalization so mock-extracted points read as sentences, not raw chat.
# --------------------------------------------------------------------------- #

_TXT_EXPANSIONS = {
    r"\bcoz\b": "because",
    r"\bcuz\b": "because",
    r"\bb/c\b": "because",
    r"\bu\b": "you",
    r"\bur\b": "your",
    r"\bpls\b": "please",
    r"\bplz\b": "please",
    r"\bthru\b": "through",
    r"\btmrw\b": "tomorrow",
    r"\btmr\b": "tomorrow",
    r"\bprob\b": "probably",
    r"\bapprox\b": "approximately",
    r"\basap\b": "as soon as possible",
    r"\bw/\b": "with",
    r"\bwanna\b": "want to",
    r"\bgonna\b": "going to",
    r"\bgotta\b": "have to",
    r"\bidk\b": "I do not know",
    r"\bwe r\b": "we are",
    r"\bwe're\b": "we are",
    r"\bcan't\b": "cannot",
    r"\bcant\b": "cannot",
    r"\bdidnt\b": "did not",
    r"\bdoesnt\b": "does not",
    r"\bwont\b": "will not",
    r"\bdont\b": "do not",
    r"\bi'll\b": "I will",
    r"\bshe'll\b": "she will",
    r"\bhe'll\b": "he will",
    r"\bwe'll\b": "we will",
    r"\bimo\b": "in my opinion",
    r"\bwas like\b": "said",
    r"\bis like\b": "says",
    r"\bmins\b": "minutes",
    r"\bhr\b": "HR",
    r"\baws\b": "AWS",
    r"\bstandup\b": "stand-up",
}

# Filler phrases removed wholesale (conservative — avoids changing meaning).
_FILLERS = re.compile(
    r"\b(basically|kinda|kind of|sorta|sort of|lol|honestly|literally|"
    r"i think|i guess|you know|like i said|sort of|at the end of the day)\b",
    re.IGNORECASE,
)

# Leading discourse markers stripped from the start of a sentence.
_LEADING = re.compile(r"^(?:ok(?:ay)?|so|then|and|but|well|oh|um+|uh+|also|like|yeah)\b[\s,]*", re.IGNORECASE)


def _formalize(sentence: str) -> str:
    """Turn a messy chat-style clause into a clean, formal sentence."""
    s = sentence.strip().strip("-*•").strip()
    if not s:
        return ""
    for pattern, repl in _TXT_EXPANSIONS.items():
        s = re.sub(pattern, repl, s, flags=re.IGNORECASE)
    s = _FILLERS.sub("", s)
    # strip a couple of stacked leading markers ("ok so ...", "and then ...")
    for _ in range(3):
        new = _LEADING.sub("", s)
        if new == s:
            break
        s = new
    s = re.sub(r"\s{2,}", " ", s).strip(" ,;-")
    if not s:
        return ""
    # standalone "i" -> "I"
    s = re.sub(r"\bi\b", "I", s)
    s = re.sub(r"\bq([1-4])\b", lambda m: "Q" + m.group(1), s, flags=re.IGNORECASE)
    s = s[0].upper() + s[1:]
    if s[-1] not in ".!?":
        s += "."
    return s


# Capitalized words that are not attendee names — reject as decision-makers/owners.
_NON_NAMES = {
    "Eventually", "Decided", "Agreed", "Approved", "First", "Then", "Also", "Finance",
    "Present", "Main", "Budget", "Hiring", "Designer", "Meeting", "The", "This", "That",
    "We", "It", "Next", "Everyone", "Someone", "Admin", "HR", "Q1", "Q2", "Q3", "Q4",
}


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _split_sentences(text: str) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for piece in _SENTENCE_SPLIT.split(line):
            piece = piece.strip()
            if piece:
                out.append(piece)
    return out


class Extractor:
    def __init__(self) -> None:
        self.settings = get_settings()

    # ------------------------------------------------------------------ public
    def extract(
        self, meeting_meta: dict, attendees: list[dict], transcript: str
    ) -> tuple[MomExtraction, str, str]:
        """Returns (validated extraction, provider used, prompt version)."""
        clean = preprocess_transcript(transcript, self.settings.max_transcript_chars)
        provider = self._resolve_provider()
        messages = build_messages(meeting_meta, attendees, clean)

        if provider == "mock":
            return self._extract_mock(clean), "mock", CURRENT_PROMPT_VERSION

        # Real provider. If it errors (quota, timeout on a large draft, bad
        # model name, validation exhausted), degrade to the deterministic mock
        # extractor so generation never hard-fails — the user still gets minutes.
        try:
            if provider == "openai":
                mom = self._extract_openai(messages)
            elif provider == "groq":
                mom = self._extract_groq(messages)
            else:
                mom = self._extract_gemini(messages)
            return mom, provider, CURRENT_PROMPT_VERSION
        except Exception as exc:  # noqa: BLE001 - deliberately broad, we fall back
            logger.warning("%s extraction failed (%s); falling back to mock", provider, exc)
            return self._extract_mock(clean), f"mock (fallback from {provider})", CURRENT_PROMPT_VERSION

    # --------------------------------------------------------------- providers
    def _resolve_provider(self) -> str:
        cfg = self.settings
        if cfg.ai_provider in ("openai", "gemini", "groq", "mock"):
            return cfg.ai_provider
        if cfg.openai_api_key:
            return "openai"
        if cfg.groq_api_key:
            return "groq"
        if cfg.gemini_api_key:
            return "gemini"
        logger.warning("No AI API key configured — using deterministic mock extractor")
        return "mock"

    def _extract_groq(self, messages: list[dict]) -> MomExtraction:
        """Groq via its OpenAI-compatible endpoint + Instructor (JSON mode)."""
        import instructor
        from openai import OpenAI

        client = instructor.from_openai(
            OpenAI(
                api_key=self.settings.groq_api_key,
                base_url="https://api.groq.com/openai/v1",
                timeout=self.settings.ai_timeout_seconds,
            ),
            mode=instructor.Mode.JSON,
        )
        return client.chat.completions.create(
            model=self.settings.groq_model,
            messages=messages,
            response_model=MomExtraction,
            max_retries=self.settings.ai_max_retries,
            temperature=0.2,
        )

    def _extract_openai(self, messages: list[dict]) -> MomExtraction:
        import instructor
        from openai import OpenAI

        client = instructor.from_openai(
            OpenAI(api_key=self.settings.openai_api_key, timeout=self.settings.ai_timeout_seconds)
        )
        # Instructor handles the validate-and-retry loop: on ValidationError it
        # re-asks the model with the error message attached.
        return client.chat.completions.create(
            model=self.settings.openai_model,
            messages=messages,
            response_model=MomExtraction,
            max_retries=self.settings.ai_max_retries,
        )

    def _gemini_model_candidates(self) -> list[str]:
        """Configured model first, then broadly-available fallbacks.

        Google periodically retires model ids or restricts them to newer SDKs;
        trying a list makes extraction resilient to a single bad/deprecated id.
        """
        configured = self.settings.gemini_model.strip()
        fallbacks = [
            "gemini-2.0-flash",
            "gemini-flash-latest",
            "gemini-2.0-flash-001",
            "gemini-pro-latest",
        ]
        ordered = [configured] + [m for m in fallbacks if m != configured]
        return ordered

    def _extract_gemini(self, messages: list[dict]) -> MomExtraction:
        import google.generativeai as genai

        genai.configure(api_key=self.settings.gemini_api_key)

        model_not_found_error: Exception | None = None
        for model_name in self._gemini_model_candidates():
            try:
                model = genai.GenerativeModel(
                    model_name,
                    system_instruction=messages[0]["content"],
                    generation_config={"response_mime_type": "application/json"},
                )
                mom = self._gemini_generate_validated(model, messages)
                if model_name != self.settings.gemini_model.strip():
                    logger.info("Gemini used fallback model '%s'", model_name)
                return mom
            except Exception as exc:  # noqa: BLE001
                text = str(exc).lower()
                if "404" in text or "not found" in text or "not available" in text:
                    # Bad/retired model id — try the next candidate.
                    model_not_found_error = exc
                    logger.warning("Gemini model '%s' unavailable: %s", model_name, exc)
                    continue
                # Quota (429) or any other error: don't churn other models
                # (they share the same quota) — bubble up to the mock fallback.
                raise
        raise ExtractionError(
            f"No usable Gemini model found. Last error: {model_not_found_error}"
        )

    def _gemini_generate_validated(self, model, messages: list[dict]) -> MomExtraction:
        last_error: Exception | None = None
        prompt = messages[1]["content"]
        for attempt in range(self.settings.ai_max_retries):
            response = model.generate_content(prompt)
            try:
                return self._validate_json_text(response.text)
            except (ValidationError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                logger.warning("Gemini attempt %d failed validation: %s", attempt + 1, exc)
                prompt = (
                    messages[1]["content"]
                    + "\n\nYour previous response failed validation with this error, "
                    "return corrected JSON only:\n"
                    + str(exc)[:1500]
                )
        raise ExtractionError(f"Gemini output failed validation after retries: {last_error}")

    @staticmethod
    def _validate_json_text(text: str) -> MomExtraction:
        """Step 5+6: validate, with a light repair pass for fenced/truncated JSON."""
        raw = text.strip()
        # Repair: strip accidental code fences despite instructions
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
        # Repair: extract the outermost JSON object if surrounded by prose
        if not raw.startswith("{"):
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                raw = match.group(0)
        return MomExtraction.model_validate_json(raw)

    # -------------------------------------------------------------------- mock
    def _extract_mock(self, transcript: str) -> MomExtraction:
        """Deterministic offline extractor.

        Works sentence-by-sentence: splits paragraphs into sentences, cleans
        each into a formal sentence, then classifies it as a decision, action
        item, or discussion point. Extracts owners and due dates where stated.
        Never invents facts — only what is literally present.
        """
        discussion: list[DiscussionPoint] = []
        decisions: list[Decision] = []
        actions: list[ActionItem] = []

        decision_re = re.compile(r"\b(decided|approv(?:ed|e)|agreed|finali[sz]ed|resolved|will move|moves? to|prioriti[sz]e|paus(?:e|ed)|sign(?:ed)? off)\b", re.IGNORECASE)
        action_re = re.compile(
            r"\b(will|to do|todo|action|assign(?:ed)?|task|should|must|needs? to|"
            r"volunteered|to hold|to look|to review|to audit|to talk|to get|to confirm|to prepare|to book|to fast[- ]track)\b",
            re.IGNORECASE,
        )
        owner_re = re.compile(
            r"^([A-Z][a-z]+)\s+(?:will|to|should|must|volunteered|said|is going to|has to)\b"
        )
        due_re = re.compile(
            r"\bby\s+((?:this\s+|next\s+|the\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
            r"week|month|tomorrow|end of \w+|eod|eow|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|"
            r"\w+ \d{1,2}(?:st|nd|rd|th)?))"
            r"|\b(in \d+ (?:day|week|month)s?)",
            re.IGNORECASE,
        )
        decided_by_re = re.compile(r"\b([A-Z][a-z]+)\s+(?:approved|agreed|decided|signed off)\b")
        agenda_intro_re = re.compile(
            r"\bagenda\b[^.]*?\b(?:was|were|is|are|includes?|:)\s*(.+)", re.IGNORECASE
        )

        agenda: list[AgendaItem] = []

        for raw in _split_sentences(transcript):
            # Pull explicit agenda declarations apart into individual items.
            intro = agenda_intro_re.search(raw)
            if intro:
                for part in re.split(r",|\band\b|/", intro.group(1)):
                    title = _formalize(part).rstrip(".")
                    title = re.sub(r"\b(stuff|thing|things)\b\.?$", "", title, flags=re.IGNORECASE).strip()
                    title = re.sub(r"^the\s+", "", title, flags=re.IGNORECASE).strip()
                    if len(title) > 2:
                        agenda.append(AgendaItem(title=title[0].upper() + title[1:], subtopics=[]))
                continue

            sentence = _formalize(raw)
            if len(sentence) < 4:
                continue

            if decision_re.search(sentence):
                by = decided_by_re.search(sentence)
                decided_by = by.group(1) if by and by.group(1) not in _NON_NAMES else None
                decisions.append(
                    Decision(description=sentence, decided_by=decided_by, rationale=None)
                )
            elif action_re.search(sentence):
                owner_match = owner_re.match(sentence)
                owner = owner_match.group(1) if owner_match and owner_match.group(1) not in _NON_NAMES else None
                due_match = due_re.search(sentence)
                due = None
                if due_match:
                    due = (due_match.group(1) or due_match.group(2) or "").strip()
                actions.append(
                    ActionItem(description=sentence, owner=owner, due_date=due or None)
                )
            else:
                discussion.append(DiscussionPoint(agenda_index=None, text=sentence))

        if not agenda:
            agenda.append(AgendaItem(title="General Discussion", subtopics=[]))
        # Attach all loose discussion to the first agenda item for a tidy document.
        for point in discussion:
            if point.agenda_index is None:
                point.agenda_index = 0

        return MomExtraction(
            agenda=agenda,
            discussion_points=discussion[:150],
            decisions=decisions,
            action_items=actions,
            summary=None,
            confidence=0.4 if (decisions or actions) else 0.2,
        )


extractor = Extractor()
