import type * as THREE from 'three';
import type { Body } from './bodies';
import type { BodyId } from './data';

// Moon systems shown only while visiting: a giant's moons (and Mars's) appear when we fly to the
// planet or one of its moons. While visiting such a planet the orbits make room for its moon system:
// the planet itself moves out a little if the inner neighbours are too close, and every planet beyond
// it moves further out, just enough to clear it (the camera rides along). Back in the overview all
// return to place. Another planet or moon still passing through the system is hidden.

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

  const planets = bodies.filter((b) => !b.info.parent && b !== sun);
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

  /** Move the orbits towards where they should be for this focus (smoothly, dt in seconds). */
  function spread(focus: Body | null, dt: number) {
    const visiting = visitedBy(focus);
    const reach = visiting ? systemReach.get(visiting.info.id) : undefined;
    const target = new Map<Body, number>(planets.map((p) => [p, p.info.orbit]));
    if (visiting && reach !== undefined) {
      const r = visiting.info.orbit, band = Math.max(reach, visiting.viewRadius) + ROOM;
      let inner = 0;
      for (const p of planets) if (p.info.orbit < r) inner = Math.max(inner, p.info.orbit + extents.get(p)!);
      const at = Math.max(r, inner + band);
      target.set(visiting, at);
      let limit = at + band;
      for (const p of planets.filter((x) => x.info.orbit > r).sort((x, y) => x.info.orbit - y.info.orbit)) {
        const e = extents.get(p)!;
        const t = Math.max(p.info.orbit, limit + e);
        target.set(p, t);
        limit = t + e + ROOM;
      }
    }
    const k = 1 - Math.exp(-dt * 2.5);
    for (const p of planets) {
      const t = target.get(p)!;
      const now = p.orbitR ?? p.info.orbit;
      p.orbitR = Math.abs(t - now) < 0.01 ? t : now + (t - now) * k;
    }
  }

  /** Show or hide moons (and their orbit lines) for this focus. */
  function visibility(focus: Body | null) {
    const host = visitedBy(focus);
    const visiting = host?.info.id ?? null;
    const reach = visiting ? systemReach.get(visiting) : undefined;
    for (const b of bodies) {
      const p = b.info.parent;
      const mine = (p ?? b.info.id) === visiting;
      let show = !p || !byId.get(p)!.info.moonsWhenNear || p === visiting;
      if (show && reach !== undefined && host && !mine && b !== sun)
        show = b.anchor.position.distanceTo(host.anchor.position) > reach + b.viewRadius;
      b.anchor.visible = show;
      const line = lines.get(b.info.id);
      if (line) line.visible = show;
    }
  }

  return { spread, visibility };
}
