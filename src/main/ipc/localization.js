const { discoverMarks } = require("../ui-automation/mark-discovery");
const { getOcrCandidates } = require("../localization/ocr-boxes");
const { refineWithMicroGrid } = require("../localization/micro-grid-refine");

function isSomEnabled() {
  return process.env.SOM_ENABLED !== "false";
}

function registerLocalizationIpc(ipcMain) {
  ipcMain.handle("localization:som-enabled", () => isSomEnabled());

  ipcMain.handle("ui-marks:discover", async () => {
    if (!isSomEnabled()) {
      return { marks: [], displayBounds: null, enabled: false };
    }

    return {
      ...(await discoverMarks()),
      enabled: true,
    };
  });

  ipcMain.handle("localization:ocr-crop", async (_event, payload) => {
    const { croppedBase64, targetText } = payload ?? {};
    if (!croppedBase64) {
      return { candidates: [], fastPath: null };
    }

    return getOcrCandidates({ croppedBase64, targetText });
  });

  ipcMain.handle("localization:micro-grid-refine", async (_event, payload) => {
    const {
      griddedBase64,
      cropW,
      cropH,
      targetElement,
      columns,
      rows,
    } = payload ?? {};

    if (!griddedBase64) {
      return null;
    }

    try {
      return await refineWithMicroGrid({
        griddedBase64,
        cropW,
        cropH,
        targetElement,
        columns,
        rows,
      });
    } catch (error) {
      console.warn("[localization] micro-grid refine failed:", error.message);
      return null;
    }
  });
}

module.exports = {
  registerLocalizationIpc,
  isSomEnabled,
};
