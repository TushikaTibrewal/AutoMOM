import { useCallback, useRef, useState } from "react";

interface Options {
  /** Called with a complete, standalone audio segment (~segmentMs long). */
  onSegment: (blob: Blob) => void;
  segmentMs?: number;
  captureMic?: boolean;
}

/**
 * Captures a live meeting's audio for transcription.
 *
 * - getDisplayMedia({ audio }) grabs the shared browser tab's audio — i.e. the
 *   OTHER participants in a Google Meet / Zoom tab (incoming voices).
 * - getUserMedia({ audio }) grabs the local microphone (the user's outgoing voice).
 * - Both are mixed with the Web Audio API into a single stream.
 * - A MediaRecorder is stopped/restarted every `segmentMs` so each segment is a
 *   complete, independently-decodable WebM file that Whisper can transcribe.
 *
 * Requires Chrome/Edge desktop. The user must pick the meeting tab AND tick
 * "Share tab audio" in the browser picker — that action is the consent.
 */
export function useMeetingCapture({ onSegment, segmentMs = 6000, captureMic = true }: Options) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayStreamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeRef = useRef(false);
  const segmentTimerRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    activeRef.current = false;
    if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
    try {
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
      videoElRef.current = null;
    }
    displayStreamRef.current = null;
    micStreamRef.current = null;
    audioCtxRef.current = null;
    recorderRef.current = null;
    setActive(false);
  }, []);

  const recordSegment = useCallback(
    (stream: MediaStream) => {
      if (!activeRef.current) return;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size > 1024) onSegment(blob); // skip near-silent tiny blobs
        if (activeRef.current) recordSegment(stream); // next segment
      };
      recorder.start();
      segmentTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, segmentMs);
    },
    [onSegment, segmentMs],
  );

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen/tab audio capture needs Chrome or Edge on desktop.");
      return false;
    }
    try {
      // Chrome requires video:true to offer tab/system audio sharing.
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      displayStreamRef.current = display;

      // Hidden <video> playing the shared tab — used to grab frames for the
      // vision-based participant reader.
      const video = document.createElement("video");
      video.srcObject = new MediaStream(display.getVideoTracks());
      video.muted = true;
      video.play().catch(() => {});
      videoElRef.current = video;

      if (display.getAudioTracks().length === 0) {
        cleanup();
        setError(
          'No tab audio captured. Re-share and tick "Share tab audio" (or "Share system audio") in the picker.',
        );
        return false;
      }
      // If the user stops sharing from the browser bar, tear down.
      display.getVideoTracks()[0]?.addEventListener("ended", cleanup);

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const destination = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(destination);

      if (captureMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = mic;
          ctx.createMediaStreamSource(mic).connect(destination);
        } catch {
          setError("Mic unavailable — capturing meeting audio only.");
        }
      }

      activeRef.current = true;
      setActive(true);
      recordSegment(destination.stream);
      return true;
    } catch (err) {
      cleanup();
      const name = (err as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Screen share was cancelled. Pick the meeting tab and enable its audio."
          : "Could not start meeting capture.",
      );
      return false;
    }
  }, [captureMic, cleanup, recordSegment]);

  const stop = useCallback(() => cleanup(), [cleanup]);

  /** Grab the current shared-tab frame as a JPEG for participant detection. */
  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    const video = videoElRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    // Cap width to keep the upload small; vision models don't need full res.
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7));
  }, []);

  return { active, error, start, stop, captureFrame };
}
