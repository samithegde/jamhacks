import {
  CHAT_CONVERSATION_STORAGE_KEY,
  DEFAULT_WELCOME_MESSAGE,
} from "./constants.js";
import {
  conversationId,
  isAiBusy,
  messages,
  newChatButton,
  promptLoopActive,
  setConversationId,
} from "./state.js";
import { cancelPrompt } from "./prompt-loop.js";
import { renderMessages } from "./render.js";

export function getConversationId() {
  if (conversationId) return conversationId;

  const stored = localStorage.getItem(CHAT_CONVERSATION_STORAGE_KEY);
  if (stored) {
    setConversationId(stored);
    return stored;
  }

  const id = crypto.randomUUID();
  setConversationId(id);
  localStorage.setItem(CHAT_CONVERSATION_STORAGE_KEY, id);
  return id;
}

export function resetConversationId() {
  const id = crypto.randomUUID();
  setConversationId(id);
  localStorage.setItem(CHAT_CONVERSATION_STORAGE_KEY, id);
  return id;
}

export function createMessage(message) {
  return {
    id: crypto.randomUUID(),
    time: new Date(),
    ...message,
  };
}

export function hydrateStoredMessage(message = {}) {
  return {
    ...message,
    time: message.time ? new Date(message.time) : new Date(),
  };
}

export function getPersistableMessage(message) {
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

export async function loadChatHistory() {
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

export async function saveChatMessage(message) {
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

export async function bootstrapChat(messagesEl, typingIndicator) {
  updateSyncStatus("checking");

  const loaded = await loadChatHistory();
  if (!loaded) {
    messages.splice(0, messages.length, { ...DEFAULT_WELCOME_MESSAGE });
  }

  renderMessages(messagesEl, typingIndicator);
  await refreshSyncStatus();
}

export async function startNewChat(messagesEl, typingIndicator) {
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

export function updateSyncStatus(state) {
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

export async function refreshSyncStatus() {
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

export function setNewChatButtonDisabled(disabled) {
  if (!newChatButton) return;
  newChatButton.disabled = disabled;
}

export function updateNewChatButtonState() {
  setNewChatButtonDisabled(isAiBusy || promptLoopActive);
}

export function pushSystemMessage(messagesEl, typingIndicator, text) {
  const message = createMessage({ text, sender: "system" });
  messages.push(message);
  renderMessages(messagesEl, typingIndicator);
  saveChatMessage(message);
}
