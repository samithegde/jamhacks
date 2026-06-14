import { initChatAccessibility } from "./modules/chat-accessibility.js";
import { initChat } from "./modules/chat.js";
import { initCaptureServices } from "./modules/capture-service.js";
import { playGenieOpen } from "./modules/genie.js";

initChatAccessibility();
initCaptureServices();
initChat();

// Animate open on every show (first load + every time the window is un-hidden)
playGenieOpen();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") playGenieOpen();
});
