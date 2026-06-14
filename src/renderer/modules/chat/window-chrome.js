export function hideChatWindow() {
  window.chatWindow?.hide?.();
}

export function minimizeChatWindow() {
  window.chatWindow?.minimize?.();
}

export function initChatResizeGrip() {
  const grip = document.getElementById("chat-resize-grip");
  if (!grip || !window.chatWindow?.resizeTo) return;

  let dragState = null;
  let pendingFrame = null;

  const resizeFromPointer = (event) => {
    if (!dragState) return;

    const width = dragState.width + event.screenX - dragState.screenX;
    const height = dragState.height + event.screenY - dragState.screenY;

    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      window.chatWindow.resizeTo(width, height);
      pendingFrame = null;
    });
  };

  const stopResize = () => {
    dragState = null;
    document.body.classList.remove("chat-window-resizing");
    window.removeEventListener("pointermove", resizeFromPointer);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };

  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragState = {
      screenX: event.screenX,
      screenY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    document.body.classList.add("chat-window-resizing");
    window.addEventListener("pointermove", resizeFromPointer);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });
}
