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
- **Compass** — modeled after a real drafting compass. Drag the needle tip to
  move it, drag the pencil tip to set the opening, then press **Lock** to fix
  the radius. Once locked, drag the pencil to aim without marking anything,
  then drag the top handle to swing it and ink the arc it sweeps (release
  after a near-full turn for a complete circle).
- **Image** — click **Add Image**, drag an image file onto the canvas, or
  paste (Ctrl/Cmd+V) a copied screenshot straight from the clipboard. Drag
  its body to move it, the corner handles to resize it, the top handle to
  rotate it, and **Crop** to trim it to a rectangle. Any other tool draws
  right on top of it. Select an image and press **Delete** (or the
  Delete/Backspace key) to remove it.

Undo with the toolbar button or Ctrl/Cmd+Z; Clear wipes the canvas.
