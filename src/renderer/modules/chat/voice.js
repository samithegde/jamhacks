import { getChatAccessibilityPreferences } from "../chat-accessibility.js";
import {
  SILENCE_CHECK_INTERVAL_MS,
  SILENCE_DURATION_MS,
  SILENCE_THRESHOLD,
} from "./constants.js";
import {
  currentReaderAudio,
  isStoppingRecording,
  isTranscribing,
  mediaRecorder,
  recordedChunks,
  recordingStream,
  silenceMonitor,
  setCurrentReaderAudio,
  setIsStoppingRecording,
  setIsTranscribing,
  setMediaRecorder,
  setRecordedChunks,
  setRecordingStream,
  setSilenceMonitor,
} from "./state.js";
import { pushSystemMessage } from "./history.js";

export function setMicButtonState(button, state) {
  const icon = button.querySelector(".material-symbols-outlined");
  button.classList.remove("recording", "transcribing");

  if (state === "recording") {
    button.classList.add("recording");
    if (icon) icon.textContent = "stop_circle";
    return;
  }

  if (state === "transcribing") {
    button.classList.add("transcribing");
    if (icon) icon.textContent = "hourglass_top";
    return;
  }

  if (icon) icon.textContent = "mic";
}

export function stopVoiceReaderAudio() {
  if (!currentReaderAudio) return;
  currentReaderAudio.pause();
  currentReaderAudio.currentTime = 0;
  setCurrentReaderAudio(null);
}

export function playBrowserSpeech(text) {
  if (!("speechSynthesis" in window)) return;

  stopVoiceReaderAudio();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

export async function speakExplanation(text) {
  const cleanText = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!cleanText || !getChatAccessibilityPreferences().screenReader) return;

  try {
    if (!window.aiTools?.speakAccessibility) {
      throw new Error("ElevenLabs speech bridge is unavailable.");
    }

    stopVoiceReaderAudio();
    window.speechSynthesis?.cancel?.();

    const audio = await window.aiTools.speakAccessibility(cleanText);
    if (!audio?.base64) {
      throw new Error("ElevenLabs returned no audio.");
    }

    const readerAudio = new Audio(
      `data:${audio.mimeType || "audio/mpeg"};base64,${audio.base64}`
    );
    readerAudio.onended = () => {
      setCurrentReaderAudio(null);
    };
    setCurrentReaderAudio(readerAudio);
    await readerAudio.play();
  } catch (error) {
    console.warn("ElevenLabs chat reader failed:", error);
    playBrowserSpeech(cleanText);
  }
}

export async function decodeBlobToMonoFloat32(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const mono = new Float32Array(audioBuffer.length);
  const channelCount = audioBuffer.numberOfChannels;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i += 1) {
      mono[i] += channelData[i] / channelCount;
    }
  }

  await audioContext.close();
  return {
    samples: mono,
    sampleRate: audioBuffer.sampleRate,
  };
}

export function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;

  const ratio = fromRate / toRate;
  const newLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(newLength);

  for (let i = 0; i < newLength; i += 1) {
    const sourceIndex = i * ratio;
    const low = Math.floor(sourceIndex);
    const high = Math.min(low + 1, samples.length - 1);
    const t = sourceIndex - low;
    output[i] = samples[low] * (1 - t) + samples[high] * t;
  }

  return output;
}

export function stopSilenceMonitor() {
  if (!silenceMonitor) return;

  clearInterval(silenceMonitor.intervalId);
  silenceMonitor.source?.disconnect();
  silenceMonitor.audioContext?.close().catch(() => {});
  setSilenceMonitor(null);
}

export function startSilenceMonitor(stream, onSilence) {
  stopSilenceMonitor();

  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  let hasSpoken = false;
  let silenceStart = null;

  const intervalId = setInterval(() => {
    analyser.getByteTimeDomainData(samples);

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const normalized = (samples[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / samples.length);
    const isSilent = rms < SILENCE_THRESHOLD;

    if (!isSilent) {
      hasSpoken = true;
      silenceStart = null;
      return;
    }

    if (!hasSpoken) return;

    if (!silenceStart) {
      silenceStart = Date.now();
      return;
    }

    if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
      stopSilenceMonitor();
      onSilence();
    }
  }, SILENCE_CHECK_INTERVAL_MS);

  setSilenceMonitor({ audioContext, source, intervalId });
}

export async function startMicRecording(messagesEl, typingIndicator, chatInput, micButton) {
  if (mediaRecorder || isTranscribing) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  setRecordingStream(stream);
  setRecordedChunks([]);
  const recorder = new MediaRecorder(stream);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  setMediaRecorder(recorder);
  recorder.start();
  setMicButtonState(micButton, "recording");
  pushSystemMessage(
    messagesEl,
    typingIndicator,
    "Listening... stops automatically after 2 seconds of silence."
  );

  startSilenceMonitor(stream, () => {
    stopMicRecording(messagesEl, typingIndicator, chatInput, micButton).catch((error) => {
      setMicButtonState(micButton, "idle");
      pushSystemMessage(messagesEl, typingIndicator, `Microphone error: ${error.message}`);
    });
  });
}

export async function stopMicRecording(messagesEl, typingIndicator, chatInput, micButton) {
  if (!mediaRecorder || isStoppingRecording) return;

  setIsStoppingRecording(true);
  stopSilenceMonitor();

  setIsTranscribing(true);
  setMicButtonState(micButton, "transcribing");

  const recorder = mediaRecorder;
  const stream = recordingStream;
  setMediaRecorder(null);
  setRecordingStream(null);

  const stopPromise = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  recorder.stop();
  await stopPromise;

  stream.getTracks().forEach((track) => track.stop());

  const audioBlob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
  setRecordedChunks([]);

  if (audioBlob.size === 0) {
    setIsTranscribing(false);
    setIsStoppingRecording(false);
    setMicButtonState(micButton, "idle");
    pushSystemMessage(messagesEl, typingIndicator, "No audio captured.");
    return;
  }

  pushSystemMessage(messagesEl, typingIndicator, "Transcribing audio...");

  try {
    const decoded = await decodeBlobToMonoFloat32(audioBlob);
    const targetRate = 16000;
    const resampled = resampleLinear(decoded.samples, decoded.sampleRate, targetRate);

    if (!window.whisper?.transcribe) {
      throw new Error("Whisper bridge unavailable. Restart app after preload updates.");
    }

    const response = await window.whisper.transcribe({
      samples: Array.from(resampled),
      sampleRate: targetRate,
    });

    const transcript = (response?.text || "").trim();
    if (!transcript) {
      pushSystemMessage(messagesEl, typingIndicator, "Transcription returned no text.");
    } else {
      chatInput.value = chatInput.value
        ? `${chatInput.value} ${transcript}`
        : transcript;
      pushSystemMessage(messagesEl, typingIndicator, "Transcription inserted into input.");
    }
  } catch (error) {
    pushSystemMessage(messagesEl, typingIndicator, `Transcription failed: ${error.message}`);
  } finally {
    setIsTranscribing(false);
    setIsStoppingRecording(false);
    setMicButtonState(micButton, "idle");
    chatInput.focus();
  }
}
