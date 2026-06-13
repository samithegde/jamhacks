import { marked } from "../vendor/marked.esm.js";
import DOMPurify from "../vendor/purify.es.mjs";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "b", "i", "u", "s", "del",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre", "code", "hr",
  "a", "span",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel", "class"];

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(text) {
  if (!text) return "";

  const html = marked.parse(String(text));
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });

  return `<div class="message-markdown">${sanitized}</div>`;
}
