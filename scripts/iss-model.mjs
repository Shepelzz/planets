// NASA ISS (IGOAL) → light glb for the app (public/models/iss.glb, iss-lite.glb): three nodes (station,
// port wings, starboard wings), small details dropped, simplified geometry, colour textures only (JPEG,
// Safari 12 has no WebP), lattice parts as plain colour without normals (the app shades them flat),
// meshopt-compressed.
//
// Source: github.com/nasa/NASA-3D-Resources, «3D Models/International Space Station (ISS) (D) (IGOAL)/
// International Space Station (ISS).glb» (~96 MB, public domain). Not part of the build; to rerun:
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 \
//     meshoptimizer draco3dgltf sharp gl-matrix
//   SLOPPY_ABOVE=999999 DROP='Handrail|Details|Shutter|SPDM_Arm' node scripts/iss-model.mjs <nasa.glb> public/models/iss.glb 0.1 0.005 512 0.3
//   SLOPPY_ABOVE=999999 DROP='Handrail|Details|Shutter|SPDM_Arm' node scripts/iss-model.mjs <nasa.glb> public/models/iss-lite.glb 0.1 0.012 256 0.45
// args: ratio, simplify error, texture size, smallest part kept (scene units; the station is ~10 across)
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, join, quantize, unpartition, meshopt, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { mat4 } from 'gl-matrix';

const [,, input, output, ratio = '0.06', error = '0.004', tex = '512', minSize = '0.15'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.getDefaultScene();

// new flat layout
const station = doc.createNode('station');
const groups = { PORT_ALPHA_ROT: doc.createNode('port'), STBD_ALPHA_ROT: doc.createNode('starboard') };
const all = [];
scene.traverse((n) => all.push(n));
for (const [name, g] of Object.entries(groups)) {
  const src = all.find((n) => n.getName() === name);
  g.setMatrix(src.getWorldMatrix());
}
const inv = (m) => mat4.invert(mat4.create(), m);
// solar wing blankets use the shared Truss atlas: give them their own textured copy before the
// rest of the Truss parts lose the texture (see FLAT below)
const trussMat = root.listMaterials().find((m) => m.getName() === 'Truss');
const panelMat = trussMat.clone().setName('TrussPanels').setExtras({ panel: true }); // the app turns the wings by these
const radiatorMat = trussMat.clone().setName('TrussRadiators').setExtras({ radiator: true }); // extras: keeps dedup() from merging it back
let dropped = 0;
for (const n of all) {
  const own = /_Array(_\w+)?$/.test(n.getName()) ? panelMat : /_Radiator$/.test(n.getName()) ? radiatorMat : null;
  if (n.getMesh() && own)
    for (const p of n.getMesh().listPrimitives()) if (p.getMaterial() === trussMat) p.setMaterial(own);
  if (!n.getMesh() || new RegExp(process.env.DROP ?? 'Handrail|Details|Shutter').test(n.getName())) continue;
  // parts smaller than minSize (scene units; the station is ~10 across) vanish at our scale
  const b = getBounds(n);
  const d = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  if (d < +minSize) { dropped++; continue; }
  let owner = station, p = n;
  while (p) { if (groups[p.getName()]) { owner = groups[p.getName()]; break; } p = p.getParentNode(); }
  const local = owner === station ? n.getWorldMatrix() : mat4.multiply(mat4.create(), inv(owner.getMatrix()), n.getWorldMatrix());
  const copy = doc.createNode(n.getName()).setMesh(n.getMesh()).setMatrix(local);
  owner.addChild(copy);
}
console.log('dropped small parts:', dropped);
for (const n of scene.listChildren()) scene.removeChild(n);
scene.addChild(station);
// the source is mirrored (its root scale is negative: Columbus and Kibo swap sides); flip it back
station.setScale([1, 1, -1]);
station.addChild(groups.PORT_ALPHA_ROT);
station.addChild(groups.STBD_ALPHA_ROT);
// world matrices were in scene space and station has identity, so this holds

// colour only: drop normal / metallic / occlusion / emissive maps
for (const m of root.listMaterials()) {
  m.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
}
for (const t of root.listExtensionsUsed()) if (t.extensionName === 'EXT_texture_webp' || t.extensionName === 'KHR_draco_mesh_compression') t.dispose();
for (const p of root.listMeshes().flatMap((m) => m.listPrimitives()))
  for (const s of p.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s)) p.setAttribute(s, null);

// metal lattice parts (Truss/MLI materials): a plain colour instead of the texture, no normals (the app
// shades them flat). Without UV/normal seams the simplifier can really thin them out.
const FLAT = new RegExp(process.env.FLAT ?? '^(Truss|MLI\\.Generic|ELC_Base.*)$');
for (const m of root.listMaterials()) {
  if (!FLAT.test(m.getName())) continue;
  const t = m.getBaseColorTexture();
  if (t) {
    const { data, info } = await sharp(Buffer.from(t.getImage())).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
    const lin = (c) => Math.pow(c / 255, 2.2);
    const f = m.getBaseColorFactor();
    m.setBaseColorFactor([lin(data[0]) * f[0], lin(data[1]) * f[1], lin(data[2]) * f[2], 1]);
    m.setBaseColorTexture(null);
  }
  m.setExtras({ flat: true });
}
for (const p of root.listMeshes().flatMap((m) => m.listPrimitives()))
  if (p.getMaterial()?.getExtras()?.flat) { p.setAttribute('NORMAL', null); p.setAttribute('TEXCOORD_0', null); }

await MeshoptSimplifier.ready;
await doc.transform(
  prune(), dedup(), weld(),
  join({ keepNamed: false }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: +ratio, error: +error }),
  prune(),
);
// heavy parts (seams block the normal simplifier): sloppy simplification ignores topology
const SLOPPY_ABOVE = +(process.env.SLOPPY_ABOVE ?? 3000), SLOPPY_KEEP = +(process.env.SLOPPY_KEEP ?? 0.3);
for (const p of root.listMeshes().flatMap((m) => m.listPrimitives())) {
  const idx = p.getIndices(), n = idx.getCount() / 3;
  if (n <= SLOPPY_ABOVE) continue;
  const pos = p.getAttribute('POSITION').getArray();
  const target = Math.floor(Math.max(SLOPPY_ABOVE, n * SLOPPY_KEEP)) * 3;
  const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), pos, 3, null, target, 0.01);
  idx.setArray(out.length && out.length < 65536 * 3 && pos.length / 3 < 65536 ? new Uint16Array(out) : new Uint32Array(out));
  compactPrimitive(p);
}
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [+tex, +tex], quality: 78 }),
  unpartition(),
  prune(),
);
// textureCompress leaves some WebP behind; Safari 12 can't read WebP, so convert those by hand
for (const t of root.listTextures()) {
  if (t.getMimeType() === 'image/jpeg') continue;
  const img = await sharp(Buffer.from(t.getImage())).resize(+tex, +tex, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#808080' }).jpeg({ quality: 78 }).toBuffer();
  t.setImage(new Uint8Array(img)).setMimeType('image/jpeg').setURI('');
}
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'EXT_texture_webp') e.dispose();
await doc.transform(prune(), dedup());
await MeshoptEncoder.ready;
if (process.env.MESHOPT !== '0') await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
else await doc.transform(quantize());
io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(output, doc);
