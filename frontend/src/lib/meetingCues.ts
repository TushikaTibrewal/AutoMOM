/** Detect verbal cues that the official meeting has concluded.
 *  Covers English and common Hindi / Hinglish phrasings. */
const END_CUE_PATTERNS: RegExp[] = [
  /\bmeeting\s+is\s+(?:now\s+)?adjourned\b/i,
  /\bi\s+(?:hereby\s+)?adjourn\s+(?:the\s+)?meeting\b/i,
  /\blet'?s\s+wrap\s+(?:this\s+|it\s+)?up\b/i,
  /\bthat'?s\s+all\s+for\s+(?:today'?s\s+)?(?:the\s+)?meeting\b/i,
  /\bthat\s+(?:will\s+)?(?:be|concludes?)\s+(?:all|the\s+meeting)\b/i,
  /\bwe'?ll\s+(?:end|close|conclude)\s+(?:the\s+meeting\s+)?here\b/i,
  /\b(?:this\s+)?meeting\s+is\s+(?:over|concluded|closed|finished)\b/i,
  /\bofficial\s+(?:discussion|meeting)\s+(?:is\s+)?(?:over|concluded|done)\b/i,
  /\bthank\s+you\s+(?:all\s+)?for\s+(?:joining|attending)\b/i,
  // Hindi / Hinglish
  /\bmeeting\s+khatam\b/i,
  /\bmeeting\s+(?:yaha|yahan|yahin)\s+(?:khatam|samapt)\b/i,
  /\bmeeting\s+samapt\b/i,
  /\bbas\s+itna\s+hi\b/i,
  /\baaj\s+ke\s+liye\s+itna\s+hi\b/i,
  /\bmeeting\s+ end\s+kar(?:te|ein)\b/i,
];

export function detectMeetingEnd(text: string): boolean {
  return END_CUE_PATTERNS.some((re) => re.test(text));
}

export const SPEECH_LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "hi-IN", label: "Hindi" },
] as const;
