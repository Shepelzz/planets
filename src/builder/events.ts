import * as THREE from 'three';
import type { PlanetState } from './main';
import { massEarths, type PlanetSize } from './physics';

// What happens when worlds meet (the «Що буде?» buttons), after what is known of young star systems:
//   · two rocky planets merge into a bigger one, molten all over, a new moon gathering from the debris
//     (very likely how our own Moon was born: young Earth and a Mars-sized planet, Theia, collided);
//   · a giant simply swallows a rocky planet; two giants merge into one;
//   · a moon pushed inside its planet's Roche limit is pulled apart by tides into a ring.
// Here: the rules of the result, and the flash and the debris that go with it.

const SIZES: PlanetSize[] = ['small', 'medium', 'large'];

export type EventKind = 'merge' | 'swallow' | 'giants' | 'ring';

/** The two planets as one: which survives and how it changes. The other is removed by the caller. */
export function mergePlanets(a: PlanetState, b: PlanetState): { keep: PlanetState; gone: PlanetState; kind: EventKind } {
  const [big, small] = massEarths(a) >= massEarths(b) ? [a, b] : [b, a];
  const au = (a.au * massEarths(a) + b.au * massEarths(b)) / (massEarths(a) + massEarths(b));
  const keep: PlanetState = { ...big, au, rings: a.rings || b.rings };
  if (big.kind === 'rocky' && small.kind === 'rocky') {
    // bigger, molten, and a new moon from the debris (at most three)
    keep.size = SIZES[Math.min(2, Math.max(SIZES.indexOf(a.size), SIZES.indexOf(b.size)) + 1)];
    keep.moons = Math.min(3, a.moons + b.moons + 1);
    keep.water = a.water || b.water; // it boils off, then rains back as the planet cools
    keep.molten = 1;
    return { keep, gone: small, kind: 'merge' };
  }
  keep.moons = Math.min(3, a.moons + b.moons);
  if (small.kind === 'rocky') return { keep, gone: small, kind: 'swallow' };
  keep.kind = a.kind === 'gas' || b.kind === 'gas' ? 'gas' : 'ice';
  return { keep, gone: small, kind: 'giants' };
}

// ---------- the flash and the debris ----------
const glowCanvas = document.createElement('canvas');
glowCanvas.width = glowCanvas.height = 128;
{
  const g = glowCanvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.25, 'rgba(255,200,120,0.85)');
  grad.addColorStop(0.6, 'rgba(255,110,40,0.25)');
  grad.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
}
const glowTex = new THREE.CanvasTexture(glowCanvas);
glowTex.colorSpace = THREE.SRGBColorSpace;

const N = 260;

export function createBlast(scene: THREE.Scene) {
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.visible = false;
  const pos = new Float32Array(N * 3);
  const vel: THREE.Vector3[] = Array.from({ length: N }, () => new THREE.Vector3());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffb070, size: 1.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const debris = new THREE.Points(geo, mat);
  debris.frustumCulled = false;
  debris.visible = false;
  scene.add(flash, debris);
  let t = -1;
  let size = 10;
  const at = new THREE.Vector3();

  return {
    /** a burst at this spot, sized to the planets involved */
    boom(where: THREE.Vector3, s: number) {
      at.copy(where);
      size = s;
      t = 0;
      flash.visible = debris.visible = true;
      flash.position.copy(at);
      for (let i = 0; i < N; i++) {
        pos.set([at.x, at.y, at.z], i * 3);
        // flung out every way, mostly along the orbits' plane
        vel[i].set(Math.random() - 0.5, (Math.random() - 0.5) * 0.35, Math.random() - 0.5).normalize().multiplyScalar(s * (0.8 + Math.random() * 2.2));
      }
      geo.attributes.position.needsUpdate = true;
    },
    frame(dt: number) {
      if (t < 0) return;
      t += dt;
      const k = Math.min(t / 3, 1);
      flash.scale.setScalar(size * (2 + 10 * Math.sqrt(Math.min(t / 0.6, 1))));
      flash.material.opacity = Math.max(0, 1 - t / 0.9);
      for (let i = 0; i < N; i++) {
        const slow = Math.exp(-t * 0.9); // they spread, slowing down (gathered back by gravity)
        pos[i * 3] += vel[i].x * dt * slow;
        pos[i * 3 + 1] += vel[i].y * dt * slow;
        pos[i * 3 + 2] += vel[i].z * dt * slow;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - k;
      mat.size = Math.max(0.6, size * 0.16);
      if (k >= 1) {
        t = -1;
        flash.visible = debris.visible = false;
      }
    },
  };
}
