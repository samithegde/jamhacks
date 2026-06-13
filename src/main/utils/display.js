const { screen } = require("electron");

function unionBounds(getArea) {
  const displays = screen.getAllDisplays();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const display of displays) {
    const area = getArea(display);
    minX = Math.min(minX, area.x);
    minY = Math.min(minY, area.y);
    maxX = Math.max(maxX, area.x + area.width);
    maxY = Math.max(maxY, area.y + area.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getWorkAreaBounds() {
  return unionBounds((display) => display.workArea);
}

module.exports = {
  getWorkAreaBounds,
};
