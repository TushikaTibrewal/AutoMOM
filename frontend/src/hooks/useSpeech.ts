import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as new () => RecognitionLike) ??
    (w.webkitSpeechRecognition as new () => RecognitionLike) ??
    null;
}

/** Browser SpeechRecognition wrapper: streams final results via onFinal.
 *  `lang` is a BCP-47 tag, e.g. "en-IN", "hi-IN". Defaults to the browser locale. */
export function useSpeech(onFinal: (text: string) => void, lang?: string) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const wantedRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const langRef = useRef(lang);
  langRef.current = lang;

  const supported = getRecognitionCtor() !== null;

  const stop = useCallback(() => {
    wantedRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    setError(null);
    const rec = new Ctor();
    rec.lang = langRef.current || navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          onFinalRef.current(result[0].transcript.trim() + " ");
        } else {
          interimText += result[0].transcript;
        }
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") setError("Microphone permission denied.");
      else if (e.error !== "aborted") setError(`Speech error: ${e.error}`);
    };
    rec.onend = () => {
      // Chrome stops after silence; restart if the user hasn't clicked stop.
      if (wantedRef.current) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };
    recognitionRef.current = rec;
    wantedRef.current = true;
    rec.start();
    setListening(true);
  }, []);

  useEffect(() => stop, [stop]);

  return { supported, listening, interim, error, start, stop };
}
