// Old iPads (iOS 12) have no pointer events: the pepjs polyfill makes them from touches. Unlike real
// browsers it doesn't keep a finger's events on the element it touched down on: a finger lifted
// over a label, button or panel sends its "up" there, and OrbitControls (listening on the canvas)
// never hears it. It then believes that finger is still down — one finger zooms, a pinch does
// nothing — until the page is reloaded. A second finger's capture is also dropped as soon as any
// finger lifts. So: every finger that went down on the canvas has its move/up/cancel delivered to the
// canvas, wherever it ends up. Real browsers already do this, so nothing changes there.

const PROPS = ['pointerId', 'pointerType', 'isPrimary', 'pageX', 'pageY', 'clientX', 'clientY', 'button', 'buttons'] as const;

export function keepPointersOnCanvas(canvas: HTMLCanvasElement) {
  const down = new Set<number>();
  canvas.addEventListener('pointerdown', (e) => down.add(e.pointerId));

  const forward = (e: PointerEvent) => {
    if (!down.has(e.pointerId)) return;
    if (e.type !== 'pointermove') down.delete(e.pointerId);
    if (e.target === canvas) return; // already where it belongs
    const copy = document.createEvent('Event');
    copy.initEvent(e.type, false, true);
    for (const k of PROPS) Object.defineProperty(copy, k, { value: e[k] });
    canvas.dispatchEvent(copy);
  };
  for (const type of ['pointermove', 'pointerup', 'pointercancel'])
    window.addEventListener(type, forward as EventListener, true);
}
