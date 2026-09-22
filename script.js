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

  const compassContextGroup = document.getElementById('compass-context');
  const lockBtn = document.getElementById('lockBtn');
  const lockBtnLabel = document.getElementById('lockBtnLabel');

  const imageContextGroup = document.getElementById('image-context');
  const addImageBtn = document.getElementById('addImageBtn');
  const cropBtn = document.getElementById('cropBtn');
  const cropBtnLabel = document.getElementById('cropBtnLabel');
  const deleteImageBtn = document.getElementById('deleteImageBtn');
  const imageFileInput = document.getElementById('imageFileInput');

  const PX_PER_CM = 32;

  let activeTool = 'pencil';
  let color = colorPicker.value;
  let strokeWidth = Number(widthPicker.value);

  const shapes = [];
  let currentPath = null;

  const ruler = { x: 0, y: 0, angle: 0, length: 20 * PX_PER_CM, width: 2.6 * PX_PER_CM, placed: false };
  const protractor = { x: 0, y: 0, angle: 0, radius: 7 * PX_PER_CM, placed: false };
  const compass = { x: 0, y: 0, angle: 0, radius: 2 * PX_PER_CM, locked: false, placed: false };

  let nextImageId = 1;
  let selectedImageId = null;
  let cropMode = false;
  let cropSel = null;

  const drag = { mode: null, tool: null };
  let sweepState = null;

  const hints = {
    pencil: 'Pencil selected — draw freely on the canvas.',
    eraser: 'Eraser selected — drag over strokes to remove them.',
    line: 'Line tool — click and drag to draw a straight segment.',
    ruler: 'Ruler — drag the body to move it, the round handle to rotate it, and drag along an edge to draw a snapped line.',
    protractor: 'Protractor — drag the body to move it, the handle to rotate it, then drag from the center point to draw a ray and read the angle.',
    compass: 'Compass — drag the needle to move it, drag the pencil tip to set the opening, then press Lock. Once locked, drag the pencil to aim, and drag the top handle to swing an arc and mark the paper.',
    image: 'Image — click "Add Image" to place a photo, drag it to move, use the corner handles to resize, the top handle to rotate, or Crop to trim it.'
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
    if (!compass.placed) {
      compass.x = rect.width / 2 - 160;
      compass.y = rect.height / 2 - 120;
      compass.placed = true;
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

  function drawImageShape(context, shape) {
    context.save();
    context.translate(shape.cx, shape.cy);
    context.rotate(shape.angle);
    context.drawImage(
      shape.img,
      shape.crop.sx, shape.crop.sy, shape.crop.sw, shape.crop.sh,
      -shape.w / 2, -shape.h / 2, shape.w, shape.h
    );
    context.restore();
  }

  function renderMain() {
    const { w, h } = getCanvasSize();
    ctx.clearRect(0, 0, w, h);
    for (const shape of shapes) {
      if (shape.type === 'image') drawImageShape(ctx, shape);
      else strokeShape(ctx, shape);
    }
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

  // ---------- compass ----------

  function compassPencilTip() {
    return { x: compass.x + compass.radius * Math.cos(compass.angle), y: compass.y + compass.radius * Math.sin(compass.angle) };
  }

  function compassHinge() {
    const p = compassPencilTip();
    const mx = (compass.x + p.x) / 2, my = (compass.y + p.y) / 2;
    const dx = p.x - compass.x, dy = p.y - compass.y;
    const len = Math.hypot(dx, dy) || 1;
    const perpx = -dy / len, perpy = dx / len;
    const offset = Math.min(100, Math.max(34, compass.radius * 0.5));
    return { x: mx + perpx * offset, y: my + perpy * offset };
  }

  function drawCompass() {
    const p = compassPencilTip();
    const h = compassHinge();

    octx.save();
    octx.strokeStyle = '#64748b';
    octx.lineWidth = 4;
    octx.lineCap = 'round';
    octx.beginPath();
    octx.moveTo(h.x, h.y);
    octx.lineTo(compass.x, compass.y);
    octx.stroke();
    octx.beginPath();
    octx.moveTo(h.x, h.y);
    octx.lineTo(p.x, p.y);
    octx.stroke();

    octx.beginPath();
    octx.arc(compass.x, compass.y, 5, 0, Math.PI * 2);
    octx.fillStyle = '#0f172a';
    octx.fill();
    octx.strokeStyle = '#0f172a';
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.moveTo(compass.x - 9, compass.y);
    octx.lineTo(compass.x + 9, compass.y);
    octx.moveTo(compass.x, compass.y - 9);
    octx.lineTo(compass.x, compass.y + 9);
    octx.stroke();

    octx.beginPath();
    octx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    octx.fillStyle = color;
    octx.fill();
    octx.strokeStyle = '#1e293b';
    octx.lineWidth = 1;
    octx.stroke();

    octx.beginPath();
    octx.arc(h.x, h.y, 10, 0, Math.PI * 2);
    octx.fillStyle = compass.locked ? '#16a34a' : '#94a3b8';
    octx.fill();
    octx.strokeStyle = '#fff';
    octx.lineWidth = 2;
    octx.stroke();

    octx.fillStyle = '#0f172a';
    octx.font = 'bold 12px sans-serif';
    octx.textAlign = 'left';
    octx.fillText(
      `r = ${(compass.radius / PX_PER_CM).toFixed(1)} cm  ·  ${compass.locked ? 'locked, drag handle to mark' : 'unlocked, drag pencil to set opening'}`,
      compass.x + 14, compass.y - 14
    );
    octx.restore();
  }

  function hitTestCompass(px, py) {
    const p = compassPencilTip();
    const h = compassHinge();
    if (dist(px, py, compass.x, compass.y) < 14) return { mode: 'move-compass' };
    if (compass.locked && dist(px, py, h.x, h.y) < 14) return { mode: 'draw-compass' };
    if (dist(px, py, p.x, p.y) < 14) return { mode: compass.locked ? 'aim-pencil' : 'adjust-radius' };
    return null;
  }

  // ---------- image tools ----------

  function findImage(id) {
    return shapes.find(s => s.type === 'image' && s.id === id);
  }

  const OPPOSITE_CORNER = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' };

  function imageCornersWorld(img) {
    const { cx, cy, angle, w, h } = img;
    return [
      { key: 'tl', ...toWorld(-w / 2, -h / 2, cx, cy, angle) },
      { key: 'tr', ...toWorld(w / 2, -h / 2, cx, cy, angle) },
      { key: 'br', ...toWorld(w / 2, h / 2, cx, cy, angle) },
      { key: 'bl', ...toWorld(-w / 2, h / 2, cx, cy, angle) }
    ];
  }

  function cropCornersWorld(img) {
    const { cx, cy, angle, w, h } = img;
    const x0 = -w / 2 + cropSel.x, y0 = -h / 2 + cropSel.y;
    const x1 = x0 + cropSel.w, y1 = y0 + cropSel.h;
    return [
      { key: 'tl', ...toWorld(x0, y0, cx, cy, angle) },
      { key: 'tr', ...toWorld(x1, y0, cx, cy, angle) },
      { key: 'br', ...toWorld(x1, y1, cx, cy, angle) },
      { key: 'bl', ...toWorld(x0, y1, cx, cy, angle) }
    ];
  }

  function drawHandleSquare(x, y, fill) {
    octx.fillStyle = fill;
    octx.fillRect(x - 6, y - 6, 12, 12);
    octx.strokeStyle = '#fff';
    octx.lineWidth = 1.5;
    octx.strokeRect(x - 6, y - 6, 12, 12);
  }

  function drawImageHandles() {
    const img = findImage(selectedImageId);
    if (!img) return;
    const { cx, cy, angle, w, h } = img;

    octx.save();
    octx.translate(cx, cy);
    octx.rotate(angle);
    octx.strokeStyle = '#2563eb';
    octx.lineWidth = 1.5;
    octx.setLineDash([6, 4]);
    octx.strokeRect(-w / 2, -h / 2, w, h);
    octx.setLineDash([]);
    octx.restore();

    if (cropMode && cropSel) {
      octx.save();
      octx.translate(cx, cy);
      octx.rotate(angle);
      octx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      octx.beginPath();
      octx.rect(-w / 2, -h / 2, w, h);
      octx.rect(-w / 2 + cropSel.x, -h / 2 + cropSel.y, cropSel.w, cropSel.h);
      octx.fill('evenodd');
      octx.strokeStyle = '#f59e0b';
      octx.lineWidth = 2;
      octx.strokeRect(-w / 2 + cropSel.x, -h / 2 + cropSel.y, cropSel.w, cropSel.h);
      octx.restore();
      cropCornersWorld(img).forEach(c => drawHandleSquare(c.x, c.y, '#f59e0b'));
    } else {
      imageCornersWorld(img).forEach(c => drawHandleSquare(c.x, c.y, '#2563eb'));
      const topMid = toWorld(0, -h / 2, cx, cy, angle);
      const rh = toWorld(0, -h / 2 - 26, cx, cy, angle);
      octx.beginPath();
      octx.moveTo(topMid.x, topMid.y);
      octx.lineTo(rh.x, rh.y);
      octx.strokeStyle = '#2563eb';
      octx.lineWidth = 1.5;
      octx.stroke();
      octx.beginPath();
      octx.arc(rh.x, rh.y, 8, 0, Math.PI * 2);
      octx.fillStyle = '#2563eb';
      octx.fill();
      octx.strokeStyle = '#fff';
      octx.lineWidth = 2;
      octx.stroke();
    }
  }

  function hitTestImages(px, py) {
    const selImg = findImage(selectedImageId);
    if (selImg) {
      if (cropMode) {
        for (const c of cropCornersWorld(selImg)) {
          if (dist(px, py, c.x, c.y) < 11) return { mode: 'crop-' + c.key, img: selImg };
        }
      } else {
        const rh = toWorld(0, -selImg.h / 2 - 26, selImg.cx, selImg.cy, selImg.angle);
        if (dist(px, py, rh.x, rh.y) < 11) return { mode: 'rotate-image', img: selImg };
        for (const c of imageCornersWorld(selImg)) {
          if (dist(px, py, c.x, c.y) < 11) return { mode: 'resize-' + c.key, img: selImg };
        }
      }
    }
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (s.type !== 'image') continue;
      const local = toLocal(px, py, s.cx, s.cy, s.angle);
      if (Math.abs(local.x) <= s.w / 2 && Math.abs(local.y) <= s.h / 2) return { mode: 'move-image', img: s };
    }
    return null;
  }

  function enterCropMode() {
    const img = findImage(selectedImageId);
    if (!img) return;
    cropMode = true;
    cropSel = { x: 0, y: 0, w: img.w, h: img.h };
    updateContextualControls();
    renderOverlay();
  }

  function applyCropMode() {
    const img = findImage(selectedImageId);
    if (img && cropSel && cropSel.w > 4 && cropSel.h > 4) {
      const scaleX = img.crop.sw / img.w;
      const scaleY = img.crop.sh / img.h;
      const newCrop = {
        sx: img.crop.sx + cropSel.x * scaleX,
        sy: img.crop.sy + cropSel.y * scaleY,
        sw: cropSel.w * scaleX,
        sh: cropSel.h * scaleY
      };
      const centerLocal = { x: -img.w / 2 + cropSel.x + cropSel.w / 2, y: -img.h / 2 + cropSel.y + cropSel.h / 2 };
      const centerWorld = toWorld(centerLocal.x, centerLocal.y, img.cx, img.cy, img.angle);
      img.crop = newCrop;
      img.w = cropSel.w;
      img.h = cropSel.h;
      img.cx = centerWorld.x;
      img.cy = centerWorld.y;
    }
    cropMode = false;
    cropSel = null;
    updateContextualControls();
    renderMain();
    renderOverlay();
  }

  function cancelCropMode() {
    cropMode = false;
    cropSel = null;
    updateContextualControls();
    renderOverlay();
  }

  function deleteSelectedImage() {
    const idx = shapes.findIndex(s => s.type === 'image' && s.id === selectedImageId);
    if (idx >= 0) shapes.splice(idx, 1);
    selectedImageId = null;
    cropMode = false;
    cropSel = null;
    updateContextualControls();
    renderMain();
    renderOverlay();
  }

  function loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const { w: canvasW, h: canvasH } = getCanvasSize();
        const maxDim = Math.min(canvasW, canvasH) * 0.6;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const shape = {
          type: 'image', id: nextImageId++, img,
          cx: canvasW / 2, cy: canvasH / 2,
          w: img.width * scale, h: img.height * scale, angle: 0,
          crop: { sx: 0, sy: 0, sw: img.width, sh: img.height }
        };
        shapes.push(shape);
        selectedImageId = shape.id;
        cropMode = false;
        cropSel = null;
        updateContextualControls();
        renderMain();
        renderOverlay();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------- overlay render ----------

  let livePreview = null;

  function renderOverlay() {
    const { w, h } = getCanvasSize();
    octx.clearRect(0, 0, w, h);

    if (activeTool === 'ruler') drawRuler();
    if (activeTool === 'protractor') drawProtractor();
    if (activeTool === 'compass') drawCompass();
    if (activeTool === 'image') drawImageHandles();

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
    selectedImageId = null;
    cropMode = false;
    cropSel = null;
    updateContextualControls();
    renderMain();
  }

  // ---------- contextual toolbar ----------

  function updateContextualControls() {
    compassContextGroup.classList.toggle('visible', activeTool === 'compass');
    lockBtnLabel.textContent = compass.locked ? 'Unlock' : 'Lock';
    lockBtn.classList.toggle('active', compass.locked);

    const showImageTools = activeTool === 'image';
    imageContextGroup.classList.toggle('visible', showImageTools);
    const hasSelection = showImageTools && !!selectedImageId;
    cropBtn.classList.toggle('visible', hasSelection);
    deleteImageBtn.classList.toggle('visible', hasSelection);
    cropBtnLabel.textContent = cropMode ? 'Apply Crop' : 'Crop';
    cropBtn.classList.toggle('active', cropMode);
  }

  // ---------- pointer interaction ----------

  function getPos(evt) {
    const rect = overlayCanvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

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
      const hit = hitTestCompass(x, y);
      if (!hit) return;
      drag.mode = hit.mode;
      drag.lastX = x;
      drag.lastY = y;
      if (hit.mode === 'draw-compass') {
        sweepState = { startAngle: compass.angle, lastAngle: compass.angle, swept: 0 };
        livePreview = { type: 'arc', cx: compass.x, cy: compass.y, r: compass.radius, start: compass.angle, end: compass.angle, anticlockwise: false, color, width: strokeWidth };
      }
      return;
    }

    if (activeTool === 'image') {
      const hit = hitTestImages(x, y);
      if (!hit) {
        selectedImageId = null;
        cropMode = false;
        cropSel = null;
        updateContextualControls();
        renderOverlay();
        return;
      }
      if (hit.mode === 'move-image') {
        selectedImageId = hit.img.id;
        cropMode = false;
        cropSel = null;
        drag.mode = 'move-image';
        drag.target = hit.img;
        drag.lastX = x;
        drag.lastY = y;
        updateContextualControls();
        renderOverlay();
        return;
      }
      if (hit.mode === 'rotate-image') {
        drag.mode = 'rotate-image';
        drag.target = hit.img;
        return;
      }
      if (hit.mode.startsWith('resize-')) {
        const cornerKey = hit.mode.slice(7);
        const anchor = imageCornersWorld(hit.img).find(c => c.key === OPPOSITE_CORNER[cornerKey]);
        drag.mode = 'resize-image';
        drag.target = hit.img;
        drag.anchor = { x: anchor.x, y: anchor.y };
        drag.angle = hit.img.angle;
        return;
      }
      if (hit.mode.startsWith('crop-')) {
        const cornerKey = hit.mode.slice(5);
        const points = {
          tl: { x: cropSel.x, y: cropSel.y },
          tr: { x: cropSel.x + cropSel.w, y: cropSel.y },
          br: { x: cropSel.x + cropSel.w, y: cropSel.y + cropSel.h },
          bl: { x: cropSel.x, y: cropSel.y + cropSel.h }
        };
        drag.mode = 'crop-image';
        drag.target = hit.img;
        drag.cropAnchor = points[OPPOSITE_CORNER[cornerKey]];
        return;
      }
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

    if (drag.mode === 'move-compass') {
      const dx = x - drag.lastX, dy = y - drag.lastY;
      compass.x += dx; compass.y += dy;
      drag.lastX = x; drag.lastY = y;
      renderOverlay();
      return;
    }

    if (drag.mode === 'adjust-radius') {
      compass.radius = Math.max(10, dist(compass.x, compass.y, x, y));
      compass.angle = Math.atan2(y - compass.y, x - compass.x);
      renderOverlay();
      return;
    }

    if (drag.mode === 'aim-pencil') {
      compass.angle = Math.atan2(y - compass.y, x - compass.x);
      renderOverlay();
      return;
    }

    if (drag.mode === 'draw-compass') {
      const angle = Math.atan2(y - compass.y, x - compass.x);
      let delta = angle - sweepState.lastAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      sweepState.swept += delta;
      sweepState.lastAngle = angle;
      compass.angle = angle;
      const capped = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, sweepState.swept));
      livePreview = {
        type: 'arc', cx: compass.x, cy: compass.y, r: compass.radius,
        start: sweepState.startAngle, end: sweepState.startAngle + capped, anticlockwise: capped < 0,
        color, width: strokeWidth,
        label: `${Math.abs((capped * 180) / Math.PI).toFixed(0)}°`, labelX: x + 10, labelY: y - 10
      };
      renderOverlay();
      return;
    }

    if (drag.mode === 'move-image') {
      const dx = x - drag.lastX, dy = y - drag.lastY;
      drag.target.cx += dx; drag.target.cy += dy;
      drag.lastX = x; drag.lastY = y;
      renderMain();
      renderOverlay();
      return;
    }

    if (drag.mode === 'rotate-image') {
      const img = drag.target;
      img.angle = Math.atan2(y - img.cy, x - img.cx) - Math.PI / 2;
      renderMain();
      renderOverlay();
      return;
    }

    if (drag.mode === 'resize-image') {
      const img = drag.target;
      const local = toLocal(x, y, drag.anchor.x, drag.anchor.y, drag.angle);
      const newW = Math.max(20, Math.abs(local.x));
      const newH = Math.max(20, Math.abs(local.y));
      const centerWorld = toWorld(local.x / 2, local.y / 2, drag.anchor.x, drag.anchor.y, drag.angle);
      img.w = newW; img.h = newH; img.cx = centerWorld.x; img.cy = centerWorld.y;
      renderMain();
      renderOverlay();
      return;
    }

    if (drag.mode === 'crop-image') {
      const img = drag.target;
      const local = toLocal(x, y, img.cx, img.cy, img.angle);
      let lx = Math.max(0, Math.min(img.w, local.x + img.w / 2));
      let ly = Math.max(0, Math.min(img.h, local.y + img.h / 2));
      const anchor = drag.cropAnchor;
      const minSize = 10;
      if (Math.abs(lx - anchor.x) < minSize) lx = anchor.x + (lx >= anchor.x ? minSize : -minSize);
      if (Math.abs(ly - anchor.y) < minSize) ly = anchor.y + (ly >= anchor.y ? minSize : -minSize);
      lx = Math.max(0, Math.min(img.w, lx));
      ly = Math.max(0, Math.min(img.h, ly));
      cropSel = { x: Math.min(anchor.x, lx), y: Math.min(anchor.y, ly), w: Math.abs(lx - anchor.x), h: Math.abs(ly - anchor.y) };
      renderOverlay();
      return;
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

    if (drag.mode === 'draw-compass') {
      const sweptDeg = sweepState ? Math.abs((sweepState.swept * 180) / Math.PI) : 0;
      if (sweptDeg > 1) {
        if (sweptDeg >= 359.5) {
          pushShape({ type: 'circle', cx: compass.x, cy: compass.y, r: compass.radius, color, width: strokeWidth });
        } else {
          const capped = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, sweepState.swept));
          pushShape({
            type: 'arc', cx: compass.x, cy: compass.y, r: compass.radius,
            start: sweepState.startAngle, end: sweepState.startAngle + capped, anticlockwise: capped < 0,
            color, width: strokeWidth
          });
        }
      }
      sweepState = null;
    }

    drag.mode = null;
    drag.target = null;
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
      updateContextualControls();
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

  lockBtn.addEventListener('click', () => {
    compass.locked = !compass.locked;
    updateContextualControls();
    renderOverlay();
  });

  addImageBtn.addEventListener('click', () => imageFileInput.click());
  imageFileInput.addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    if (file) loadImageFile(file);
    evt.target.value = '';
  });
  cropBtn.addEventListener('click', () => {
    if (cropMode) applyCropMode();
    else enterCropMode();
  });
  deleteImageBtn.addEventListener('click', deleteSelectedImage);

  window.addEventListener('keydown', (evt) => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'z') {
      evt.preventDefault();
      undo();
      return;
    }
    if (evt.key === 'Escape' && cropMode) {
      cancelCropMode();
      return;
    }
    if ((evt.key === 'Delete' || evt.key === 'Backspace') && activeTool === 'image' && selectedImageId) {
      evt.preventDefault();
      deleteSelectedImage();
    }
  });

  window.addEventListener('resize', resizeCanvases);
  resizeCanvases();
  setHint(activeTool);
  updateContextualControls();
})();
