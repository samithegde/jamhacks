const { sendToRenderer } = require("../window");

const aiTools = {
  moveCursor(payload) {
    sendToRenderer("ai:cursor:move", payload);
  },

  setCursorVisible(visible) {
    sendToRenderer("ai:cursor:visibility", { visible: Boolean(visible) });
  },

  highlightRect(payload) {
    sendToRenderer("ai:highlighter:rect", payload);
  },

  highlightCircle(payload) {
    sendToRenderer("ai:highlighter:circle", payload);
  },

  highlightStroke(payload) {
    sendToRenderer("ai:highlighter:stroke", payload);
  },

  clearHighlights() {
    sendToRenderer("ai:highlighter:clear");
  },
};

module.exports = { aiTools };
