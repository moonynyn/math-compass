(() => {
  const drawCanvas = document.getElementById('drawCanvas');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const container = document.getElementById('canvas-container');
  const ctx = drawCanvas.getContext('2d');
  const octx = overlayCanvas.getContext('2d');

  const colorPicker = document.getElementById('colorPicker');
  const widthPicker = document.getElementById('widthPicker');
  const widthValue = document.getElementById('widthValue');
  const hintText = document.getElementById('hintText');
  const undoBtn = document.getElementById('undoBtn');
  const clearBtn = document.getElementById('clearBtn');

  const PX_PER_CM = 32;

  let activeTool = 'pencil';
  let color = colorPicker.value;
  let strokeWidth = Number(widthPicker.value);

  const shapes = [];
  let currentPath = null;

  const ruler = { x: 0, y: 0, angle: 0, length: 20 * PX_PER_CM, width: 2.6 * PX_PER_CM, placed: false };
  const protractor = { x: 0, y: 0, angle: 0, radius: 7 * PX_PER_CM, placed: false };

  const drag = { mode: null, tool: null };

  const hints = {
    pencil: 'Pencil selected — draw freely on the canvas.',
    eraser: 'Eraser selected — drag over strokes to remove them.',
    line: 'Line tool — click and drag to draw a straight segment.',
    ruler: 'Ruler — drag the body to move it, the round handle to rotate it, and drag along an edge to draw a snapped line.',
    protractor: 'Protractor — drag the body to move it, the handle to rotate it, then drag from the center point to draw a ray and read the angle.',
    compass: 'Compass — click the center, drag out to set the radius. Sweep sideways to draw an arc, or release without sweeping for a full circle.'
  };

  function setHint(tool) {
    hintText.textContent = hints[tool] || '';
  }

  function resizeCanvases() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    [drawCanvas, overlayCanvas].forEach(c => {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!ruler.placed) {
      ruler.x = rect.width / 2;
      ruler.y = rect.height / 2;
      ruler.placed = true;
    }
    if (!protractor.placed) {
      protractor.x = rect.width / 2;
      protractor.y = rect.height / 2 + 60;
      protractor.placed = true;
    }
    renderMain();
    renderOverlay();
  }

  function getCanvasSize() {
    const rect = container.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  // ---------- shape rendering ----------

  function strokeShape(context, shape) {
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.lineWidth = shape.width;
    if (shape.erase) {
      context.globalCompositeOperation = 'destination-out';
      context.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      context.globalCompositeOperation = 'source-over';
      context.strokeStyle = shape.color;
    }

    context.beginPath();
    if (shape.type === 'path') {
      const pts = shape.points;
      if (pts.length === 1) {
        context.arc(pts[0][0], pts[0][1], shape.width / 2, 0, Math.PI * 2);
        context.fillStyle = shape.erase ? 'rgba(0,0,0,1)' : shape.color;
        context.fill();
      } else {
        context.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) context.lineTo(pts[i][0], pts[i][1]);
        context.stroke();
      }
    } else if (shape.type === 'line') {
      context.moveTo(shape.x1, shape.y1);
      context.lineTo(shape.x2, shape.y2);
      context.stroke();
    } else if (shape.type === 'circle') {
      context.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      context.stroke();
    } else if (shape.type === 'arc') {
      context.arc(shape.cx, shape.cy, shape.r, shape.start, shape.end, shape.anticlockwise);
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
  }

  function renderMain() {
    const { w, h } = getCanvasSize();
    ctx.clearRect(0, 0, w, h);
    for (const shape of shapes) strokeShape(ctx, shape);
    if (currentPath) strokeShape(ctx, currentPath);
  }

  // ---------- geometry helpers ----------

  function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

  function toLocal(px, py, cx, cy, angle) {
    const dx = px - cx, dy = py - cy;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }

  function toWorld(lx, ly, cx, cy, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  }

  function polarFromBaseline(cx, cy, angle, r, degFromBaseline) {
    const rad = (degFromBaseline * Math.PI) / 180;
    const lx = r * Math.cos(rad);
    const ly = -r * Math.sin(rad);
    return toWorld(lx, ly, cx, cy, angle);
  }

  // ---------- ruler ----------

  function rulerHandlePos() {
    return toWorld(ruler.length / 2 + 22, 0, ruler.x, ruler.y, ruler.angle);
  }

  function drawRuler() {
    const { x, y, angle, length, width } = ruler;
    octx.save();
    octx.translate(x, y);
    octx.rotate(angle);

    octx.fillStyle = 'rgba(255, 244, 214, 0.88)';
    octx.strokeStyle = '#b8860b';
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.rect(-length / 2, -width / 2, length, width);
    octx.fill();
    octx.stroke();

    octx.fillStyle = '#7a5c00';
    octx.strokeStyle = '#7a5c00';
    octx.font = '11px sans-serif';
    octx.textAlign = 'center';
    const cmCount = Math.floor(length / PX_PER_CM);
    for (let cm = 0; cm <= cmCount; cm++) {
      const lx = -length / 2 + cm * PX_PER_CM;
      const isMajor = cm % 5 === 0;
      const tickLen = isMajor ? 14 : 9;
      octx.lineWidth = isMajor ? 1.5 : 1;
      octx.beginPath();
      octx.moveTo(lx, -width / 2);
      octx.lineTo(lx, -width / 2 + tickLen);
      octx.moveTo(lx, width / 2);
      octx.lineTo(lx, width / 2 - tickLen);
      octx.stroke();
      if (isMajor) octx.fillText(String(cm), lx, -width / 2 + tickLen + 12);
      if (cm < cmCount) {
        const midX = lx + PX_PER_CM / 2;
        octx.lineWidth = 0.75;
        octx.beginPath();
        octx.moveTo(midX, -width / 2);
        octx.lineTo(midX, -width / 2 + 6);
        octx.moveTo(midX, width / 2);
        octx.lineTo(midX, width / 2 - 6);
        octx.stroke();
      }
    }
    octx.restore();

    const handle = rulerHandlePos();
    octx.beginPath();
    octx.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
    octx.fillStyle = '#2563eb';
    octx.fill();
    octx.strokeStyle = '#fff';
    octx.lineWidth = 2;
    octx.stroke();
  }

  function hitTestRuler(px, py) {
    const local = toLocal(px, py, ruler.x, ruler.y, ruler.angle);
    const handle = rulerHandlePos();
    if (dist(px, py, handle.x, handle.y) < 12) return { mode: 'rotate-ruler' };

    const halfW = ruler.width / 2, halfL = ruler.length / 2;
    if (Math.abs(local.x) <= halfL + 8) {
      if (Math.abs(local.y - halfW) < 7) return { mode: 'draw-edge', edge: 'bottom' };
      if (Math.abs(local.y + halfW) < 7) return { mode: 'draw-edge', edge: 'top' };
    }
    if (Math.abs(local.x) <= halfL && Math.abs(local.y) <= halfW) return { mode: 'move-ruler' };
    return null;
  }

  // ---------- protractor ----------

  function protractorHandlePos() {
    return polarFromBaseline(protractor.x, protractor.y, protractor.angle, protractor.radius + 22, 90);
  }

  function drawProtractor() {
    const { x, y, angle, radius } = protractor;
    octx.save();

    octx.fillStyle = 'rgba(214, 234, 255, 0.85)';
    octx.strokeStyle = '#1d4ed8';
    octx.lineWidth = 1.5;
    octx.beginPath();
    const start = polarFromBaseline(x, y, angle, radius, 0);
    octx.moveTo(start.x, start.y);
    for (let d = 2; d <= 180; d += 2) {
      const p = polarFromBaseline(x, y, angle, radius, d);
      octx.lineTo(p.x, p.y);
    }
    octx.closePath();
    octx.fill();
    octx.stroke();

    octx.fillStyle = '#1e3a8a';
    octx.font = '10px sans-serif';
    octx.textAlign = 'center';
    for (let d = 0; d <= 180; d += 10) {
      const outer = polarFromBaseline(x, y, angle, radius, d);
      const inner = polarFromBaseline(x, y, angle, radius - 12, d);
      octx.lineWidth = 1.4;
      octx.beginPath();
      octx.moveTo(outer.x, outer.y);
      octx.lineTo(inner.x, inner.y);
      octx.stroke();
      const label = polarFromBaseline(x, y, angle, radius - 22, d);
      octx.fillText(String(d), label.x, label.y);
    }
    for (let d = 0; d <= 180; d += 5) {
      if (d % 10 === 0) continue;
      const outer = polarFromBaseline(x, y, angle, radius, d);
      const inner = polarFromBaseline(x, y, angle, radius - 6, d);
      octx.lineWidth = 0.8;
      octx.beginPath();
      octx.moveTo(outer.x, outer.y);
      octx.lineTo(inner.x, inner.y);
      octx.stroke();
    }

    octx.beginPath();
    octx.arc(x, y, 4, 0, Math.PI * 2);
    octx.fillStyle = '#1d4ed8';
    octx.fill();
    octx.restore();

    const handle = protractorHandlePos();
    octx.beginPath();
    octx.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
    octx.fillStyle = '#2563eb';
    octx.fill();
    octx.strokeStyle = '#fff';
    octx.lineWidth = 2;
    octx.stroke();
  }

  function hitTestProtractor(px, py) {
    const handle = protractorHandlePos();
    if (dist(px, py, handle.x, handle.y) < 12) return { mode: 'rotate-protractor' };
    if (dist(px, py, protractor.x, protractor.y) < 14) return { mode: 'draw-ray' };
    const d = dist(px, py, protractor.x, protractor.y);
    if (d <= protractor.radius + 6) return { mode: 'move-protractor' };
    return null;
  }

  function angleFromProtractor(px, py) {
    const local = toLocal(px, py, protractor.x, protractor.y, protractor.angle);
    let deg = (Math.atan2(-local.y, local.x) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }

  // ---------- overlay render ----------

  let livePreview = null;

  function renderOverlay() {
    const { w, h } = getCanvasSize();
    octx.clearRect(0, 0, w, h);

    if (activeTool === 'ruler') drawRuler();
    if (activeTool === 'protractor') drawProtractor();

    if (livePreview) {
      octx.save();
      octx.strokeStyle = livePreview.color || '#0f172a';
      octx.lineWidth = livePreview.width || strokeWidth;
      octx.lineCap = 'round';
      octx.setLineDash(livePreview.dashed ? [6, 4] : []);
      octx.beginPath();
      if (livePreview.type === 'line') {
        octx.moveTo(livePreview.x1, livePreview.y1);
        octx.lineTo(livePreview.x2, livePreview.y2);
      } else if (livePreview.type === 'circle') {
        octx.arc(livePreview.cx, livePreview.cy, livePreview.r, 0, Math.PI * 2);
      } else if (livePreview.type === 'arc') {
        octx.arc(livePreview.cx, livePreview.cy, livePreview.r, livePreview.start, livePreview.end, livePreview.anticlockwise);
      }
      octx.stroke();
      octx.restore();

      if (livePreview.label) {
        octx.save();
        octx.fillStyle = '#0f172a';
        octx.font = 'bold 13px sans-serif';
        octx.fillText(livePreview.label, livePreview.labelX, livePreview.labelY);
        octx.restore();
      }
    }
  }

  // ---------- history ----------

  function pushShape(shape) {
    shapes.push(shape);
    renderMain();
  }

  function undo() {
    shapes.pop();
    renderMain();
  }

  function clearAll() {
    shapes.length = 0;
    renderMain();
  }

  // ---------- pointer interaction ----------

  function getPos(evt) {
    const rect = overlayCanvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  let sweepState = null;

  function onPointerDown(evt) {
    overlayCanvas.setPointerCapture(evt.pointerId);
    const { x, y } = getPos(evt);

    if (activeTool === 'pencil' || activeTool === 'eraser') {
      currentPath = { type: 'path', points: [[x, y]], color, width: strokeWidth, erase: activeTool === 'eraser' };
      drag.mode = 'freehand';
      return;
    }

    if (activeTool === 'line') {
      drag.mode = 'line';
      livePreview = { type: 'line', x1: x, y1: y, x2: x, y2: y, color, width: strokeWidth };
      return;
    }

    if (activeTool === 'ruler') {
      const hit = hitTestRuler(x, y);
      if (!hit) return;
      drag.mode = hit.mode;
      drag.lastX = x;
      drag.lastY = y;
      if (hit.mode === 'draw-edge') {
        const local = toLocal(x, y, ruler.x, ruler.y, ruler.angle);
        const edgeLocalY = hit.edge === 'bottom' ? ruler.width / 2 : -ruler.width / 2;
        const start = toWorld(local.x, edgeLocalY, ruler.x, ruler.y, ruler.angle);
        drag.edgeLocalY = edgeLocalY;
        livePreview = { type: 'line', x1: start.x, y1: start.y, x2: start.x, y2: start.y, color, width: strokeWidth };
      }
      return;
    }

    if (activeTool === 'protractor') {
      const hit = hitTestProtractor(x, y);
      if (!hit) return;
      drag.mode = hit.mode;
      drag.lastX = x;
      drag.lastY = y;
      if (hit.mode === 'draw-ray') {
        const deg = angleFromProtractor(x, y);
        const tip = polarFromBaseline(protractor.x, protractor.y, protractor.angle, protractor.radius, deg);
        livePreview = {
          type: 'line', x1: protractor.x, y1: protractor.y, x2: tip.x, y2: tip.y, color, width: strokeWidth,
          label: `${deg.toFixed(0)}°`, labelX: tip.x + 8, labelY: tip.y
        };
      }
      return;
    }

    if (activeTool === 'compass') {
      drag.mode = 'compass';
      drag.cx = x;
      drag.cy = y;
      sweepState = { startAngle: null, lastAngle: null, swept: 0 };
      livePreview = { type: 'circle', cx: x, cy: y, r: 0, color, width: strokeWidth };
    }
  }

  function onPointerMove(evt) {
    const { x, y } = getPos(evt);

    if (drag.mode === 'freehand' && currentPath) {
      currentPath.points.push([x, y]);
      renderMain();
      return;
    }

    if (drag.mode === 'line') {
      livePreview.x2 = x;
      livePreview.y2 = y;
      renderOverlay();
      return;
    }

    if (drag.mode === 'move-ruler') {
      ruler.x += x - drag.lastX;
      ruler.y += y - drag.lastY;
      drag.lastX = x; drag.lastY = y;
      renderOverlay();
      return;
    }

    if (drag.mode === 'rotate-ruler') {
      ruler.angle = Math.atan2(y - ruler.y, x - ruler.x);
      renderOverlay();
      return;
    }

    if (drag.mode === 'draw-edge') {
      const local = toLocal(x, y, ruler.x, ruler.y, ruler.angle);
      const end = toWorld(local.x, drag.edgeLocalY, ruler.x, ruler.y, ruler.angle);
      livePreview.x2 = end.x;
      livePreview.y2 = end.y;
      const cmLen = (dist(livePreview.x1, livePreview.y1, end.x, end.y) / PX_PER_CM).toFixed(1);
      livePreview.label = `${cmLen} cm`;
      livePreview.labelX = end.x + 10;
      livePreview.labelY = end.y - 10;
      renderOverlay();
      return;
    }

    if (drag.mode === 'move-protractor') {
      protractor.x += x - drag.lastX;
      protractor.y += y - drag.lastY;
      drag.lastX = x; drag.lastY = y;
      renderOverlay();
      return;
    }

    if (drag.mode === 'rotate-protractor') {
      protractor.angle = Math.atan2(y - protractor.y, x - protractor.x) - Math.PI / 2;
      renderOverlay();
      return;
    }

    if (drag.mode === 'draw-ray') {
      const deg = angleFromProtractor(x, y);
      const tip = polarFromBaseline(protractor.x, protractor.y, protractor.angle, protractor.radius, deg);
      livePreview.x2 = tip.x;
      livePreview.y2 = tip.y;
      livePreview.label = `${deg.toFixed(0)}°`;
      livePreview.labelX = tip.x + 8;
      livePreview.labelY = tip.y;
      renderOverlay();
      return;
    }

    if (drag.mode === 'compass') {
      const r = dist(drag.cx, drag.cy, x, y);
      const angle = Math.atan2(y - drag.cy, x - drag.cx);
      if (r > 5) {
        if (sweepState.startAngle === null) {
          sweepState.startAngle = angle;
          sweepState.lastAngle = angle;
        } else {
          let delta = angle - sweepState.lastAngle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          sweepState.swept += delta;
          sweepState.lastAngle = angle;
        }
      }
      livePreview = { type: 'circle', cx: drag.cx, cy: drag.cy, r, color, width: strokeWidth,
        label: `r = ${(r / PX_PER_CM).toFixed(1)} cm`, labelX: drag.cx + r + 8, labelY: drag.cy };
      renderOverlay();
    }
  }

  function onPointerUp(evt) {
    const { x, y } = getPos(evt);

    if (drag.mode === 'freehand' && currentPath) {
      if (currentPath.points.length) pushShape(currentPath);
      currentPath = null;
    }

    if (drag.mode === 'line' && livePreview) {
      if (dist(livePreview.x1, livePreview.y1, livePreview.x2, livePreview.y2) > 1) {
        pushShape({ type: 'line', x1: livePreview.x1, y1: livePreview.y1, x2: livePreview.x2, y2: livePreview.y2, color, width: strokeWidth });
      }
    }

    if (drag.mode === 'draw-edge' && livePreview) {
      if (dist(livePreview.x1, livePreview.y1, livePreview.x2, livePreview.y2) > 1) {
        pushShape({ type: 'line', x1: livePreview.x1, y1: livePreview.y1, x2: livePreview.x2, y2: livePreview.y2, color, width: strokeWidth });
      }
    }

    if (drag.mode === 'draw-ray' && livePreview) {
      if (dist(livePreview.x1, livePreview.y1, livePreview.x2, livePreview.y2) > 1) {
        pushShape({ type: 'line', x1: livePreview.x1, y1: livePreview.y1, x2: livePreview.x2, y2: livePreview.y2, color, width: strokeWidth });
      }
    }

    if (drag.mode === 'compass') {
      const r = dist(drag.cx, drag.cy, x, y);
      if (r > 3) {
        const sweptDeg = sweepState ? Math.abs((sweepState.swept * 180) / Math.PI) : 0;
        if (sweptDeg < 20 || sweepState.startAngle === null) {
          pushShape({ type: 'circle', cx: drag.cx, cy: drag.cy, r, color, width: strokeWidth });
        } else {
          const anticlockwise = sweepState.swept < 0;
          pushShape({
            type: 'arc', cx: drag.cx, cy: drag.cy, r,
            start: sweepState.startAngle,
            end: sweepState.startAngle + sweepState.swept,
            anticlockwise,
            color, width: strokeWidth
          });
        }
      }
      sweepState = null;
    }

    drag.mode = null;
    livePreview = null;
    renderOverlay();
  }

  overlayCanvas.addEventListener('pointerdown', onPointerDown);
  overlayCanvas.addEventListener('pointermove', onPointerMove);
  overlayCanvas.addEventListener('pointerup', onPointerUp);
  overlayCanvas.addEventListener('pointercancel', onPointerUp);

  // ---------- toolbar wiring ----------

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTool = btn.dataset.tool;
      drag.mode = null;
      livePreview = null;
      setHint(activeTool);
      renderOverlay();
    });
  });

  colorPicker.addEventListener('input', () => { color = colorPicker.value; });
  widthPicker.addEventListener('input', () => {
    strokeWidth = Number(widthPicker.value);
    widthValue.textContent = String(strokeWidth);
  });

  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', () => {
    if (confirm('Clear the entire canvas? This cannot be undone.')) clearAll();
  });

  window.addEventListener('keydown', (evt) => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'z') {
      evt.preventDefault();
      undo();
    }
  });

  window.addEventListener('resize', resizeCanvases);
  resizeCanvases();
  setHint(activeTool);
})();
