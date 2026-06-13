const { desktopCapturer } = require("electron");

function serializeDesktopCapturerSource(source) {
  return {
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
    thumbnail: source.thumbnail.toDataURL(),
  };
}

function pickScreenSourceByDisplayId(sources, displayId) {
  return (
    sources.find((source) => String(source.displayId) === String(displayId)) ??
    sources[0] ??
    null
  );
}

async function listScreenSources(options = {}) {
  const { types = ["screen"], thumbnailSize = { width: 320, height: 180 } } =
    options;

  const sources = await desktopCapturer.getSources({ types, thumbnailSize });

  return sources.map(serializeDesktopCapturerSource);
}

async function getScreenSourceByDisplayId(displayId) {
  const sources = await listScreenSources({ types: ["screen"] });
  return pickScreenSourceByDisplayId(sources, displayId);
}

module.exports = {
  listScreenSources,
  getScreenSourceByDisplayId,
  serializeDesktopCapturerSource,
  pickScreenSourceByDisplayId,
};
