import { renderMarkdown } from "../markdown.js";
import { messages } from "./state.js";
import { renderMessageAttachments } from "./attachments.js";

export function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatMessageTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function renderMessageMarkup(msg) {
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

export function renderMessages(messagesEl, typingIndicator) {
  messagesEl.innerHTML = messages.map((msg) => renderMessageMarkup(msg)).join("");
  messagesEl.appendChild(typingIndicator);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

export function showTypingIndicator(typingIndicator) {
  typingIndicator.classList.remove("hidden");
  typingIndicator.setAttribute("aria-hidden", "false");
}

export function hideTypingIndicator(typingIndicator) {
  typingIndicator.classList.add("hidden");
  typingIndicator.setAttribute("aria-hidden", "true");
}
