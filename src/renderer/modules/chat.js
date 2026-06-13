import { getCaptureServices } from "./capture-service.js";
import { renderMarkdown } from "./markdown.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py", ".java",
  ".c", ".cpp", ".h", ".css", ".html", ".xml", ".yaml", ".yml", ".csv",
  ".rs", ".go", ".sh", ".rb", ".php", ".swift", ".kt", ".sql",
]);
const INLINE_MIME_PREFIXES = ["image/", "audio/", "video/"];
const INLINE_MIME_TYPES = new Set(["application/pdf"]);
const TTS_ENABLED = false;

const messages = [
  {
    text: "Hey there! I'm your Clarity AI. Ready to help you understand your screen, plan next steps, and keep moving.",
    sender: "system",
  },
];

let mediaRecorder = null;
let recordingStream = null;
let recordedChunks = [];
let isTranscribing = false;
let pendingAttachments = [];

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name = "") {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function resolveMimeType(file) {
  if (file.type) return file.type;

  const ext = getFileExtension(file.name);
  const map = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".css": "text/css",
    ".html": "text/html",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
  };

  return map[ext] || "application/octet-stream";
}

function isTextAttachment(mimeType, name) {
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json" || mimeType === "application/javascript") return true;
  if (mimeType === "application/xml" || mimeType === "application/yaml") return true;
  return TEXT_EXTENSIONS.has(getFileExtension(name));
}

function isInlineAttachment(mimeType) {
  if (INLINE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return true;
  return INLINE_MIME_TYPES.has(mimeType);
}

function getAttachmentIcon(mimeType) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio_file";
  if (mimeType.startsWith("video/")) return "movie";
  if (mimeType === "application/pdf") return "picture_as_pdf";
  return "description";
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

async function fileToAttachment(file) {
  const mimeType = resolveMimeType(file);

  if (isTextAttachment(mimeType, file.name)) {
    const textContent = await readFileAsText(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType,
      size: file.size,
      textContent,
    };
  }

  if (!isInlineAttachment(mimeType)) {
    throw new Error(`${file.name} is not a supported file type.`);
  }

  const base64 = await readFileAsBase64(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType,
    size: file.size,
    base64,
    previewUrl: mimeType.startsWith("image/") ? URL.createObjectURL(file) : null,
  };
}

function renderAttachmentChip(attachment, { removable = false } = {}) {
  const thumb = attachment.previewUrl
    ? `<img class="attachment-chip-thumb" src="${attachment.previewUrl}" alt="" />`
    : `<div class="attachment-chip-icon"><span class="material-symbols-outlined">${getAttachmentIcon(attachment.mimeType)}</span></div>`;

  const removeButton = removable
    ? `<button class="attachment-chip-remove" type="button" data-attachment-id="${attachment.id}" aria-label="Remove ${escapeHtml(attachment.name)}">
        <span class="material-symbols-outlined">close</span>
      </button>`
    : "";

  return `
    <div class="attachment-chip" data-attachment-id="${attachment.id}">
      ${thumb}
      <div class="attachment-chip-info">
        <span class="attachment-chip-name">${escapeHtml(attachment.name)}</span>
        <span class="attachment-chip-size">${formatFileSize(attachment.size)}</span>
      </div>
      ${removeButton}
    </div>
  `;
}

function renderMessageAttachments(attachments = []) {
  const visibleAttachments = attachments.filter((attachment) => !attachment.contextOnly);
  if (!visibleAttachments.length) return "";

  const items = visibleAttachments
    .map((attachment) => {
      const thumb = attachment.previewUrl
        ? `<img class="message-attachment-thumb" src="${attachment.previewUrl}" alt="" />`
        : `<span class="material-symbols-outlined">${getAttachmentIcon(attachment.mimeType)}</span>`;

      return `
        <div class="message-attachment">
          ${thumb}
          <span>${escapeHtml(attachment.name)}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="message-attachments">${items}</div>`;
}

function renderAttachmentPreview(previewEl) {
  if (!pendingAttachments.length) {
    previewEl.innerHTML = "";
    previewEl.classList.add("hidden");
    return;
  }

  previewEl.innerHTML = pendingAttachments
    .map((attachment) => renderAttachmentChip(attachment, { removable: true }))
    .join("");
  previewEl.classList.remove("hidden");
}

function clearPendingAttachments() {
  for (const attachment of pendingAttachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
  pendingAttachments = [];
}

function removePendingAttachment(id) {
  const index = pendingAttachments.findIndex((attachment) => attachment.id === id);
  if (index === -1) return;

  const [removed] = pendingAttachments.splice(index, 1);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dataUrlToBase64(dataUrl) {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

function screenFrameToAttachment(frame) {
  const base64 = dataUrlToBase64(frame.dataUrl);

  return {
    id: crypto.randomUUID(),
    name: frame.sourceName
      ? `Screen: ${frame.sourceName}`
      : `Screen (${frame.width}x${frame.height})`,
    mimeType: "image/jpeg",
    size: Math.ceil(base64.length * 0.75),
    base64,
    contextOnly: true,
  };
}

async function captureScreenAttachment() {
  try {
    const { screenCapture } = getCaptureServices();

    if (!screenCapture.running) {
      const sources = await screenCapture.listSources({ types: ["screen"] });
      if (!sources.length) return null;
      await screenCapture.start({ sourceId: sources[0].id });
    }

    const frame = await screenCapture.captureFrameAsync({ quality: 0.65 });
    if (!frame) return null;

    return screenFrameToAttachment(frame);
  } catch {
    return null;
  }
}

function formatMessageTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderMessageMarkup(msg) {
  const isUser = msg.sender === "user";
  const groupClass = isUser ? "message-group message-group--user" : "message-group message-group--ai";
  const bubbleClass = isUser ? "user-bubble message-bubble" : "ai-bubble message-bubble";
  const time = msg.time ? formatMessageTime(msg.time) : formatMessageTime();
  const attachmentsMarkup = renderMessageAttachments(msg.attachments);
  const textMarkup = msg.text
    ? isUser
      ? `<div>${escapeHtml(msg.text)}</div>`
      : renderMarkdown(msg.text)
    : "";

  return `
    <div class="${groupClass}">
      <div class="${bubbleClass}">
        ${attachmentsMarkup}
        ${textMarkup}
      </div>
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

async function askGemini() {
  if (!window.geminiChat?.send) {
    throw new Error("Gemini bridge unavailable. Restart the app after preload updates.");
  }

  const history = messages
    .filter((msg) => msg.sender === "user" || (msg.sender === "system" && msg.rawResponse))
    .map(({ text, sender, attachments, rawResponse }) => ({
      text: sender === "system" && rawResponse ? rawResponse : text,
      sender,
      attachments: attachments?.map(({ name, mimeType, base64, textContent }) => ({
        name,
        mimeType,
        base64,
        textContent,
      })),
    }));

  return window.geminiChat.send({ history });
}

function speakExplanation(text) {
  if (!TTS_ENABLED || !text || !window.speechSynthesis) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeGeminiPlan(plan) {
  if (!Array.isArray(plan) || !plan.length || !window.aiTools) return;

  await window.aiTools.ensureOverlay?.();
  await window.aiTools.setCursorVisible(true);
  await window.aiTools.clearHighlights();

  for (const [index, step] of plan.entries()) {
    const stepMeta = {
      stepIndex: index + 1,
      stepTotal: plan.length,
    };

    if (step.action === "cursor") {
      await window.aiTools.moveCursor({
        x: step.x,
        y: step.y,
        label: step.label,
        animate: true,
        duration: 350,
        ...stepMeta,
      });
      await delay(1200);
      continue;
    }

    if (step.action === "highlight") {
      const centerX = step.x + Math.round(step.w / 2);
      const centerY = step.y + Math.round(step.h / 2);

      await window.aiTools.moveCursor({
        x: centerX,
        y: centerY,
        label: step.label,
        animate: true,
        duration: 350,
        ...stepMeta,
      });
      await window.aiTools.highlightRect({
        x: step.x,
        y: step.y,
        width: step.w,
        height: step.h,
        duration: 5000,
      });
      await delay(900);
    }
  }

  await window.aiTools.setCursorVisible(false);
}

async function handleAiCommand(text) {
  try {
    const commandReply = await runCommand(text);
    if (commandReply) return { text: commandReply };

    const response = await askGemini();
    const explanation = (response?.explanation || "").trim();
    const plan = Array.isArray(response?.plan) ? response.plan : [];

    if (!explanation) {
      throw new Error("Gemini returned an empty explanation.");
    }

    speakExplanation(explanation);
    await executeGeminiPlan(plan);

    return {
      text: explanation,
      plan,
      rawResponse: response?.text || JSON.stringify({ explanation, plan }),
    };
  } catch (error) {
    return { text: `AI error: ${error.message}` };
  }
}

async function runCommand(text) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (command === "/cursor" && parts.length >= 3) {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const label = parts.slice(3).join(" ").trim();
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await window.aiTools.ensureOverlay?.();
      await window.aiTools.setCursorVisible(true);
      await window.aiTools.moveCursor({
        x,
        y,
        label: label || "Move here",
        animate: true,
        duration: 350,
      });
      setTimeout(() => {
        window.aiTools.setCursorVisible(false);
      }, 4000);
      return label ? `Moved AI cursor: ${label}` : "Moved AI cursor.";
    }
  }

  if (command === "/highlight" && parts.length >= 5) {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const width = Number(parts[3]);
    const height = Number(parts[4]);
    if ([x, y, width, height].every(Number.isFinite)) {
      await window.aiTools.ensureOverlay?.();
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

function minimizeChatWindow() {
  window.chatWindow?.minimize?.();
}

export function initChat() {
  const messagesEl = document.getElementById("messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const micButton = document.getElementById("mic-button");
  const attachButton = document.getElementById("attach-button");
  const fileInput = document.getElementById("file-input");
  const attachmentPreview = document.getElementById("attachment-preview");
  const closeButton = document.getElementById("close-button");
  const minimizeButton = document.getElementById("minimize-button");
  const typingIndicator = document.getElementById("typing-indicator");

  renderMessages(messagesEl, typingIndicator);

  chatInput.addEventListener("mousedown", () => {
    chatInput.focus();
  });

  closeButton?.addEventListener("click", hideChatWindow);
  minimizeButton?.addEventListener("click", minimizeChatWindow);

  attachButton?.addEventListener("click", () => {
    fileInput?.click();
  });

  fileInput?.addEventListener("change", async () => {
    const selectedFiles = Array.from(fileInput.files || []);
    fileInput.value = "";

    if (!selectedFiles.length) return;

    const slotsLeft = MAX_ATTACHMENTS - pendingAttachments.length;
    if (slotsLeft <= 0) {
      pushSystemMessage(messagesEl, typingIndicator, `You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }

    const filesToAdd = selectedFiles.slice(0, slotsLeft);
    if (selectedFiles.length > slotsLeft) {
      pushSystemMessage(
        messagesEl,
        typingIndicator,
        `Only ${slotsLeft} more file${slotsLeft === 1 ? "" : "s"} can be attached.`
      );
    }

    for (const file of filesToAdd) {
      if (file.size > MAX_FILE_SIZE) {
        pushSystemMessage(
          messagesEl,
          typingIndicator,
          `${file.name} is too large. Max size is ${formatFileSize(MAX_FILE_SIZE)}.`
        );
        continue;
      }

      try {
        const attachment = await fileToAttachment(file);
        pendingAttachments.push(attachment);
      } catch (error) {
        pushSystemMessage(messagesEl, typingIndicator, error.message);
      }
    }

    renderAttachmentPreview(attachmentPreview);
    chatInput.focus();
  });

  attachmentPreview?.addEventListener("click", (event) => {
    const button = event.target.closest(".attachment-chip-remove");
    if (!button?.dataset.attachmentId) return;

    removePendingAttachment(button.dataset.attachmentId);
    renderAttachmentPreview(attachmentPreview);
  });

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = chatInput.value.trim();
    const fileAttachments = pendingAttachments.map((attachment) => ({ ...attachment }));

    if (!text && !fileAttachments.length) return;

    chatInput.value = "";
    clearPendingAttachments();
    renderAttachmentPreview(attachmentPreview);

    showTypingIndicator(typingIndicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const screenAttachment = await captureScreenAttachment();
    const attachments = [
      ...fileAttachments,
      ...(screenAttachment ? [screenAttachment] : []),
    ];

    if (!text && !attachments.length) {
      hideTypingIndicator(typingIndicator);
      return;
    }

    messages.push({ text, sender: "user", time: new Date(), attachments });
    renderMessages(messagesEl, typingIndicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const aiReply = await handleAiCommand(text);

    hideTypingIndicator(typingIndicator);

    if (aiReply?.text) {
      messages.push({
        text: aiReply.text,
        sender: "system",
        time: new Date(),
        plan: aiReply.plan,
        rawResponse: aiReply.rawResponse,
      });
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
