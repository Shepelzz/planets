import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Body } from './bodies';
import type { BodyId } from './data';

// The camera: which body it is looking at, smooth flights between bodies, riding along with the
// focused body, framing it in the part of the screen the panels leave free, zoom limits.

export const OVERVIEW_OFFSET = new THREE.Vector3(0, 308, 555);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

interface Flight {
  t: number;
  duration: number;
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  to: Body | null;
  offset: THREE.Vector3; // final camera position relative to target (in the body's own frame if it has one)
  overviewTarget?: THREE.Vector3;
  fromUp: THREE.Vector3;
}

/**
 * Bodies the camera rides with in their own turning frame: a station (its planet stays below) and a
 * comet (its tails, always pointing away from the Sun, stay sideways on screen).
 */
const ridesFrame = (b: Body | null) => !!(b?.station || b?.comet);

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraDirector {
  /** the body we look at; null = the whole system */
  focus: Body | null = null;
  /** called when a flight ends */
  onArrive: ((b: Body | null) => void) | null = null;
  private flight: Flight | null = null;
  private lastFocusPos = new THREE.Vector3();
  private lastFocusQuat = new THREE.Quaternion();
  private viewShift = { x: 0, y: 0 };
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly controls: OrbitControls,
    private byId: Map<BodyId, Body>,
  ) {
    camera.position.copy(OVERVIEW_OFFSET).multiplyScalar(1.6);
    controls.target.set(0, 0, 0);
    this.configureLimits();
  }

  get flying() {
    return !!this.flight;
  }

  /** Screen area not covered by the top bar, dock and info panel. */
  freeArea() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let bottom = h, right = w;
    const top = 70;
    const dock = document.getElementById('dock')!.getBoundingClientRect();
    bottom = Math.min(bottom, dock.top - 8);
    const moons = document.getElementById('moons');
    if (moons && moons.classList.contains('show')) bottom = Math.min(bottom, moons.getBoundingClientRect().top - 8);
    const info = document.getElementById('info')!;
    if (!info.hidden) {
      const rc = info.getBoundingClientRect();
      if (rc.height > h * 0.55 && rc.left > w * 0.4) right = rc.left - 8; // side panel
      else bottom = Math.min(bottom, rc.top - 8); // bottom sheet
    }
    return { cx: right / 2, cy: (top + bottom) / 2, w: right, h: bottom - top };
  }

  /** Distance at which a sphere of radius r fills a comfortable part of the free screen area. */
  fitDistance(r: number) {
    const a = this.freeArea();
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const t = (tanV * Math.min(a.w, a.h)) / window.innerHeight;
    return (r / Math.sin(Math.atan(t))) * 1.18;
  }

  /** Phones and tablets held upright: a chosen body spans the whole screen width. */
  private portraitTouch = window.matchMedia('(pointer: coarse)');
  private fillsWidth() {
    return this.portraitTouch.matches && window.innerHeight > window.innerWidth;
  }

  /** How far from a body the camera stops: on upright phones and tablets edge to edge, elsewhere fitDistance. */
  private arriveDistance(b: Body) {
    if (!this.fillsWidth()) return this.fitDistance(b.viewRadius);
    // the ball itself; glow and atmosphere may spill over the edges, and so may the rings' tips
    // (fitting the whole rings left Saturn's ball small)
    const r = b.info.rings ? b.viewRadius * 0.72 : b.comet ? b.viewRadius : b.info.radius;
    const tanH = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect;
    return r / Math.sin(Math.atan(tanH));
  }

  /** Start a flight to a body (null: the overview). The info panel must be set up first: it changes the framing. */
  flyTo(b: Body | null, duration?: number) {
    const { camera, controls } = this;
    const flight: Flight = {
      t: 0,
      duration: 0,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      to: b,
      offset: b ? this.focusOffset(b) : OVERVIEW_OFFSET.clone(),
      overviewTarget: b ? undefined : new THREE.Vector3(),
      fromUp: camera.up.clone(),
    };
    // longer trips take a little longer, so the speed always feels calm
    const dest = (b ? b.anchor.position : flight.overviewTarget!).clone().add(this.worldOffset(flight));
    flight.duration = duration ?? THREE.MathUtils.clamp(2.2 + camera.position.distanceTo(dest) / 350, 2.4, 4.2);
    if (duration === undefined && this.reducedMotion.matches) flight.duration = 0.9; // «reduce motion»: short, plain flights
    this.flight = flight;
    this.focus = b;
    controls.enabled = false;
  }

  /** Once per frame: the flight, riding along, the controls, framing and the near plane. */
  update(rawDt: number) {
    this.updateFlight(Math.min(rawDt, 0.5)); // flights run on wall-clock time even when frames stutter
    this.followFocus();
    // during a flight the camera is ours: OrbitControls would clamp it to the old planet's zoom limits
    if (!this.flight) this.controls.update();
    this.keepAbovePlanet();
    this.updateViewOffset();
    this.adaptNearPlane();
  }

  /** Where the camera ends up relative to the body it flies to; for a station in the station's own frame. */
  private focusOffset(b: Body) {
    // a station: from behind, a bit to the side and above, so the planet sweeps by below it
    if (b.station) return new THREE.Vector3(-0.55, -0.45, 0.7).normalize().multiplyScalar(this.arriveDistance(b));
    // a comet (frame: x away from the Sun, y up): from the side and a little ahead, slightly above, so
    // the head is lit and both tails stream across the screen
    if (b.comet) return new THREE.Vector3(-0.3, 0.22, 1).normalize().multiplyScalar(this.arriveDistance(b));
    const pos = b.anchor.position;
    const toSun = pos.lengthSq() > 0 ? pos.clone().negate().normalize() : new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(up, toSun).normalize();
    // three-quarter lit view: sun behind-left of the camera, slightly from above
    const dir = toSun.multiplyScalar(0.62).addScaledVector(side, 0.78).addScaledVector(up, 0.2).normalize();
    if (b.info.id === 'sun') dir.set(0.3, 0.25, 1).normalize();
    if (b.info.rings) dir.addScaledVector(up, 0.25).normalize();
    return dir.multiplyScalar(this.arriveDistance(b));
  }

  private worldOffset(f: Flight) {
    return f.to && ridesFrame(f.to) ? f.offset.clone().applyQuaternion(f.to.tilt.quaternion) : f.offset;
  }

  /** Near a station "up" is away from its planet, so the planet always stays below; at a comet its loop's up; elsewhere world up. */
  private upFor(b: Body | null) {
    if (b?.station) return new THREE.Vector3(0, 0, 1).applyQuaternion(b.tilt.quaternion);
    if (b?.comet) return new THREE.Vector3(0, 1, 0).applyQuaternion(b.tilt.quaternion);
    return WORLD_UP;
  }

  private updateFlight(dt: number) {
    const { flight, camera, controls } = this;
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / flight.duration);
    const k = ease(flight.t);
    const target = flight.to ? flight.to.anchor.position : flight.overviewTarget!;
    const endPos = target.clone().add(this.worldOffset(flight));
    controls.target.lerpVectors(flight.fromTarget, target, k);
    camera.position.lerpVectors(flight.fromPos, endPos, k);
    // gentle arc so the path doesn't cut through planets
    const span = flight.fromPos.distanceTo(endPos);
    camera.position.y += Math.sin(Math.PI * k) * span * 0.12;
    camera.up.lerpVectors(flight.fromUp, this.upFor(flight.to), k).normalize();
    camera.lookAt(controls.target);
    if (flight.t >= 1) {
      this.flight = null;
      controls.enabled = true;
      this.configureLimits();
      this.onArrive?.(flight.to);
    }
    if (this.focus) {
      this.lastFocusPos.copy(this.focus.anchor.position);
      this.lastFocusQuat.copy(this.focus.tilt.quaternion);
    }
  }

  private configureLimits() {
    const { focus, controls } = this;
    if (focus) {
      const r = focus.info.radius;
      controls.minDistance = r * (focus.info.id === 'sun' ? 1.6 : 1.25);
      controls.maxDistance = focus.station
        ? this.fitDistance(focus.viewRadius) * 3
        : focus.comet
        ? this.fitDistance(focus.viewRadius) * 25 // back far enough to see the whole tail
        : Math.max(this.fitDistance(focus.viewRadius) * 6, r * 20);
    } else {
      controls.minDistance = 120; // stay outside the Sun
      controls.maxDistance = 2200;
    }
  }

  /** Keep the camera riding along with the focused body as it orbits. */
  private followFocus() {
    const { focus, camera, controls } = this;
    if (!focus || this.flight) return;
    if (ridesFrame(focus)) {
      // ride in the body's own frame: as a station circles its planet (or a comet swings round the
      // Sun) the view turns with it
      const turn = focus.tilt.quaternion.clone().multiply(this.lastFocusQuat.invert());
      for (const p of [camera.position, controls.target]) p.sub(this.lastFocusPos).applyQuaternion(turn).add(focus.anchor.position);
      camera.up.copy(this.upFor(focus));
      this.lastFocusQuat.copy(focus.tilt.quaternion);
    } else {
      camera.position.add(focus.anchor.position).sub(this.lastFocusPos);
      controls.target.add(focus.anchor.position).sub(this.lastFocusPos);
    }
    this.lastFocusPos.copy(focus.anchor.position);
  }

  /** Around a station the camera can swing towards the planet below: never let it sink into it. */
  private keepAbovePlanet() {
    const { focus, camera } = this;
    if (!focus?.station) return;
    const planet = this.byId.get(focus.info.parent!)!;
    const min = planet.info.radius * 1.03;
    const rel = camera.position.clone().sub(planet.anchor.position);
    if (rel.length() < min) camera.position.copy(planet.anchor.position).addScaledVector(rel.normalize(), min);
  }

  /** Shift the projection centre into the free area so the planet isn't hidden behind the panel. */
  private updateViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const a = this.freeArea();
    const s = this.viewShift;
    s.x += (w / 2 - a.cx - s.x) * 0.08;
    s.y += (h / 2 - a.cy - s.y) * 0.08;
    this.camera.setViewOffset(w, h, s.x, s.y, w, h);
  }

  private adaptNearPlane() {
    const { camera, controls, focus } = this;
    const dist = camera.position.distanceTo(controls.target);
    const surface = focus ? Math.max(dist - focus.info.radius * 1.02, 0.001) : dist;
    camera.near = THREE.MathUtils.clamp(surface * 0.25, 0.002, 5);
    camera.far = 40000;
    camera.updateProjectionMatrix();
  }
}
