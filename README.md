# Math Compass

A browser-based sketch tool for teaching high school math. No build step —
open `index.html` in a browser, or serve the folder with any static file
server (e.g. `python3 -m http.server`).

## Tools

- **Pencil / Eraser** — freehand drawing with adjustable color and width.
- **Line** — click-drag to draw a straight segment.
- **Ruler** — a draggable, rotatable 20 cm ruler. Drag its body to move it,
  the round handle to rotate it, and drag along either edge to draw a line
  snapped perfectly straight (like tracing a real ruler).
- **Protractor** — a draggable, rotatable 0°–180° protractor. Drag from its
  center point to draw a ray and read the live angle measurement.
- **Compass** — click to set the center and drag out to set the radius.
  Release without sweeping for a full circle, or sweep sideways to draw an
  arc following the sweep, just like a physical compass.

Undo with the toolbar button or Ctrl/Cmd+Z; Clear wipes the canvas.
