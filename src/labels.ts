import * as THREE from 'three';
import type { Body } from './bodies';

// Names under the bodies in the 3D view, and picking a body by tapping it (screen-space, finger
// friendly: small bodies get a generous circle).

const v = new THREE.Vector3();
/** Where a body is on screen and how big it looks. */
export function screenInfo(camera: THREE.Camera & { fov: number }, b: Body) {
  v.copy(b.anchor.position).project(camera);
  const behind = v.z > 1;
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  const dist = camera.position.distanceTo(b.anchor.position);
  const vFov = (camera.fov * Math.PI) / 180;
  const pxRadius = (b.info.radius / (dist * Math.tan(vFov / 2))) * (window.innerHeight / 2);
  return { x, y, behind, pxRadius, dist };
}

/** The nearest visible body under a screen point, if any. */
export function pickBody(camera: THREE.PerspectiveCamera, bodies: Body[], px: number, py: number): Body | null {
  let best: Body | null = null;
  let bestDist = Infinity;
  for (const b of bodies) {
    if (!b.anchor.visible) continue;
    const s = screenInfo(camera, b);
    if (s.behind) continue;
    const reach = Math.max(s.pxRadius, 26);
    const d = Math.hypot(s.x - px, s.y - py);
    if (d <= reach && s.dist < bestDist) {
      best = b;
      bestDist = s.dist;
    }
  }
  return best;
}

/** Call onTap for a quick tap or click on the canvas (not a drag that turns the camera, not a pinch). */
export function listenForTaps(canvas: HTMLCanvasElement, onTap: (x: number, y: number) => void) {
  let down: { x: number; y: number; t: number } | null = null;
  // a pinch is not a tap: remember if a second finger touched during the gesture
  const pointersDown = new Set<number>();
  let multiTouch = false;
  canvas.addEventListener('pointerdown', (e) => {
    pointersDown.add(e.pointerId);
    multiTouch = pointersDown.size > 1;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  const pointerGone = (e: PointerEvent) => pointersDown.delete(e.pointerId);
  canvas.addEventListener('pointercancel', pointerGone);
  canvas.addEventListener('pointerup', (e) => {
    pointerGone(e);
    if (!down || multiTouch) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 10 || !quick) return; // a drag that turned the camera
    onTap(e.clientX, e.clientY);
  });
}

/** Name tags in the 3D view; each one flies to its body when tapped. */
export function createLabels(layer: HTMLElement, camera: THREE.PerspectiveCamera, bodies: Body[], onChoose: (b: Body) => void) {
  const byId = new Map(bodies.map((b) => [b.info.id, b]));
  const tags = new Map<Body, HTMLButtonElement>();
  for (const b of bodies) {
    const el = document.createElement('button');
    el.className = 'label';
    el.textContent = b.info.name;
    el.addEventListener('click', () => onChoose(b));
    layer.appendChild(el);
    tags.set(b, el);
  }

  const toBody = new THREE.Vector3();
  const toOther = new THREE.Vector3();
  /** True if a bigger body sits between the camera and b. */
  function occluded(b: Body) {
    toBody.subVectors(b.anchor.position, camera.position);
    const dist = toBody.length();
    toBody.divideScalar(dist);
    for (const o of bodies) {
      if (o === b || !o.anchor.visible || o.info.radius <= b.info.radius) continue;
      toOther.subVectors(o.anchor.position, camera.position);
      const along = toOther.dot(toBody);
      if (along <= 0 || along >= dist) continue;
      if (toOther.lengthSq() - along * along < o.info.radius * o.info.radius) return true;
    }
    return false;
  }

  /** Once per frame: place the tags; none for the focused body or while flying. */
  function update(focus: Body | null, flying: boolean) {
    for (const b of bodies) {
      const el = tags.get(b)!;
      const s = screenInfo(camera, b);
      let show = b.anchor.visible && !s.behind && s.pxRadius < 90 && b !== focus && !flying && !occluded(b);
      // a moon or station drawn right next to its planet: the planet's label is enough
      if (b.info.parent && byId.get(b.info.parent) !== focus) {
        const p = screenInfo(camera, byId.get(b.info.parent)!);
        if (Math.hypot(s.x - p.x, s.y - p.y) < p.pxRadius + 40) show = false;
      }
      el.classList.toggle('show', show);
      if (show) el.style.transform = `translate(-50%, 0) translate(${s.x.toFixed(1)}px, ${(s.y + s.pxRadius + 8).toFixed(1)}px)`;
    }
  }

  return { update };
}
