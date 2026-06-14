import { MAX_ATTACHMENTS, MAX_FILE_SIZE } from "./constants.js";
import {
  captureScreenAttachment,
  clearPendingAttachments,
  fileToAttachment,
  formatFileSize,
  removePendingAttachment,
  renderAttachmentPreview,
} from "./attachments.js";
import { handleAiCommand } from "./ai-command.js";
import {
  bootstrapChat,
  createMessage,
  pushSystemMessage,
  saveChatMessage,
  startNewChat,
  updateNewChatButtonState,
} from "./history.js";
import {
  hideTypingIndicator,
  renderMessages,
  showTypingIndicator,
} from "./render.js";
import {
  isAiBusy,
  mediaRecorder,
  messages,
  pendingAttachments,
  promptLoopActive,
  setIsAiBusy,
  setNewChatButton,
} from "./state.js";
import {
  setMicButtonState,
  startMicRecording,
  stopMicRecording,
} from "./voice.js";
import {
  hideChatWindow,
  initChatResizeGrip,
  minimizeChatWindow,
} from "./window-chrome.js";

export { cancelPrompt } from "./prompt-loop.js";

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

  setNewChatButton(document.getElementById("new-chat-button"));

  initChatResizeGrip();
  void bootstrapChat(messagesEl, typingIndicator);

  chatInput.addEventListener("mousedown", () => {
    chatInput.focus();
  });

  closeButton?.addEventListener("click", hideChatWindow);
  minimizeButton?.addEventListener("click", minimizeChatWindow);

  document.getElementById("new-chat-button")?.addEventListener("click", () => {
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

    setIsAiBusy(true);
    updateNewChatButtonState();

    let aiReply;
    try {
      aiReply = await handleAiCommand(text);
    } finally {
      setIsAiBusy(false);
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
