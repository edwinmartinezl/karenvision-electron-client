const VIEWER_WINDOW_RADIUS_PX = 18;

function buildRoundedShapeRects(width, height, radius) {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  if (!w || !h) {
    return [];
  }
  const r = Math.max(0, Math.min(Math.floor(Number(radius) || 0), Math.floor(Math.min(w, h) / 2)));
  if (r <= 0) {
    return [{ x: 0, y: 0, width: w, height: h }];
  }

  const rects = [];
  for (let y = 0; y < h; y += 1) {
    let inset = 0;
    if (y < r) {
      const dy = r - y - 0.5;
      inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
    } else if (y >= h - r) {
      const dy = y - (h - r) + 0.5;
      inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
    }
    const rowWidth = w - inset * 2;
    if (rowWidth > 0) {
      rects.push({ x: inset, y, width: rowWidth, height: 1 });
    }
  }
  return rects;
}

function applyRoundedWindowShape(win, radius = VIEWER_WINDOW_RADIUS_PX) {
  return;
}

function applyViewerWindowShapeForState(win, radius = VIEWER_WINDOW_RADIUS_PX) {
  return;
}

module.exports = {
  VIEWER_WINDOW_RADIUS_PX,
  buildRoundedShapeRects,
  applyRoundedWindowShape,
  applyViewerWindowShapeForState
};
