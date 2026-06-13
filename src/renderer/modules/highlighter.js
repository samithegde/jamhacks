const DEFAULT_COLOR = "rgba(250, 204, 21, 0.35)";
const DEFAULT_BORDER = "rgba(250, 204, 21, 0.95)";
const DEFAULT_STROKE_WIDTH = 4;

export function initHighlighter() {
  const canvas = document.getElementById("highlighter-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const fadeTimers = new Map();
  let shapeId = 0;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function redraw(shapes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const shape of shapes) {
      drawShape(ctx, shape);
    }
  }

  const shapes = [];

  function addShape(shape) {
    const id = ++shapeId;
    const entry = { id, ...shape };
    shapes.push(entry);
    redraw(shapes);

    if (entry.duration && entry.duration > 0) {
      const timer = setTimeout(() => removeShape(id), entry.duration);
      fadeTimers.set(id, timer);
    }

    return id;
  }

  function removeShape(id) {
    const index = shapes.findIndex((shape) => shape.id === id);
    if (index === -1) return;

    shapes.splice(index, 1);
    redraw(shapes);

    const timer = fadeTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      fadeTimers.delete(id);
    }
  }

  function clearAll() {
    for (const timer of fadeTimers.values()) {
      clearTimeout(timer);
    }
    fadeTimers.clear();
    shapes.length = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  window.aiTools?.onHighlightRect((payload) => {
    addShape({
      type: "rect",
      x: payload.x,
      y: payload.y,
      width: payload.width,
      height: payload.height,
      fill: payload.fill ?? DEFAULT_COLOR,
      stroke: payload.stroke ?? DEFAULT_BORDER,
      lineWidth: payload.lineWidth ?? 3,
      duration: payload.duration ?? 5000,
    });
  });

  window.aiTools?.onHighlightCircle((payload) => {
    addShape({
      type: "circle",
      x: payload.x,
      y: payload.y,
      radius: payload.radius,
      fill: payload.fill ?? DEFAULT_COLOR,
      stroke: payload.stroke ?? DEFAULT_BORDER,
      lineWidth: payload.lineWidth ?? 3,
      duration: payload.duration ?? 5000,
    });
  });

  window.aiTools?.onHighlightStroke((payload) => {
    addShape({
      type: "stroke",
      points: payload.points ?? [],
      stroke: payload.stroke ?? DEFAULT_BORDER,
      lineWidth: payload.lineWidth ?? DEFAULT_STROKE_WIDTH,
      duration: payload.duration ?? 5000,
    });
  });

  window.aiTools?.onHighlightClear(() => clearAll());

  resizeCanvas();
  window.addEventListener("resize", () => {
    resizeCanvas();
    redraw(shapes);
  });
}

function drawShape(ctx, shape) {
  if (shape.type === "rect") {
    ctx.fillStyle = shape.fill;
    ctx.strokeStyle = shape.stroke;
    ctx.lineWidth = shape.lineWidth;
    ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
    return;
  }

  if (shape.type === "circle") {
    ctx.beginPath();
    ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
    ctx.fillStyle = shape.fill;
    ctx.strokeStyle = shape.stroke;
    ctx.lineWidth = shape.lineWidth;
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (shape.type === "stroke" && shape.points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let i = 1; i < shape.points.length; i += 1) {
      ctx.lineTo(shape.points[i].x, shape.points[i].y);
    }
    ctx.strokeStyle = shape.stroke;
    ctx.lineWidth = shape.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
}
