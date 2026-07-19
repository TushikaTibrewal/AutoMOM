let audioContext: AudioContext | null = null;
let tabSource: MediaStreamAudioSourceNode | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let destination: MediaStreamAudioDestinationNode | null = null;
let mixedStream: MediaStream | null = null;

let currentRecorder: MediaRecorder | null = null;
let currentChunks: Blob[] = [];
let chunkInterval: any = null;
let isCapturing = false;

// Audio parameters
const RECORD_CHUNK_MS = 6000; // 6 seconds per segment

async function getBackendConfig() {
  const result = await chrome.storage.local.get(["backendUrl", "token"]);
  const backendUrl = result.backendUrl || "https://automom-backend.onrender.com";
  const token = result.token || "";
  return { backendUrl, token };
}

async function startCapture(streamId: string) {
  if (isCapturing) return;
  console.log("Offscreen starting capture with streamId:", streamId);

  try {
    audioContext = new AudioContext();

    // 1. Capture Tab Audio
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as any,
      video: false,
    });

    // 2. Capture Microphone Audio
    let micStream: MediaStream | null = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.warn("Failed to get microphone stream. Capturing tab audio only.", e);
    }

    // 3. Mix streams via AudioContext
    destination = audioContext.createMediaStreamDestination();

    // Tab audio routing
    tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(destination);
    
    // Crucial: Route tab audio back to the local system speakers so the user can hear the meeting!
    tabSource.connect(audioContext.destination);

    // Mic audio routing (if available)
    if (micStream) {
      micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
    }

    mixedStream = destination.stream;
    isCapturing = true;

    // Start chunked recording cycle
    startChunkCycle();

  } catch (err) {
    console.error("Failed to setup offscreen audio capture:", err);
    chrome.runtime.sendMessage({
      type: "error",
      message: "Audio capture failed. Make sure you gave microphone permission and selected the correct tab.",
    }).catch(() => {});
  }
}

function startChunkCycle() {
  if (!isCapturing || !mixedStream) return;

  function recordNextChunk() {
    if (!isCapturing || !mixedStream) return;

    currentChunks = [];
    currentRecorder = new MediaRecorder(mixedStream, { mimeType: "audio/webm;codecs=opus" });

    currentRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        currentChunks.push(e.data);
      }
    };

    currentRecorder.onstop = async () => {
      if (currentChunks.length > 0) {
        const audioBlob = new Blob(currentChunks, { type: "audio/webm;codecs=opus" });
        if (audioBlob.size > 1500) { // Ignore silent/empty chunks
          uploadChunk(audioBlob);
        }
      }
      // Recursively start the next chunk if still capturing
      if (isCapturing) {
        recordNextChunk();
      }
    };

    currentRecorder.start();

    // Schedule stop after RECORD_CHUNK_MS
    chunkInterval = setTimeout(() => {
      if (currentRecorder && currentRecorder.state === "recording") {
        currentRecorder.stop();
      }
    }, RECORD_CHUNK_MS);
  }

  recordNextChunk();
}

async function uploadChunk(blob: Blob) {
  const { backendUrl, token } = await getBackendConfig();
  if (!token) return;

  const url = `${backendUrl.replace(/\/$/, "")}/api/transcribe-audio`;
  const formData = new FormData();
  formData.append("file", blob, "segment.webm");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (res.status === 200) {
      const data = await res.json();
      const text = data.text?.trim();
      if (text) {
        console.log("Transcribed chunk:", text);
        // Send segment to background
        chrome.runtime.sendMessage({
          type: "TRANSCRIPT_SEGMENT",
          text,
          speaker: "Speaker", // Whisper does not do speaker diarization, default to Speaker
          ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        }).catch(() => {});
      }
    } else {
      console.warn("Chunk transcription failed with code:", res.status);
    }
  } catch (err) {
    console.error("Error uploading chunk to backend:", err);
  }
}

function stopCapture() {
  isCapturing = false;
  if (chunkInterval) {
    clearTimeout(chunkInterval);
    chunkInterval = null;
  }
  if (currentRecorder && currentRecorder.state === "recording") {
    currentRecorder.stop();
  }

  // Stop all audio tracks
  if (tabSource) {
    tabSource.disconnect();
    tabSource = null;
  }
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  mixedStream = null;
  console.log("Offscreen capture stopped.");
}

// Listen for control commands from background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "start-capture") {
    startCapture(message.streamId);
  } else if (message.type === "stop-capture") {
    stopCapture();
  } else if (message.type === "pause-capture") {
    if (currentRecorder && currentRecorder.state === "recording") {
      currentRecorder.pause();
    }
  } else if (message.type === "resume-capture") {
    if (currentRecorder && currentRecorder.state === "paused") {
      currentRecorder.resume();
    }
  }
});
