import type * as THREE from 'three';
import type { Body } from './bodies';
import { realmOf, type BodyId, type Realm } from './data';

// Moon systems shown only while visiting: a giant's moons (and Mars's) appear when we fly to the
// planet or one of its moons. While visiting any planet the orbits make room so the neighbours don't
// loom over it: the inner planets stay, the visited planet moves out to 3× its gap from the inner
// neighbour (the Sun for Mercury), every planet beyond it to 5× its distance from the visited one
// (always at least enough to clear a moon system); at the Sun all planets move out to 5× their
// distance. Back in the overview all return to place. The
// move is a soft spring: no jerk at the start or the end, and the camera rides along.

const ROOM = 4; // gap left between systems

export function createSystems(bodies: Body[], lines: Map<string, THREE.LineLoop>) {
  const byId = new Map(bodies.map((b) => [b.info.id, b]));
  const sun = byId.get('sun')!;

  /** how far each planet's (visiting-only) moons reach from it */
  const systemReach = new Map<BodyId, number>();
  for (const b of bodies) {
    const p = b.info.parent;
    if (!p || !byId.get(p)!.info.moonsWhenNear) continue;
    systemReach.set(p, Math.max(systemReach.get(p) ?? 0, b.info.orbit + b.info.radius));
  }

  const planets = bodies.filter((b) => !b.info.parent && b !== sun && !b.info.comet && !b.info.fixedAt);
  /** How far a planet's always-shown things reach: rings, or moons like the Moon and Charon. */
  const extent = (b: Body) => {
    let e = b.viewRadius;
    if (!b.info.moonsWhenNear)
      for (const m of bodies) if (m.info.parent === b.info.id) e = Math.max(e, m.info.orbit + m.viewRadius);
    return e;
  };
  const extents = new Map(planets.map((b) => [b, extent(b)]));

  /** the planet whose system we are in (the focused body or its parent) */
  const visitedBy = (focus: Body | null) => (focus ? byId.get(focus.info.parent ?? focus.info.id)! : null);

  const sorted = [...planets].sort((x, y) => x.info.orbit - y.info.orbit);
  const speed = new Map<Body, number>(planets.map((p) => [p, 0]));

  /** Move the orbits towards where they should be for this focus (smoothly, dt in seconds). */
  function spread(focus: Body | null, dt: number) {
    const visiting = visitedBy(focus);
    const target = new Map<Body, number>(planets.map((p) => [p, p.info.orbit]));
    if (visiting === sun) {
      // at the Sun every planet is "beyond" it: all move out to 5× their distance
      for (const p of planets) target.set(p, p.info.orbit * 5);
    } else if (visiting && planets.includes(visiting)) {
      const r = visiting.info.orbit;
      const i = sorted.indexOf(visiting);
      const prev = sorted[i - 1];
      const reach = systemReach.get(visiting.info.id);
      const band = Math.max(reach ?? 0, visiting.viewRadius) + ROOM;
      // the inner neighbour's edge: a planet with its moons and rings, or the Sun's surface
      const innerOrbit = prev ? prev.info.orbit : 0;
      const innerEdge = prev ? prev.info.orbit + extents.get(prev)! : sun.info.radius;
      const at = Math.max(innerOrbit + (r - innerOrbit) * 3, innerEdge + band);
      target.set(visiting, at);
      let limit = at + band;
      for (const p of sorted.slice(i + 1)) {
        const e = extents.get(p)!;
        const t = Math.max(at + (p.info.orbit - r) * 5, limit + e);
        target.set(p, t);
        limit = t + e + ROOM;
      }
    }
    // critically damped spring: starts and stops gently, about 2.5 s to settle
    const w = 2.6;
    for (const p of planets) {
      const t = target.get(p)!;
      const now = p.orbitR ?? p.info.orbit;
      let v = speed.get(p)!;
      let next = now;
      // small steps, so a stuttering frame can't make the spring overshoot
      for (let left = dt; left > 0; left -= 1 / 60) {
        const h = Math.min(left, 1 / 60);
        v += (w * w * (t - next) - 2 * w * v) * h;
        next += v * h;
      }
      if (Math.abs(t - next) < 0.01 && Math.abs(v) < 0.05) {
        next = t;
        v = 0;
      }
      speed.set(p, v);
      p.orbitR = next;
    }
  }

  const LINE_OPACITY = 0.16;

  /**
   * Show or hide moons (and their orbit lines) for this focus. While looking at a body only its own
   * system's orbit lines stay (its planet's orbit and the moons'); the others fade out, and back in
   * the overview.
   */
  function visibility(focus: Body | null, dt: number, realm: Realm) {
    const k = 1 - Math.exp(-dt * 4);
    const host = visitedBy(focus);
    const visiting = host?.info.id ?? null;
    const reach = visiting ? systemReach.get(visiting) : undefined;
    for (const b of bodies) {
      const p = b.info.parent;
      const mine = (p ?? b.info.id) === visiting;
      // only the realm we are in (data.ts) is there at all
      let show = realmOf(b.info) === realm && (!p || !byId.get(p)!.info.moonsWhenNear || p === visiting);
      if (show && reach !== undefined && host && !mine && b !== sun)
        show = b.anchor.position.distanceTo(host.anchor.position) > reach + b.viewRadius;
      b.anchor.visible = show;
      const line = lines.get(b.info.id);
      if (!line) continue;
      const mat = line.material as THREE.LineBasicMaterial;
      const want = show && (!host || mine) ? LINE_OPACITY : 0;
      mat.opacity = !show ? 0 : Math.abs(want - mat.opacity) < 0.002 ? want : mat.opacity + (want - mat.opacity) * k;
      line.visible = mat.opacity > 0;
    }
  }

  return { spread, visibility };
}
