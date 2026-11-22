import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAN, WHEEL_HEIGHT } from './flight.js';

function keepTriangles(geometry, keepVertex) {
  const position = geometry.getAttribute('position');
  const source = geometry.getIndex();
  const selected = [];
  for (let i = 0; i < source.count; i += 3) {
    const a = source.getX(i), b = source.getX(i + 1), c = source.getX(i + 2);
    if ([a, b, c].every(index => keepVertex(
      position.getX(index), position.getY(index), position.getZ(index),
    ))) selected.push(a, b, c);
  }
  geometry.setIndex(selected);
}

export async function attachWings(aircraft) {
  const response = await fetch('/assets/aircraft/a330-300-cathay.glb');
  if (!response.ok) throw new Error(`Airframe asset returned HTTP ${response.status}`);
  const { scene } = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '/assets/aircraft/');
  // The exterior shell has opaque windows. Use its outboard geometry around the
  // walkable cabin, preserving the original wing, winglets and nacelle materials.
  const wing = scene.children.find(node => node.userData.name === 'A330 wings_main');
  const tips = scene.children.find(node => node.userData.name === 'Jade');
  if (!wing?.isMesh || !tips?.isMesh) throw new Error('Missing wing geometry in the player airframe');
  keepTriangles(tips.geometry, x => Math.abs(x) > 23);
  const tipPositions = tips.geometry.getAttribute('position');
  const tipIndices = tips.geometry.getIndex();
  let halfSpan = 0;
  for (let i = 0; i < tipIndices.count; i++) {
    halfSpan = Math.max(halfSpan, Math.abs(tipPositions.getX(tipIndices.getX(i))));
  }
  if (!halfSpan) throw new Error('Missing wingtip geometry in the player airframe');

  const engineMeshes = new Set(['A330 343_blank', 'Fuselage white', 'Metal']);
  for (const node of [...scene.children]) {
    if (node === wing || node === tips) continue;
    if (node.isMesh && engineMeshes.has(node.userData.name)) {
      keepTriangles(node.geometry, (x, y, z) =>
        Math.abs(x) > 6.6 && Math.abs(x) < 11.8 && y < 0.15 && z > -5 && z < 4.2);
    } else {
      scene.remove(node);
    }
  }
  scene.name = 'Player wings and engines';
  scene.position.y = -WHEEL_HEIGHT;
  scene.scale.x = SPAN / (2 * halfSpan);
  aircraft.add(scene);
}
