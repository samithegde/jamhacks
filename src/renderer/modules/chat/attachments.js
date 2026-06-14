import { getCaptureServices } from "../capture-service.js";
import {
  INLINE_MIME_PREFIXES,
  INLINE_MIME_TYPES,
  TEXT_EXTENSIONS,
} from "./constants.js";
import {
  pendingAttachments,
  setLatestScreenContext,
  setPendingAttachments,
} from "./state.js";
import { escapeHtml } from "./render.js";

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileExtension(name = "") {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export function resolveMimeType(file) {
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

export function isTextAttachment(mimeType, name) {
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json" || mimeType === "application/javascript") return true;
  if (mimeType === "application/xml" || mimeType === "application/yaml") return true;
  return TEXT_EXTENSIONS.has(getFileExtension(name));
}

export function isInlineAttachment(mimeType) {
  if (INLINE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return true;
  return INLINE_MIME_TYPES.has(mimeType);
}

export function getAttachmentIcon(mimeType) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio_file";
  if (mimeType.startsWith("video/")) return "movie";
  if (mimeType === "application/pdf") return "picture_as_pdf";
  return "description";
}

export function readFileAsBase64(file) {
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

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

export async function fileToAttachment(file) {
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

export function renderAttachmentChip(attachment, { removable = false } = {}) {
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

export function renderMessageAttachments(attachments = []) {
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

export function renderAttachmentPreview(previewEl) {
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

export function clearPendingAttachments() {
  for (const attachment of pendingAttachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
  setPendingAttachments([]);
}

export function removePendingAttachment(id) {
  const index = pendingAttachments.findIndex((attachment) => attachment.id === id);
  if (index === -1) return;

  const [removed] = pendingAttachments.splice(index, 1);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
}

export function dataUrlToBase64(dataUrl) {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function screenFrameToAttachment(frame) {
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

export async function captureScreenAttachment() {
  try {
    const context = await captureScreenContext();
    if (!context?.screenshotBase64) return null;

    return {
      id: crypto.randomUUID(),
      name: "Screen",
      mimeType: "image/jpeg",
      size: Math.ceil(context.screenshotBase64.length * 0.75),
      base64: context.screenshotBase64,
      contextOnly: true,
    };
  } catch {
    return null;
  }
}

export async function captureScreenBase64() {
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

export async function captureScreenContext() {
  const rawBase64 = await captureScreenBase64();
  if (!rawBase64) return null;

  const context = {
    rawBase64,
    screenshotBase64: rawBase64,
    imageMeta: {
      dpr: window.devicePixelRatio || 1,
      width: window.screen.width,
      height: window.screen.height,
    },
  };

  setLatestScreenContext(context);
  return context;
}
