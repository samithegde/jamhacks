import { marked } from "../vendor/marked.esm.js";
import DOMPurify from "../vendor/purify.es.mjs";
import { MERMAID_FENCE_RE, normalizeDiagramCode } from "./mermaid-normalize.js";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "b", "i", "u", "s", "del",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre", "code", "hr",
  "a", "span", "div",
];

const ALLOWED_ATTR = [
  "href", "title", "target", "rel", "class",
  "data-mermaid-encoded", "data-processed",
];

const MERMAID_DIAGRAM_START =
  /^(?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR)\b/im;

const MARKED_MERMAID_CODE =
  /<pre><code(?:\s+class="language-mermaid")?>([\s\S]*?)<\/code><\/pre>/gi;

const MARKED_INLINE_MERMAID =
  /<p>\s*<code>(mermaid(?:\s+(?:graph|flowchart)\b[\s\S]*?))<\/code>\s*<\/p>/gi;

if (typeof DOMPurify.addHook === "function") {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

function encodeMermaidSource(code) {
  return btoa(unescape(encodeURIComponent(String(code ?? ""))));
}

function decodeMermaidSource(encoded) {
  return decodeURIComponent(escape(atob(String(encoded ?? ""))));
}

function mermaidPlaceholder(index) {
  return `%%MERMAID_BLOCK_${index}%%`;
}

export function normalizeMermaidInText(text) {
  let result = String(text ?? "").trim();
  if (!result) return result;

  result = result.replace(
    /```(?!mermaid)(\w*)\s*\n((?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR)\b[\s\S]*?)```/gi,
    (_match, _lang, diagram) => `\`\`\`mermaid\n${diagram.trim()}\n\`\`\``,
  );

  if (!/```\s*mermaid\b/i.test(result) && MERMAID_DIAGRAM_START.test(result)) {
    result = result.replace(
      /(^|[\n\r])((?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR)\b[\s\S]*)$/i,
      (_match, prefix, diagram) => {
        const lead = prefix && String(prefix).trim() ? `${prefix}\n\n` : "";
        return `${lead}\`\`\`mermaid\n${diagram.trim()}\n\`\`\``;
      },
    );
  }

  return result;
}

function decodeHtmlEntities(html) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(html ?? "");
  return textarea.value;
}

function buildMermaidDiv(code) {
  const normalized = normalizeDiagramCode(code);
  if (!normalized) return "";
  return `<div class="mermaid" data-mermaid-encoded="${encodeMermaidSource(normalized)}"></div>`;
}

function extractMermaidToPlaceholders(text) {
  const blocks = [];
  const processed = text.replace(MERMAID_FENCE_RE, (_match, code) => {
    const token = mermaidPlaceholder(blocks.length);
    blocks.push(normalizeDiagramCode(code));
    return `\n\n${token}\n\n`;
  });

  return { text: processed, blocks };
}

function recoverMermaidFromMarkedHtml(html) {
  let result = html.replace(MARKED_MERMAID_CODE, (_match, code) =>
    buildMermaidDiv(decodeHtmlEntities(code)),
  );

  result = result.replace(MARKED_INLINE_MERMAID, (_match, code) =>
    buildMermaidDiv(decodeHtmlEntities(code)),
  );

  return result;
}

function injectMermaidPlaceholders(html, blocks) {
  let result = html;

  blocks.forEach((code, index) => {
    const token = mermaidPlaceholder(index);
    const div = buildMermaidDiv(code);
    const wrapped = new RegExp(`<p>\\s*${token}\\s*</p>`, "g");
    result = result.replace(wrapped, div);
    result = result.replaceAll(token, div);
  });

  return result;
}

export function stripFencedCodeForSpeech(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderMarkdown(text) {
  if (!text) return "";

  const normalized = normalizeMermaidInText(text);
  const { text: withPlaceholders, blocks } = extractMermaidToPlaceholders(normalized);
  const html = marked.parse(withPlaceholders);
  const recovered = recoverMermaidFromMarkedHtml(html);
  const withDiagrams = injectMermaidPlaceholders(recovered, blocks);
  const sanitized = DOMPurify.sanitize(withDiagrams, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });

  return `<div class="message-markdown">${sanitized}</div>`;
}

let mermaidModule = null;
let mermaidReady = false;

async function loadMermaid() {
  if (!mermaidModule) {
    mermaidModule = await import("../vendor/mermaid/mermaid.core.mjs");
  }
  return mermaidModule.default ?? mermaidModule;
}

async function ensureMermaid() {
  if (mermaidReady) return loadMermaid();

  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    fontFamily: "Inter, sans-serif",
  });
  mermaidReady = true;
  return mermaid;
}

export function prepareMermaidNode(node, code) {
  if (!node) return;
  const normalized = normalizeDiagramCode(code);
  if (!normalized) return;
  node.textContent = "";
  node.removeAttribute("data-processed");
  node.setAttribute("data-mermaid-encoded", encodeMermaidSource(normalized));
}

export async function enhanceMermaidDiagrams(containerEl) {
  if (!containerEl) return;

  const nodes = containerEl.querySelectorAll(".mermaid:not([data-processed])");
  if (!nodes.length) return;

  for (const node of nodes) {
    const encoded = node.getAttribute("data-mermaid-encoded");
    if (encoded) {
      try {
        node.textContent = decodeMermaidSource(encoded);
        node.removeAttribute("data-mermaid-encoded");
      } catch {
        node.textContent = "Diagram could not be loaded.";
        node.setAttribute("data-processed", "error");
      }
    }
  }

  const pending = containerEl.querySelectorAll(".mermaid:not([data-processed])");
  if (!pending.length) return;

  try {
    const mermaid = await ensureMermaid();
    await mermaid.run({ nodes: Array.from(pending) });
    pending.forEach((node) => node.setAttribute("data-processed", "true"));
  } catch (error) {
    console.warn("[mermaid] render failed:", error);
    pending.forEach((node) => {
      if (!node.getAttribute("data-processed")) {
        const source = node.textContent?.trim();
        node.innerHTML = source
          ? `<pre class="mermaid-fallback"><code>${source.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</code></pre>`
          : "Diagram could not be rendered.";
        node.setAttribute("data-processed", "error");
      }
    });
  }
}
