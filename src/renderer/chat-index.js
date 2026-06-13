import { initChatAccessibility } from "./modules/chat-accessibility.js";
import { initChat } from "./modules/chat.js";
import { initCaptureServices } from "./modules/capture-service.js";

initChatAccessibility();
initCaptureServices();
initChat();
