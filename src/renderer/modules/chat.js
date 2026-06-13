import { getCaptureServices } from "./capture-service.js";

const messages = [
  {
    text: "Hey there! I'm your JAMHacks AI. Ready to build something epic? I can help with API questions, schedule info, or finding team members!",
    sender: "system",
  },
];

let mediaRecorder = null;
let recordingStream = null;
let recordedChunks = [];
let isTranscribing = false;

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMessageTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderMessageMarkup(msg) {
  const isUser = msg.sender === "user";
  const groupClass = isUser ? "message-group message-group--user" : "message-group message-group--ai";
  const bubbleClass = isUser ? "user-bubble message-bubble" : "ai-bubble message-bubble";
  const time = msg.time ? formatMessageTime(msg.time) : formatMessageTime();

  return `
    <div class="${groupClass}">
      <div class="${bubbleClass}">${escapeHtml(msg.text)}</div>
      <span class="message-time">${time}</span>
    </div>
  `;
}

function renderMessages(messagesEl, typingIndicator) {
  messagesEl.innerHTML = messages.map((msg) => renderMessageMarkup(msg)).join("");
  messagesEl.appendChild(typingIndicator);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setMicButtonState(button, state) {
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

function showTypingIndicator(typingIndicator) {
  typingIndicator.classList.remove("hidden");
  typingIndicator.setAttribute("aria-hidden", "false");
}

function hideTypingIndicator(typingIndicator) {
  typingIndicator.classList.add("hidden");
  typingIndicator.setAttribute("aria-hidden", "true");
}

function pushSystemMessage(messagesEl, typingIndicator, text) {
  messages.push({ text, sender: "system", time: new Date() });
  renderMessages(messagesEl, typingIndicator);
}

async function decodeBlobToMonoFloat32(blob) {
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

function resampleLinear(samples, fromRate, toRate) {
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

async function startMicRecording(messagesEl, typingIndicator, micButton) {
  if (mediaRecorder || isTranscribing) return;

  recordingStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(recordingStream);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.start();
  setMicButtonState(micButton, "recording");
  pushSystemMessage(messagesEl, typingIndicator, "Listening... click Stop when finished.");
}

async function stopMicRecording(messagesEl, typingIndicator, chatInput, micButton) {
  if (!mediaRecorder) return;

  isTranscribing = true;
  setMicButtonState(micButton, "transcribing");

  const recorder = mediaRecorder;
  const stream = recordingStream;
  mediaRecorder = null;
  recordingStream = null;

  const stopPromise = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  recorder.stop();
  await stopPromise;

  stream.getTracks().forEach((track) => track.stop());

  const audioBlob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
  recordedChunks = [];

  if (audioBlob.size === 0) {
    setMicButtonState(micButton, "idle");
    isTranscribing = false;
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
    isTranscribing = false;
    setMicButtonState(micButton, "idle");
    chatInput.focus();
  }
}

async function handleAiCommand(text) {
  try {
    return await runCommand(text);
  } catch (error) {
    return `Capture error: ${error.message}`;
  }
}

async function runCommand(text) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (command === "/cursor" && parts.length >= 3) {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await window.aiTools.moveCursor({ x, y, animate: true, duration: 350 });
      return "Moved AI cursor.";
    }
  }

  if (command === "/highlight" && parts.length >= 5) {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const width = Number(parts[3]);
    const height = Number(parts[4]);
    if ([x, y, width, height].every(Number.isFinite)) {
      await window.aiTools.highlightRect({ x, y, width, height, duration: 5000 });
      return "Added highlight.";
    }
  }

  if (command === "/clear") {
    await window.aiTools.clearHighlights();
    return "Cleared highlights.";
  }

  const { audioCapture, screenCapture } = getCaptureServices();

  if (command === "/mic" && parts[1] === "start") {
    const status = await audioCapture.start();
    return `Mic capture running at ${status.sampleRate}Hz (${status.channelCount}ch).`;
  }

  if (command === "/mic" && parts[1] === "stop") {
    audioCapture.stop();
    await window.capture.clearAudioBuffer();
    return "Mic capture stopped.";
  }

  if (command === "/mic" && parts[1] === "stats") {
    const local = audioCapture.getLocalStats();
    const main = await window.capture.getAudioBufferStats();
    return `Mic chunks local=${local.chunkCount}, main=${main.chunkCount}, samples=${main.sampleCount}.`;
  }

  if (command === "/screens") {
    const sources = await screenCapture.listSources({ types: ["screen"] });
    if (!sources.length) return "No screens found.";
    return sources
      .map((source, index) => `${index}: ${source.name} (${source.id})`)
      .join(" | ");
  }

  if (command === "/screen" && parts[1] === "start") {
    const sources = await screenCapture.listSources({ types: ["screen"] });
    const index = Number(parts[2] ?? 0);
    const source = sources[index];
    if (!source) return "Screen source not found.";

    const status = await screenCapture.start({ sourceId: source.id });
    return `Screen capture started: ${status.sourceName ?? source.name}.`;
  }

  if (command === "/screen" && parts[1] === "stop") {
    screenCapture.stop();
    return "Screen capture stopped.";
  }

  if (command === "/screen" && parts[1] === "frame") {
    const frame = screenCapture.captureFrame();
    if (!frame) return "No screen frame available.";
    return `Captured ${frame.width}x${frame.height} frame.`;
  }

  return null;
}

function hideChatWindow() {
  window.chatWindow?.hide?.();
}

export function initChat() {
  const messagesEl = document.getElementById("messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const micButton = document.getElementById("mic-button");
  const closeButton = document.getElementById("close-button");
  const minimizeButton = document.getElementById("minimize-button");
  const typingIndicator = document.getElementById("typing-indicator");

  renderMessages(messagesEl, typingIndicator);

  chatInput.addEventListener("mousedown", () => {
    chatInput.focus();
  });

  closeButton?.addEventListener("click", hideChatWindow);
  minimizeButton?.addEventListener("click", hideChatWindow);

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = "";
    messages.push({ text, sender: "user", time: new Date() });
    renderMessages(messagesEl, typingIndicator);

    showTypingIndicator(typingIndicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const aiReply = await handleAiCommand(text);

    hideTypingIndicator(typingIndicator);

    if (aiReply) {
      messages.push({ text: aiReply, sender: "system", time: new Date() });
      renderMessages(messagesEl, typingIndicator);
    }

    chatInput.focus();
  });

  micButton.addEventListener("click", async () => {
    try {
      if (mediaRecorder) {
        await stopMicRecording(messagesEl, typingIndicator, chatInput, micButton);
      } else {
        await startMicRecording(messagesEl, typingIndicator, micButton);
      }
    } catch (error) {
      setMicButtonState(micButton, "idle");
      pushSystemMessage(messagesEl, typingIndicator, `Microphone error: ${error.message}`);
    }
  });
}
