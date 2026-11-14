// Renderer, sky, lighting and the static airport: runway, taxiway, apron, stands,
// cargo terminal, inbound belt, accumulation area and the exception desk.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky } from 'three/addons/objects/Sky.js';
import * as T from './textures.js';
import { RUNWAY_Z, TAXI_Z, TAXI_IN_Z, STAND_Z, RUNWAY_HALF, THRESHOLD_E, taxiLineCurves, exitFor } from './layout.js';

const deg = Math.PI / 180;

function decalMat(map, { color = 0xffffff, opacity = 1, offset = -2 } = {}) {
  return new THREE.MeshStandardMaterial({
    map, color, transparent: true, opacity, roughness: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
}

function flat(w, d, mat, x, z, y = 0.02, rot = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, y, z); m.receiveShadow = true;
  return m;
}

// Flat ribbon that follows a curve (painted taxi lines).
function ribbon(curve, width, mat, y = 0.05, samples = 80) {
  const pos = [], idx = [];
  const pts = curve.getSpacedPoints(samples);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    const n = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(width / 2);
    pos.push(pts[i].x + n.x, y, pts[i].z + n.z, pts[i].x - n.x, y, pts[i].z - n.z);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}

function noise2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s);
}
function smoothNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  const a = noise2(xi, zi), b = noise2(xi + 1, zi), c = noise2(xi, zi + 1), d = noise2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}
function fbm(x, z) { let s = 0, a = 1, f = 1; for (let i = 0; i < 5; i++) { s += a * smoothNoise(x * f, z * f); a *= 0.5; f *= 2.1; } return s / 1.94; }

function mountains(scene) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x55684f, roughness: 1, flatShading: true });
  const ranges = [[-600, -3600, 5200, 900, 520, 1], [3400, -2200, 2600, 1800, 360, 2], [-3600, -1800, 2400, 1600, 440, 3]];
  for (const [x, z, w, d, h, seed] of ranges) {
    const g = new THREE.PlaneGeometry(w, d, 90, 30); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i);
      const edge = Math.min(1, (1 - Math.abs(px) / (w / 2)) * 3) * Math.min(1, (1 - Math.abs(pz) / (d / 2)) * 3);
      p.setY(i, Math.max(0, edge) * h * Math.pow(fbm(px / 700 + seed * 10, pz / 700), 1.6) * 1.6 - 8);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.position.set(x, 0, z); scene.add(m);
  }
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}

export function createWorld(container, layout) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const css2d = new CSS2DRenderer();
  css2d.domElement.className = 'tag-layer';
  container.appendChild(css2d.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb9c8d2, 900, 5200);
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 12000);
  camera.position.copy(layout.camera.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(layout.camera.target);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 80 * deg; controls.minPolarAngle = 18 * deg;
  controls.minDistance = 40; controls.maxDistance = 650;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.update();

  // ---- sky, sun, image-based lighting ----------------------------------------------
  const sky = new Sky(); sky.scale.setScalar(10000); scene.add(sky);
  const su = sky.material.uniforms;
  su.turbidity.value = 5.5; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(10000); envScene.add(envSky);
  Object.assign(envSky.material.uniforms.turbidity, { value: 5.5 });
  let envRT = null;

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -340, right: 340, top: 260, bottom: -260, near: 10, far: 1400 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.5; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6450, 0.45); scene.add(hemi);

  // ---- terrain --------------------------------------------------------------------
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000),
    new THREE.MeshStandardMaterial({ color: 0x2b5566, roughness: 0.12, metalness: 0.0 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -2.5; scene.add(sea);
  const grassT = T.grass(); grassT.repeat.set(60, 30);
  const island = flat(3000, 820, new THREE.MeshStandardMaterial({ map: grassT, roughness: 0.95 }), 0, -70, -0.05);
  scene.add(island);
  const seawall = box(3000, 3, 820, new THREE.MeshStandardMaterial({ color: 0x8f8e86, roughness: 0.9 }), 0, -1.6, -70);
  seawall.castShadow = false; scene.add(seawall);
  mountains(scene);

  const asph = T.asphalt();
  const asphaltMat = (rx, ry) => { const t = asph.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.82 }); };
  scene.add(flat(RUNWAY_HALF * 2, 60, asphaltMat(140, 4), 0, RUNWAY_Z, 0.0));
  scene.add(flat(RUNWAY_HALF * 2 - 260, 66, asphaltMat(120, 5), -10, (TAXI_Z + TAXI_IN_Z) / 2, 0.01));
  scene.add(flat(150, 112, asphaltMat(10, 8), THRESHOLD_E + 24, (RUNWAY_Z + TAXI_Z) / 2, 0.012));
  for (const sx of layout.standX) { // rapid exits near each stand
    const ex = exitFor(sx) - 45;
    scene.add(flat(80, 60, asphaltMat(6, 5), ex, (RUNWAY_Z + TAXI_IN_Z) / 2, 0.011));
  }
  const conc = T.concrete();
  const apronW = Math.max(760, layout.spacing * layout.stands + 520);
  const cMap = conc.color.clone(); cMap.needsUpdate = true; cMap.repeat.set(apronW / 40, 270 / 40);
  const cRough = conc.rough.clone(); cRough.needsUpdate = true; cRough.repeat.set(apronW / 20, 270 / 20);
  scene.add(flat(apronW, 270, new THREE.MeshStandardMaterial({ map: cMap, roughnessMap: cRough, roughness: 1 }), 20, 0, 0.015));

  // ---- paint ----------------------------------------------------------------------
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf0b928, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8372d, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (let x = -RUNWAY_HALF + 140; x < RUNWAY_HALF - 140; x += 60) scene.add(flat(30, 0.9, white, x, RUNWAY_Z, 0.03));
  scene.add(flat(RUNWAY_HALF * 2 - 20, 0.9, white, 0, RUNWAY_Z - 27, 0.03), flat(RUNWAY_HALF * 2 - 20, 0.9, white, 0, RUNWAY_Z + 27, 0.03));
  for (const end of [-1, 1]) {
    for (let k = 0; k < 12; k++) scene.add(flat(30, 1.8, white, end * (RUNWAY_HALF - 40), RUNWAY_Z - 22 + k * 4, 0.03));
    for (const off of [190, 340, 490]) for (const zz of [-12, 12]) scene.add(flat(22, 3, white, end * (RUNWAY_HALF - off), RUNWAY_Z + zz, 0.03));
    const num = flat(30, 15, decalMat(T.label(end > 0 ? '25' : '07', { color: '#f4f4f0', font: 'bold 200px Helvetica, Arial' })), end * (RUNWAY_HALF - 110), RUNWAY_Z, 0.04, end > 0 ? Math.PI / 2 : -Math.PI / 2);
    scene.add(num);
  }
  scene.add(flat(RUNWAY_HALF * 2 - 280, 0.6, yellow, -10, TAXI_Z, 0.04), flat(RUNWAY_HALF * 2 - 280, 0.6, yellow, -10, TAXI_IN_Z, 0.04));
  for (const c of taxiLineCurves(layout)) scene.add(ribbon(c, 0.6, yellow, 0.05));

  // ---- stands -----------------------------------------------------------------------
  const standPads = [];
  layout.standX.forEach((sx, i) => {
    const outline = new THREE.Group();
    for (const [w, d, x, z] of [[70, 0.5, sx, STAND_Z - 36], [70, 0.5, sx, STAND_Z + 40], [0.5, 76, sx - 35, STAND_Z + 2], [0.5, 76, sx + 35, STAND_Z + 2]])
      outline.add(flat(w, d, white, x, z, 0.05));
    outline.add(flat(8, 0.6, red, sx, STAND_Z + 34, 0.05)); // stop bar
    const num = flat(14, 7, decalMat(T.label(String(i + 1), { color: '#f0b928', font: 'bold 200px Helvetica, Arial' })), sx + 10, STAND_Z + 36, 0.06);
    outline.add(num); scene.add(outline);
    const glow = flat(70, 76, new THREE.MeshBasicMaterial({ color: 0x18a06a, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), sx, STAND_Z + 2, 0.07);
    glow.receiveShadow = false; scene.add(glow); standPads.push(glow);
    // ground support equipment: tug at the nose, a cargo loader at the forward door
    const gse = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.55, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7 });
    const tug = new THREE.Group();
    tug.add(box(3.2, 1.4, 6, gse, 0, 1.0, 0), box(2.6, 1.2, 1.8, dark, 0, 2.2, -1.6));
    tug.position.set(sx + 8, 0, STAND_Z + 44); scene.add(tug);
    const loader = new THREE.Group();
    loader.add(box(4, 0.8, 9, dark, 0, 0.6, 0), box(3.6, 0.4, 7, gse, 0, 3.3, 0.6), box(0.4, 2.6, 0.4, gse, 1.5, 1.8, -2), box(0.4, 2.6, 0.4, gse, -1.5, 1.8, -2));
    loader.position.set(sx - 8.5, 0, STAND_Z + 22); scene.add(loader);
  });

  // ---- accumulation area & exception desk ------------------------------------------
  const cols = layout.stagingCols, pitch = layout.stagingPitch;
  for (const p of layout.staging) {
    for (const [w, d, dx, dz] of [[9, 0.25, 0, -5], [9, 0.25, 0, 5], [0.25, 10, -4.5, 0], [0.25, 10, 4.5, 0]])
      scene.add(flat(w, d, white, p.x + dx, p.z + dz, 0.05));
  }
  const s0 = layout.staging[0], sN = layout.staging[layout.staging.length - 1];
  const areaW = cols * pitch + 4, areaD = (sN.z - s0.z) + 18;
  const areaX = (s0.x + layout.staging[Math.min(cols - 1, layout.staging.length - 1)].x) / 2, areaZ = (s0.z + sN.z) / 2;
  scene.add(flat(areaW, areaD, new THREE.MeshStandardMaterial({ color: 0x2d7a5f, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), areaX, areaZ, 0.04));
  for (const [w, d, dx, dz] of [[areaW, 0.8, 0, -areaD / 2], [areaW, 0.8, 0, areaD / 2], [0.8, areaD, -areaW / 2, 0], [0.8, areaD, areaW / 2, 0]])
    scene.add(flat(w, d, yellow, areaX + dx, areaZ + dz, 0.05));
  scene.add(flat(54, 6.75, decalMat(T.label('ACCUMULATION AREA', { color: '#f4f4f0', font: 'bold 64px Helvetica, Arial', w: 1024, h: 128 })), areaX, areaZ + areaD / 2 + 5, 0.06));
  const ex0 = layout.exception[0], exN = layout.exception[layout.exception.length - 1];
  const exW = Math.abs(ex0.x - exN.x) + 9, exD = Math.abs(exN.z - ex0.z) + 9, exX = (ex0.x + exN.x) / 2, exZ = (ex0.z + exN.z) / 2;
  const hatchT = T.hatch(); hatchT.repeat.set(exW / 6, exD / 6);
  scene.add(flat(exW, exD, decalMat(hatchT, { opacity: 0.35 }), exX, exZ, 0.045));
  for (const [w, d, dx, dz] of [[exW, 0.8, 0, -exD / 2], [exW, 0.8, 0, exD / 2], [0.8, exD, -exW / 2, 0], [0.8, exD, exW / 2, 0]])
    scene.add(flat(w, d, red, exX + dx, exZ + dz, 0.05));
  scene.add(flat(34, 4.25, decalMat(T.label('EXCEPTION DESK', { color: '#e0574b', font: 'bold 64px Helvetica, Arial', w: 1024, h: 128 })), exX, exZ + exD / 2 + 4, 0.06));

  // ---- cargo terminal & inbound belt ---------------------------------------------------
  const bs = layout.beltStart, be = layout.beltEnd;
  const termX = bs.x + 58;
  const wall = T.corrugated('#dfe2df'); wall.repeat.set(16, 3);
  const termMat = new THREE.MeshStandardMaterial({ map: wall, roughness: 0.6, metalness: 0.25 });
  const term = box(120, 26, 110, [termMat, termMat, new THREE.MeshStandardMaterial({ color: 0x5d646a, roughness: 0.8 }), termMat, termMat, termMat], termX, 13, 70);
  scene.add(term);
  scene.add(box(1, 7, 7, new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 1 }), termX - 60.2, 3.5, bs.z));
  const stripe = new THREE.MeshStandardMaterial({ color: 0x006564, roughness: 0.5 });
  scene.add(box(120.4, 3, 110.4, stripe, termX, 22, 70));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(64, 8), decalMat(T.label('CARGO TERMINAL', { color: '#0b3e3d', font: 'bold 92px Helvetica, Arial', w: 1024, h: 128 }), { offset: -1 }));
  sign.position.set(termX, 16, 125.3); scene.add(sign);

  const beltDir = new THREE.Vector3().subVectors(be, bs); const beltLen = beltDir.length(); beltDir.normalize();
  const beltMid = new THREE.Vector3().addVectors(bs, be).multiplyScalar(0.5);
  const yaw = Math.atan2(beltDir.x, beltDir.z);
  const beltGroup = new THREE.Group(); beltGroup.position.set(beltMid.x, 0, beltMid.z); beltGroup.rotation.y = yaw;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9298, roughness: 0.4, metalness: 0.8 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf0b928, roughness: 0.5, metalness: 0.3 });
  const L = beltLen + 6;
  beltGroup.add(box(5.4, 0.5, L, steel, 0, 0.85, 0));
  for (const s of [-1, 1]) beltGroup.add(box(0.25, 0.7, L, frameMat, s * 2.8, 1.2, 0));
  for (let z = -L / 2 + 2; z < L / 2; z += 6) for (const s of [-1, 1]) beltGroup.add(box(0.3, 0.9, 0.3, steel, s * 2.4, 0.45, z));
  const beltTex = T.belt(); beltTex.repeat.set(1, L / 2);
  const beltTop = new THREE.Mesh(new THREE.PlaneGeometry(4.8, L), new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.6, metalness: 0.5 }));
  beltTop.rotation.x = -Math.PI / 2; beltTop.position.y = 1.11; beltTop.receiveShadow = true; beltGroup.add(beltTop);
  scene.add(beltGroup);
  const beltLabel = flat(28, 3.5, decalMat(T.label('INBOUND LINE', { color: '#f4f4f0', font: 'bold 64px Helvetica, Arial', w: 1024, h: 128 })), beltMid.x, beltMid.z + 6, 0.06);
  scene.add(beltLabel);

  // ---- tower, light masts ---------------------------------------------------------------
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.7 });
  const tx = layout.standX[0] - 240;
  scene.add(box(9, 60, 9, towerMat, tx, 30, 40));
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(10, 8, 7, 8), new THREE.MeshStandardMaterial({ color: 0x24434f, roughness: 0.05, metalness: 0.9 }));
  cab.position.set(tx, 63.5, 40); cab.castShadow = true; scene.add(cab);
  scene.add(box(22, 1.2, 22, towerMat, tx, 67.6, 40));
  const lamps = []; const mastMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: 0.5, metalness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff0c8, emissiveIntensity: 0 });
  const mastXs = [...layout.standX.slice(0, -1).map((x, i) => (x + layout.standX[i + 1]) / 2), layout.standX[0] - 40, layout.standX.at(-1) + 40];
  for (const [mx, mz] of [...mastXs.map(x => [x, STAND_Z - 34]), [areaX - 50, 112], [areaX + 50, 112]]) {
    scene.add(box(0.9, 34, 0.9, mastMat, mx, 17, mz));
    const head = box(4.2, 1.4, 1.4, lampMat, mx, 34.5, mz + 0.6); head.castShadow = false; scene.add(head);
    const spot = new THREE.SpotLight(0xffe7bf, 0, 220, 52 * deg, 0.55, 1.2);
    spot.position.set(mx, 34, mz); spot.target.position.set(mx, 0, mz + (mz < 0 ? 40 : -40));
    scene.add(spot, spot.target); lamps.push(spot);
  }

  // ---- time of day -------------------------------------------------------------------
  let lastSunKey = null;
  function setTimeOfDay(minuteOfDay) {
    const sunrise = 6 * 60 + 15, sunset = 18 * 60 + 50;
    const f = (minuteOfDay - sunrise) / (sunset - sunrise);
    const elev = f >= 0 && f <= 1 ? Math.sin(f * Math.PI) * 68 : -8 - 10 * Math.sin(Math.min(1, Math.abs(f < 0 ? f : f - 1) * 3));
    const azim = 100 + f * 160; // east → south → west
    const key = Math.round(elev * 2) + ':' + Math.round(azim);
    if (key === lastSunKey) return; lastSunKey = key;
    const phi = (90 - Math.max(elev, -6)) * deg, theta = azim * deg;
    const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    su.sunPosition.value.copy(dir); envSky.material.uniforms.sunPosition.value.copy(dir);
    const day = THREE.MathUtils.smoothstep(elev, -4, 10);
    sun.position.copy(dir.clone().multiplyScalar(700)).add(new THREE.Vector3(0, 0, -40));
    sun.target.position.set(0, 0, -40);
    sun.intensity = 3.4 * day;
    sun.color.setHSL(0.09, 0.55, 0.62 + 0.3 * THREE.MathUtils.smoothstep(elev, 0, 30));
    hemi.intensity = 0.12 + 0.4 * day;
    renderer.toneMappingExposure = 0.62 + (1 - day) * 0.25;
    const night = 1 - THREE.MathUtils.smoothstep(elev, -2, 8);
    for (const l of lamps) l.intensity = 700 * night;
    lampMat.emissiveIntensity = 4 * night;
    scene.fog.color.setHSL(0.57, 0.2 + 0.1 * day, 0.08 + 0.7 * day);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0, 1, 20000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.25 + 0.75 * day;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h); css2d.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();

  return {
    renderer, scene, camera, controls, css2d, standPads, setTimeOfDay,
    animateBelt(dt, speed) { beltTex.offset.y += dt * speed / 2; },
    render() { controls.update(); renderer.render(scene, camera); css2d.render(scene, camera); },
  };
}
