import { initChatAccessibility } from "./modules/chat-accessibility.js";
import { initChat } from "./modules/chat.js";
import { initCaptureServices } from "./modules/capture-service.js";
import { initAltTts } from "./modules/alt-tts.js";

initChatAccessibility();
initCaptureServices();
initChat();
initAltTts();
