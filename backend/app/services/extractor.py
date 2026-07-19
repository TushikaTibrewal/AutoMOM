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
            else:
                mom = self._extract_gemini(messages)
            return mom, provider, CURRENT_PROMPT_VERSION
        except Exception as exc:  # noqa: BLE001 - deliberately broad, we fall back
            logger.warning("%s extraction failed (%s); falling back to mock", provider, exc)
            return self._extract_mock(clean), f"mock (fallback from {provider})", CURRENT_PROMPT_VERSION

    # --------------------------------------------------------------- providers
    def _resolve_provider(self) -> str:
        cfg = self.settings
        if cfg.ai_provider in ("openai", "gemini", "mock"):
            return cfg.ai_provider
        if cfg.openai_api_key:
            return "openai"
        if cfg.gemini_api_key:
            return "gemini"
        logger.warning("No AI API key configured — using deterministic mock extractor")
        return "mock"

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

    def _extract_gemini(self, messages: list[dict]) -> MomExtraction:
        import google.generativeai as genai

        genai.configure(api_key=self.settings.gemini_api_key)
        model = genai.GenerativeModel(
            self.settings.gemini_model,
            system_instruction=messages[0]["content"],
            generation_config={"response_mime_type": "application/json"},
        )
        last_error: Exception | None = None
        prompt = messages[1]["content"]
        for attempt in range(self.settings.ai_max_retries):
            try:
                response = model.generate_content(prompt)
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
        """Deterministic heuristic extraction for offline development.

        Line-oriented rules; extracts only what is literally present.
        """
        agenda: list[AgendaItem] = []
        discussion: list[DiscussionPoint] = []
        decisions: list[Decision] = []
        actions: list[ActionItem] = []

        decision_re = re.compile(r"\b(decided|approved|agreed|finali[sz]ed|resolved)\b", re.IGNORECASE)
        action_re = re.compile(
            r"\b(will|to do|todo|action|assign(?:ed)?|task|should|must|needs? to|by (?:next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of))\b",
            re.IGNORECASE,
        )
        agenda_re = re.compile(r"^(agenda|topic|item)\s*[:\-–]\s*(.+)$", re.IGNORECASE)
        owner_re = re.compile(r"^([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?)\s+(?:will|to|should|must)\b")
        due_re = re.compile(
            r"\bby\s+((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|tomorrow|end of \w+|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\w+ \d{1,2}(?:st|nd|rd|th)?))",
            re.IGNORECASE,
        )

        for line in (ln.strip() for ln in transcript.splitlines()):
            if not line:
                continue
            m = agenda_re.match(line)
            if m:
                agenda.append(AgendaItem(title=m.group(2).strip(), subtopics=[]))
                continue
            sentence = re.sub(r"^[-*•\d.\s]+", "", line)
            if not sentence:
                continue
            if decision_re.search(sentence):
                decisions.append(Decision(description=sentence, decided_by=None, rationale=None))
            elif action_re.search(sentence):
                owner_match = owner_re.match(sentence)
                due_match = due_re.search(sentence)
                actions.append(
                    ActionItem(
                        description=sentence,
                        owner=owner_match.group(1) if owner_match else None,
                        due_date=due_match.group(1) if due_match else None,
                    )
                )
            else:
                idx = len(agenda) - 1 if agenda else None
                discussion.append(DiscussionPoint(agenda_index=idx, text=sentence))

        if not agenda and (discussion or decisions or actions):
            agenda.append(AgendaItem(title="General Discussion", subtopics=[]))
            for point in discussion:
                point.agenda_index = 0

        return MomExtraction(
            agenda=agenda,
            discussion_points=discussion[:100],
            decisions=decisions,
            action_items=actions,
            summary=None,
            confidence=0.4 if (decisions or actions) else 0.2,
        )


extractor = Extractor()
