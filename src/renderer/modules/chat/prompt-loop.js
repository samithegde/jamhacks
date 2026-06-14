import {
  promptLoopActive,
  promptLoopCancelled,
  resolvePromptWait,
  PromptCancelledError,
  setPromptLoopActive,
  setPromptLoopCancelled,
  setResolvePromptWait,
} from "./state.js";
import { updateNewChatButtonState } from "./history.js";

export function cancelPrompt() {
  if (!promptLoopActive) return false;

  setPromptLoopCancelled(true);
  window.aiTools?.hideNextButton?.();
  resolvePromptWait?.();
  return true;
}

export function beginPromptLoop() {
  setPromptLoopActive(true);
  setPromptLoopCancelled(false);
  setResolvePromptWait(null);
  updateNewChatButtonState();
}

export function resetPromptLoopState() {
  setPromptLoopActive(false);
  setPromptLoopCancelled(false);
  setResolvePromptWait(null);
  updateNewChatButtonState();
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForCompleteClick() {
  return new Promise((resolve, reject) => {
    if (promptLoopCancelled) {
      reject(new PromptCancelledError());
      return;
    }

    const cleanup = () => {
      unsubComplete?.();
      unsubCancel?.();
      setResolvePromptWait(null);
    };

    const unsubComplete = window.aiTools?.onCompleteClicked(() => {
      cleanup();
      resolve();
    });

    const unsubCancel = window.aiTools?.onPromptCancelled(() => {
      setPromptLoopCancelled(true);
      window.aiTools?.hideNextButton?.();
      cleanup();
      reject(new PromptCancelledError());
    });

    setResolvePromptWait(() => {
      cleanup();
      reject(new PromptCancelledError());
    });
  });
}

export function waitForNextClick() {
  return new Promise((resolve, reject) => {
    if (promptLoopCancelled) {
      reject(new PromptCancelledError());
      return;
    }

    const cleanup = () => {
      unsubNext?.();
      unsubCancel?.();
      setResolvePromptWait(null);
    };

    const unsubNext = window.aiTools?.onNextClicked(() => {
      cleanup();
      resolve();
    });

    const unsubCancel = window.aiTools?.onPromptCancelled(() => {
      setPromptLoopCancelled(true);
      window.aiTools?.hideNextButton?.();
      cleanup();
      reject(new PromptCancelledError());
    });

    setResolvePromptWait(() => {
      cleanup();
      reject(new PromptCancelledError());
    });
  });
}
