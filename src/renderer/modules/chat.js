import { getCaptureServices } from "./capture-service.js";
import { getChatAccessibilityPreferences } from "./chat-accessibility.js";
import { cropBase64Image } from "./context-crop.js";
import { applyMicroGridToCrop } from "./micro-grid-annotate.js";
import { renderMarkdown } from "./markdown.js";
import { annotateScreenshot } from "./som-annotate.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py", ".java",
  ".c", ".cpp", ".h", ".css", ".html", ".xml", ".yaml", ".yml", ".csv",
  ".rs", ".go", ".sh", ".rb", ".php", ".swift", ".kt", ".sql",
]);
const INLINE_MIME_PREFIXES = ["image/", "audio/", "video/"];
const INLINE_MIME_TYPES = new Set(["application/pdf"]);
const CHAT_CONVERSATION_STORAGE_KEY = "clarity:chat-conversation-id";

const DEFAULT_WELCOME_MESSAGE = {
  text: "Hey there! I'm your Clarity AI. Ready to help you understand your screen, plan next steps, and keep moving.",
  sender: "system",
};

const messages = [];

let conversationId = null;
let mediaRecorder = null;
let recordingStream = null;
let recordedChunks = [];
let isTranscribing = false;
let isStoppingRecording = false;
let silenceMonitor = null;

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 1200;
const SILENCE_CHECK_INTERVAL_MS = 100;
let pendingAttachments = [];
let currentReaderAudio = null;
let promptLoopActive = false;
let promptLoopCancelled = false;
let resolvePromptWait = null;
let newChatButton = null;
let isAiBusy = false;
let latestLocalizationContext = null;

class PromptCancelledError extends Error {
  constructor() {
    super("Prompt cancelled.");
    this.name = "PromptCancelledError";
  }
}

function getConversationId() {
  if (conversationId) return conversationId;

  conversationId = localStorage.getItem(CHAT_CONVERSATION_STORAGE_KEY);
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    localStorage.setItem(CHAT_CONVERSATION_STORAGE_KEY, conversationId);
  }

  return conversationId;
}

function resetConversationId() {
  conversationId = crypto.randomUUID();
  localStorage.setItem(CHAT_CONVERSATION_STORAGE_KEY, conversationId);
  return conversationId;
}

function setNewChatButtonDisabled(disabled) {
  if (!newChatButton) return;
  newChatButton.disabled = disabled;
}

function updateNewChatButtonState() {
  setNewChatButtonDisabled(isAiBusy || promptLoopActive);
}

function updateSyncStatus(state) {
  const syncStatusEl = document.getElementById("chat-sync-status");
  const syncStatusDot = document.querySelector(".chat-status-dot");
  if (!syncStatusEl || !syncStatusDot) return;

  syncStatusDot.classList.remove("chat-status-dot--synced", "chat-status-dot--local");

  if (state === "checking") {
    syncStatusEl.textContent = "Checking sync…";
    return;
  }

  if (state === "local") {
    syncStatusEl.textContent = "Local only";
    syncStatusDot.classList.add("chat-status-dot--local");
    return;
  }

  if (state === "synced") {
    syncStatusEl.textContent = "Synced";
    syncStatusDot.classList.add("chat-status-dot--synced");
  }
}

async function refreshSyncStatus() {
  if (!window.chatHistory?.status) {
    updateSyncStatus("local");
    return;
  }

  updateSyncStatus("checking");

  try {
    const status = await window.chatHistory.status();
    updateSyncStatus(status?.connected ? "synced" : "local");
  } catch {
    updateSyncStatus("local");
  }
}

function createMessage(message) {
  return {
    id: crypto.randomUUID(),
    time: new Date(),
    ...message,
  };
}

function hydrateStoredMessage(message = {}) {
  return {
    ...message,
    time: message.time ? new Date(message.time) : new Date(),
  };
}

function getPersistableMessage(message) {
  return {
    id: message.id,
    text: message.text,
    sender: message.sender,
    time: message.time,
    rawResponse: message.rawResponse,
    plan: message.plan,
    attachments: message.attachments?.map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      contextOnly: attachment.contextOnly,
    })),
  };
}

async function loadChatHistory() {
  if (!window.chatHistory?.list) return false;

  try {
    const storedMessages = await window.chatHistory.list({
      conversationId: getConversationId(),
    });
    if (!Array.isArray(storedMessages) || !storedMessages.length) return false;

    messages.splice(0, messages.length, ...storedMessages.map(hydrateStoredMessage));
    return true;
  } catch (error) {
    console.warn("Failed to load MongoDB chat history:", error);
    return false;
  }
}

async function saveChatMessage(message) {
  if (!window.chatHistory?.save) return;

  try {
    await window.chatHistory.save({
      conversationId: getConversationId(),
      message: getPersistableMessage(message),
    });
  } catch (error) {
    console.warn("Failed to save MongoDB chat history:", error);
    updateSyncStatus("local");
  }
}

async function bootstrapChat(messagesEl, typingIndicator) {
  updateSyncStatus("checking");

  const loaded = await loadChatHistory();
  if (!loaded) {
    messages.splice(0, messages.length, { ...DEFAULT_WELCOME_MESSAGE });
  }

  renderMessages(messagesEl, typingIndicator);
  await refreshSyncStatus();
}

async function startNewChat(messagesEl, typingIndicator) {
  cancelPrompt();

  const previousConversationId = getConversationId();

  if (window.chatHistory?.clear) {
    try {
      await window.chatHistory.clear({ conversationId: previousConversationId });
    } catch (error) {
      console.warn("Failed to clear MongoDB chat history:", error);
    }
  }

  resetConversationId();
  messages.splice(0, messages.length, { ...DEFAULT_WELCOME_MESSAGE });
  renderMessages(messagesEl, typingIndicator);
}

export function cancelPrompt() {
  if (!promptLoopActive) return false;

  promptLoopCancelled = true;
  window.aiTools?.hideNextButton?.();
  resolvePromptWait?.();
  return true;
}

function beginPromptLoop() {
  promptLoopActive = true;
  promptLoopCancelled = false;
  resolvePromptWait = null;
  updateNewChatButtonState();
}

function resetPromptLoopState() {
  promptLoopActive = false;
  promptLoopCancelled = false;
  resolvePromptWait = null;
  updateNewChatButtonState();
}

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
    const context = await captureScreenContext({ annotate: true });
    if (!context?.screenshotBase64) return null;

    return {
      id: crypto.randomUUID(),
      name: "Screen with marks",
      mimeType: "image/jpeg",
      size: Math.ceil(context.screenshotBase64.length * 0.75),
      base64: context.screenshotBase64,
      contextOnly: true,
    };
  } catch {
    return null;
  }
}

async function captureScreenBase64() {
  try {
    const { screenCapture } = getCaptureServices();

    if (!screenCapture.running) {
      const sources = await screenCapture.listSources({ types: ["screen"] });
      if (!sources.length) return null;
      await screenCapture.start({ sourceId: sources[0].id });
    }

    const frame = await screenCapture.captureFrameAsync({ quality: 0.65 });
    if (!frame?.dataUrl) return null;

    return dataUrlToBase64(frame.dataUrl);
  } catch {
    return null;
  }
}

async function captureScreenContext({ annotate = false } = {}) {
  const rawBase64 = await captureScreenBase64();
  if (!rawBase64) return null;

  if (!annotate || !window.localization?.discoverMarks) {
    latestLocalizationContext = null;
    return {
      rawBase64,
      screenshotBase64: rawBase64,
      marks: [],
      displayBounds: null,
      imageMeta: null,
    };
  }

  try {
    const discovered = await window.localization.discoverMarks();
    const marks = Array.isArray(discovered?.marks) ? discovered.marks : [];
    if (!discovered?.enabled || !marks.length) {
      latestLocalizationContext = null;
      return {
        rawBase64,
        screenshotBase64: rawBase64,
        marks: [],
        displayBounds: discovered?.displayBounds ?? null,
        imageMeta: null,
      };
    }

    const annotated = await annotateScreenshot(rawBase64, marks);
    latestLocalizationContext = {
      rawBase64,
      screenshotBase64: annotated.annotatedBase64,
      marks: annotated.marks,
      displayBounds: discovered.displayBounds ?? null,
      imageMeta: annotated.imageMeta,
    };

    return latestLocalizationContext;
  } catch (error) {
    console.warn("[localization] SoM annotation failed:", error);
    latestLocalizationContext = null;
    return {
      rawBase64,
      screenshotBase64: rawBase64,
      marks: [],
      displayBounds: null,
      imageMeta: null,
    };
  }
}

function imageMarkToCssBox(mark, imageMeta) {
  const dpr = imageMeta?.dpr || window.devicePixelRatio || 1;
  const imageWidth = imageMeta?.width || window.screen.width * dpr;
  const imageHeight = imageMeta?.height || window.screen.height * dpr;
  const scaleX = imageWidth / (window.screen.width * dpr);
  const scaleY = imageHeight / (window.screen.height * dpr);
  const divisorX = dpr * (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1);
  const divisorY = dpr * (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1);

  return {
    x: Number(mark.x) / divisorX,
    y: Number(mark.y) / divisorY,
    w: Number(mark.w) / divisorX,
    h: Number(mark.h) / divisorY,
  };
}

function resolveStepMark(step, context = latestLocalizationContext) {
  const markId = Number(step?.markId);
  if (!Number.isFinite(markId)) {
    if (![Number(step?.x), Number(step?.y)].every(Number.isFinite)) return null;

    return {
      ...step,
      coarseMethod: "legacy",
      markBBox: step?.w && step?.h
        ? { x: step.x, y: step.y, w: step.w, h: step.h }
        : null,
    };
  }

  const mark = context?.marks?.find((candidate) => Number(candidate.id) === markId);
  if (!mark) {
    if (![Number(step?.x), Number(step?.y)].every(Number.isFinite)) return null;
    return { ...step, coarseMethod: "legacy" };
  }

  const markBBox = imageMarkToCssBox(mark, context?.imageMeta);
  const centerX = Math.round(markBBox.x + markBBox.w / 2);
  const centerY = Math.round(markBBox.y + markBBox.h / 2);
  const description = step.description || step.label || mark.label || `Mark ${mark.id}`;

  if (step.action === "highlight") {
    return {
      ...step,
      x: Math.round(markBBox.x),
      y: Math.round(markBBox.y),
      w: Math.round(markBBox.w),
      h: Math.round(markBBox.h),
      markBBox,
      description,
      label: description,
      coarseMethod: "markId",
    };
  }

  return {
    ...step,
    x: centerX,
    y: centerY,
    w: Math.round(markBBox.w),
    h: Math.round(markBBox.h),
    markBBox,
    description,
    label: description,
    coarseMethod: "markId",
  };
}

function extractTargetText(description = "") {
  const text = String(description ?? "").trim();
  const quoted = text.match(/["'`](.+?)["'`]/);
  if (quoted?.[1]) return quoted[1].trim();

  const withoutMarkdown = text
    .replace(/[*_`#>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nounish = withoutMarkdown.match(/\b(?:button|link|menu|tab|field|input|option|item)\s+(.+)$/i);
  return (nounish?.[1] || withoutMarkdown).slice(0, 80);
}

function logLocalization(methods = {}) {
  console.info("[localization]", {
    coarseMethod: methods.coarseMethod || "legacy",
    refineMethod: methods.refineMethod || "skipped",
  });
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
  const message = createMessage({ text, sender: "system" });
  messages.push(message);
  renderMessages(messagesEl, typingIndicator);
  saveChatMessage(message);
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

function stopSilenceMonitor() {
  if (!silenceMonitor) return;

  clearInterval(silenceMonitor.intervalId);
  silenceMonitor.source?.disconnect();
  silenceMonitor.audioContext?.close().catch(() => {});
  silenceMonitor = null;
}

function startSilenceMonitor(stream, onSilence) {
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

  silenceMonitor = { audioContext, source, intervalId };
}

async function startMicRecording(messagesEl, typingIndicator, chatInput, micButton) {
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
  pushSystemMessage(
    messagesEl,
    typingIndicator,
    "Listening... stops automatically after 2 seconds of silence."
  );

  startSilenceMonitor(recordingStream, () => {
    stopMicRecording(messagesEl, typingIndicator, chatInput, micButton).catch((error) => {
      setMicButtonState(micButton, "idle");
      pushSystemMessage(messagesEl, typingIndicator, `Microphone error: ${error.message}`);
    });
  });
}

async function stopMicRecording(messagesEl, typingIndicator, chatInput, micButton) {
  if (!mediaRecorder || isStoppingRecording) return;

  isStoppingRecording = true;
  stopSilenceMonitor();

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
    isTranscribing = false;
    isStoppingRecording = false;
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
    isTranscribing = false;
    isStoppingRecording = false;
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

  return window.geminiChat.send({
    history,
    marks: latestLocalizationContext?.marks ?? [],
    displayBounds: latestLocalizationContext?.displayBounds ?? null,
  });
}

function stopVoiceReaderAudio() {
  if (!currentReaderAudio) return;
  currentReaderAudio.pause();
  currentReaderAudio.currentTime = 0;
  currentReaderAudio = null;
}

function playBrowserSpeech(text) {
  if (!("speechSynthesis" in window)) return;

  stopVoiceReaderAudio();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

async function speakExplanation(text) {
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

    currentReaderAudio = new Audio(
      `data:${audio.mimeType || "audio/mpeg"};base64,${audio.base64}`
    );
    currentReaderAudio.onended = () => {
      currentReaderAudio = null;
    };
    await currentReaderAudio.play();
  } catch (error) {
    console.warn("ElevenLabs chat reader failed:", error);
    playBrowserSpeech(cleanText);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForCompleteClick() {
  return new Promise((resolve, reject) => {
    if (promptLoopCancelled) {
      reject(new PromptCancelledError());
      return;
    }

    const cleanup = () => {
      unsubComplete?.();
      unsubCancel?.();
      resolvePromptWait = null;
    };

    const unsubComplete = window.aiTools?.onCompleteClicked(() => {
      cleanup();
      resolve();
    });

    const unsubCancel = window.aiTools?.onPromptCancelled(() => {
      promptLoopCancelled = true;
      window.aiTools?.hideNextButton?.();
      cleanup();
      reject(new PromptCancelledError());
    });

    resolvePromptWait = () => {
      cleanup();
      reject(new PromptCancelledError());
    };
  });
}

function waitForNextClick() {
  return new Promise((resolve, reject) => {
    if (promptLoopCancelled) {
      reject(new PromptCancelledError());
      return;
    }

    const cleanup = () => {
      unsubNext?.();
      unsubCancel?.();
      resolvePromptWait = null;
    };

    const unsubNext = window.aiTools?.onNextClicked(() => {
      cleanup();
      resolve();
    });

    const unsubCancel = window.aiTools?.onPromptCancelled(() => {
      promptLoopCancelled = true;
      window.aiTools?.hideNextButton?.();
      cleanup();
      reject(new PromptCancelledError());
    });

    resolvePromptWait = () => {
      cleanup();
      reject(new PromptCancelledError());
    };
  });
}

const MAX_HYBRID_STEPS = 10;
const CROP_MARGIN_CSS = 300;
const NEXT_STEP_CLICK_RADIUS = 10;

async function cropBase64Image(base64, cxCSS, cyCSS) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      const dpr = window.devicePixelRatio || 1;
      const scaleX = imgW / (window.screen.width * dpr);
      const scaleY = imgH / (window.screen.height * dpr);

      const imgCx = Math.round(cxCSS * dpr * scaleX);
      const imgCy = Math.round(cyCSS * dpr * scaleY);
      const imgMarginX = Math.round(CROP_MARGIN_CSS * dpr * scaleX);
      const imgMarginY = Math.round(CROP_MARGIN_CSS * dpr * scaleY);

      const x1 = Math.max(0, imgCx - imgMarginX);
      const y1 = Math.max(0, imgCy - imgMarginY);
      const x2 = Math.min(imgW, imgCx + imgMarginX);
      const y2 = Math.min(imgH, imgCy + imgMarginY);
      const cropW = x2 - x1;
      const cropH = y2 - y1;

      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, x1, y1, cropW, cropH, 0, 0, cropW, cropH);

      resolve({
        croppedBase64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1],
        x1, y1, cropW, cropH, imgW, imgH, dpr, scaleX, scaleY,
      });
    };
    img.onerror = () => reject(new Error("Failed to load screenshot for cropping."));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

async function refineStepCoordinates(step) {
  if (!window.geminiChat?.refine) return step;

  const base64 = await captureScreenBase64();
  if (!base64) return step;

  try {
    const isHighlight = step.action === "highlight";
    const anchor = step.markBBox || (isHighlight
      ? { x: step.x, y: step.y, w: step.w || 1, h: step.h || 1 }
      : { x: step.x, y: step.y, w: step.w || 1, h: step.h || 1 });
    const targetText = extractTargetText(step.description || step.label || "");
    const crop = await cropBase64Image(base64, anchor);
    let refined = null;
    let refineMethod = "gemini";

    if (window.localization?.ocrCrop) {
      const ocr = await window.localization.ocrCrop({
        croppedBase64: crop.croppedBase64,
        targetText,
      });

      if (ocr?.fastPath && Number.isFinite(ocr.fastPath.x) && Number.isFinite(ocr.fastPath.y)) {
        refined = ocr.fastPath;
        refineMethod = "ocr";
      } else {
        step.ocrCandidates = Array.isArray(ocr?.candidates) ? ocr.candidates : [];
      }
    }

    if (!refined && window.localization?.microGridRefine) {
      const gridded = await applyMicroGridToCrop(
        crop.croppedBase64,
        crop.cropW,
        crop.cropH
      );
      const micro = await window.localization.microGridRefine({
        griddedBase64: gridded.base64,
        cropW: gridded.cropW,
        cropH: gridded.cropH,
        targetElement: targetText || step.description || step.label || "target element",
        columns: gridded.columns,
        rows: gridded.rows,
      });

      if (micro && Number.isFinite(micro.x) && Number.isFinite(micro.y)) {
        refined = micro;
        refineMethod = micro.method || "ollama-micro-grid";
      }
    }

    if (!refined) {
      refined = await window.geminiChat.refine({
        description: step.description || step.label || "",
        targetText,
        croppedBase64: crop.croppedBase64,
        cropW: crop.cropW,
        cropH: crop.cropH,
        markBBox: crop.markBBox,
        ocrCandidates: step.ocrCandidates ?? [],
      });
    }

    if (!refined || !Number.isFinite(refined.x) || !Number.isFinite(refined.y)) return step;

    const refinedX = Math.round((crop.x1 + refined.x) / (crop.dpr * crop.scaleX));
    const refinedY = Math.round((crop.y1 + refined.y) / (crop.dpr * crop.scaleY));
    logLocalization({ coarseMethod: step.coarseMethod, refineMethod });

    if (isHighlight) {
      return {
        ...step,
        x: Math.round(refinedX - (step.w || 0) / 2),
        y: Math.round(refinedY - (step.h || 0) / 2),
      };
    }

    return { ...step, x: refinedX, y: refinedY };
  } catch {
    logLocalization({ coarseMethod: step.coarseMethod, refineMethod: "skipped" });
    return step;
  }
}

async function executeSingleStep(step, stepMeta) {
  const pointerText = step.description || step.label;

  if (step.action === "cursor") {
    await window.aiTools.moveCursor({
      x: step.x,
      y: step.y,
      description: pointerText,
      label: pointerText,
      animate: true,
      duration: 350,
      ...stepMeta,
    });
    return;
  }

  if (step.action === "highlight") {
    const centerX = step.x + Math.round(step.w / 2);
    const centerY = step.y + Math.round(step.h / 2);

    await window.aiTools.moveCursor({
      x: centerX,
      y: centerY,
      description: pointerText,
      label: pointerText,
      animate: true,
      duration: 350,
      ...stepMeta,
    });
    await window.aiTools.clearHighlights();
    await window.aiTools.highlightRect({
      x: step.x,
      y: step.y,
      width: step.w,
      height: step.h,
    });
  }
}

function getStepClickTarget(step) {
  if (step?.action === "highlight") {
    return {
      x: step.x + Math.round((step.w || 0) / 2),
      y: step.y + Math.round((step.h || 0) / 2),
    };
  }

  return {
    x: step?.x,
    y: step?.y,
  };
}

async function executeHybridLoop(goal, firstStep) {
  if (!firstStep || !window.aiTools) return;

  beginPromptLoop();

  await window.aiTools.ensureOverlay?.();
  await window.aiTools.setCursorVisible(true);
  await window.aiTools.clearHighlights();

  let currentStep = firstStep;
  let currentLocalizationContext = initialLocalizationContext;
  let stepNumber = 1;

  try {
    while (currentStep && stepNumber <= MAX_HYBRID_STEPS && !promptLoopCancelled) {
      const resolvedStep = resolveStepMark(currentStep, currentLocalizationContext);
      if (!resolvedStep) {
        logLocalization({ coarseMethod: "unresolved", refineMethod: "skipped" });
        break;
      }
      const refinedStep = await refineStepCoordinates(resolvedStep);
      await executeSingleStep(refinedStep, { stepIndex: stepNumber });
      if (promptLoopCancelled) break;

      const isLastStep = Boolean(currentStep.isFinal);

      if (isLastStep) {
        await window.aiTools.showCompleteButton();

        try {
          await waitForCompleteClick();
        } catch (error) {
          if (error instanceof PromptCancelledError) break;
          throw error;
        }

        break;
      }

      await window.aiTools.showNextButton({
        ...getStepClickTarget(refinedStep),
        radius: NEXT_STEP_CLICK_RADIUS,
      });

      try {
        await waitForNextClick();
      } catch (error) {
        if (error instanceof PromptCancelledError) break;
        throw error;
      }

      if (promptLoopCancelled) break;
      await delay(600);

      const screenContext = await captureScreenContext({ annotate: true });
      currentLocalizationContext = screenContext;
      const response = await window.geminiChat.step({
        goal,
        lastAction: currentStep.description || currentStep.label || "",
        screenshotBase64: screenContext?.screenshotBase64 ?? null,
        marks: screenContext?.marks ?? [],
        displayBounds: screenContext?.displayBounds ?? null,
      });

      const nextPlan = Array.isArray(response?.plan) ? response.plan : [];
      currentStep = nextPlan[0] ?? null;
      stepNumber += 1;

      if (!currentStep) {
        await window.aiTools.showCompleteButton();

        try {
          await waitForCompleteClick();
        } catch (error) {
          if (error instanceof PromptCancelledError) break;
          throw error;
        }

        break;
      }
    }
  } finally {
    resetPromptLoopState();
    await window.aiTools.hideNextButton();
    await window.aiTools.clearHighlights();
    await delay(600);
    await window.aiTools.setCursorVisible(false);
  }
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

    const firstStep = plan[0] ?? null;
    await executeHybridLoop(text, firstStep, latestLocalizationContext);

    const retrieval = response?.retrieval;
    const sourceNote =
      retrieval?.sources?.length
        ? `\n\n*Sources: ${retrieval.sources.join(", ")}*`
        : "";

    return {
      text: explanation + sourceNote,
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
      await window.aiTools.highlightRect({ x, y, width, height });
      return "Added highlight.";
    }
  }

  if (command === "/clear") {
    await window.aiTools.clearHighlights();
    return "Cleared highlights.";
  }

  if (command === "/cancel") {
    if (cancelPrompt()) {
      return "Cancelled guided prompt.";
    }
    return "No active prompt to cancel.";
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

function initChatResizeGrip() {
  const grip = document.getElementById("chat-resize-grip");
  if (!grip || !window.chatWindow?.resizeTo) return;

  let dragState = null;
  let pendingFrame = null;

  const resizeFromPointer = (event) => {
    if (!dragState) return;

    const width = dragState.width + event.screenX - dragState.screenX;
    const height = dragState.height + event.screenY - dragState.screenY;

    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      window.chatWindow.resizeTo(width, height);
      pendingFrame = null;
    });
  };

  const stopResize = () => {
    dragState = null;
    document.body.classList.remove("chat-window-resizing");
    window.removeEventListener("pointermove", resizeFromPointer);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };

  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragState = {
      screenX: event.screenX,
      screenY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    document.body.classList.add("chat-window-resizing");
    window.addEventListener("pointermove", resizeFromPointer);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });
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

  newChatButton = document.getElementById("new-chat-button");

  initChatResizeGrip();
  void bootstrapChat(messagesEl, typingIndicator);

  chatInput.addEventListener("mousedown", () => {
    chatInput.focus();
  });

  closeButton?.addEventListener("click", hideChatWindow);
  minimizeButton?.addEventListener("click", minimizeChatWindow);

  newChatButton?.addEventListener("click", () => {
    if (isAiBusy || promptLoopActive) return;
    void startNewChat(messagesEl, typingIndicator);
  });

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

    const userMessage = createMessage({ text, sender: "user", attachments });
    messages.push(userMessage);
    renderMessages(messagesEl, typingIndicator);
    saveChatMessage(userMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    isAiBusy = true;
    updateNewChatButtonState();

    let aiReply;
    try {
      aiReply = await handleAiCommand(text);
    } finally {
      isAiBusy = false;
      updateNewChatButtonState();
    }

    hideTypingIndicator(typingIndicator);

    if (aiReply?.text) {
      const assistantMessage = createMessage({
        text: aiReply.text,
        sender: "system",
        plan: aiReply.plan,
        rawResponse: aiReply.rawResponse,
      });
      messages.push(assistantMessage);
      renderMessages(messagesEl, typingIndicator);
      saveChatMessage(assistantMessage);
    }

    chatInput.focus();
  });

  micButton.addEventListener("click", async () => {
    try {
      if (mediaRecorder) {
        await stopMicRecording(messagesEl, typingIndicator, chatInput, micButton);
      } else {
        await startMicRecording(messagesEl, typingIndicator, chatInput, micButton);
      }
    } catch (error) {
      setMicButtonState(micButton, "idle");
      pushSystemMessage(messagesEl, typingIndicator, `Microphone error: ${error.message}`);
    }
  });
}
