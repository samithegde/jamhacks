const { screen } = require("electron");
const {
  getDashboardWindow,
  showDashboardWindow,
  notifyDashboard,
  showOverlay,
  hideOverlay,
  getOverlayWindows,
  showChatWindow,
  getChatWindow,
  minimizeDashboard,
  closeDashboard,
} = require("../window");
const { app } = require("electron");

let overlayVisible = false;

function registerDashboardIpc(ipcMain) {
  ipcMain.handle("show-dashboard", () => {
    showDashboardWindow();
    return { ok: true };
  });

  ipcMain.handle("get-overlay-status", () => {
    const wins = getOverlayWindows();
    const activeWins = wins.filter((w) => w && !w.isDestroyed() && w.isVisible());
    overlayVisible = activeWins.length > 0;
    return { active: overlayVisible };
  });

  ipcMain.handle("show-overlay", () => {
    showOverlay();
    overlayVisible = true;
    notifyDashboard("overlay-state-changed", { active: true });
    return { ok: true };
  });

  ipcMain.handle("hide-overlay", () => {
    hideOverlay();
    overlayVisible = false;
    notifyDashboard("overlay-state-changed", { active: false });
    return { ok: true };
  });

  ipcMain.handle("show-chat", () => {
    showChatWindow();
    return { ok: true };
  });

  ipcMain.handle("quit-app", () => {
    app.quit();
    return { ok: true };
  });

  ipcMain.handle("get-displays", () => {
    return screen.getAllDisplays().map((display) => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
    }));
  });

  ipcMain.handle("minimize-window", () => {
    minimizeDashboard();
    return { ok: true };
  });

  ipcMain.handle("close-window", () => {
    closeDashboard();
    return { ok: true };
  });
}

module.exports = { registerDashboardIpc };
