// Touch gestures on the board canvas: tap, one-finger pan, two-finger pinch.
//
// A touch that moves less than TAP_SLOP px is a tap; more, and it pans the
// camera instead. Pinching zooms about the fingers' midpoint.

const TAP_SLOP = 9;

/**
 * @param {HTMLCanvasElement} el
 * @param {{onTap(x:number,y:number):void, onPan(dx:number,dy:number):void,
 *          onZoom(factor:number,cx:number,cy:number):void}} handlers
 * @returns {() => void} detach
 */
export function attachGestures(el, { onTap, onPan, onZoom }) {
  const pts = new Map(); // pointerId -> {x, y}
  let start = null; // first finger down: {id, x, y, moved}
  let pinch = null; // {dist, mx, my}

  const local = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchState = () => {
    const [a, b] = [...pts.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const down = (e) => {
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic or already-released pointer: carry on without capture.
    }
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) start = { id: e.pointerId, ...p, moved: false };
    if (pts.size === 2) {
      pinch = pinchState();
      if (start) start.moved = true; // a pinch is never a tap
    }
    e.preventDefault();
  };
  const move = (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size >= 2 && pinch) {
      const now = pinchState();
      if (pinch.dist > 0) onZoom(now.dist / pinch.dist, now.mx, now.my);
      onPan(now.mx - pinch.mx, now.my - pinch.my);
      pinch = now;
    } else if (start && e.pointerId === start.id) {
      if (!start.moved && Math.hypot(p.x - start.x, p.y - start.y) > TAP_SLOP) {
        start.moved = true;
        onPan(p.x - start.x, p.y - start.y);
      } else if (start.moved) {
        onPan(p.x - prev.x, p.y - prev.y);
      }
    }
    e.preventDefault();
  };
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (start && e.pointerId === start.id) {
      if (!start.moved && e.type === 'pointerup') onTap(start.x, start.y);
      start = null;
    }
  };
  const wheel = (e) => {
    // Desktop convenience: wheel / trackpad zoom.
    e.preventDefault();
    const p = local(e);
    onZoom(Math.exp(-e.deltaY * 0.002), p.x, p.y);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
  };
}
