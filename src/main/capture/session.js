const { session, desktopCapturer } = require("electron");

function configureCaptureSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });

  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "display-capture";
  });

  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => {
        callback({ video: sources[0] ?? null, audio: false });
      })
      .catch(() => {
        callback({});
      });
  });
}

module.exports = { configureCaptureSession };
