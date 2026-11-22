import * as THREE from 'three';
import { preloadAircraft } from '../scene/aircraft.js';
import { asphalt, concrete, corrugated, grass, label } from '../scene/textures.js';
import { FIELD, RIDGES, WATER_LEVEL, ridgeHeight } from './flight.js';

const material = (color, options) => new THREE.MeshStandardMaterial({ color, ...options });
const random = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function surface(scene, w, d, x, z, surfaceMaterial, y = 0.015) {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), surfaceMaterial);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(x, y, z);
  scene.add(plane);
  return plane;
}

function block(parent, material, w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function paving(texture, width, length, tint = 0xffffff) {
  const map = texture.clone();
  map.repeat.set(width / 20, length / 20);
  return material(tint, { map, roughness: 1 });
}

function decal(color, options = {}) {
  return material(color, { roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1,
    polygonOffsetUnits: -2, depthWrite: false, ...options });
}

function batch(scene, geom, batchMaterial, placements) {
  const mesh = new THREE.InstancedMesh(geom, batchMaterial, placements.length);
  const object = new THREE.Object3D();
  placements.forEach(([x, y, z, w = 1, h = 1, d = 1], i) => {
    object.position.set(x, y, z);
    object.scale.set(w, h, d);
    object.updateMatrix();
    mesh.setMatrixAt(i, object.matrix);
  });
  scene.add(mesh);
  return mesh;
}

function landforms(scene) {
  const terrain = material(0xffffff, { roughness: 1, vertexColors: true });
  const shade = new THREE.Color();
  const trees = new THREE.Color(0x556f47);
  const dark = new THREE.Color(0x283f39);
  const rock = new THREE.Color(0x989388);
  const coast = new THREE.Color(0x8b8874);
  RIDGES.forEach(([x, z, width, depth], i) => {
    const geometry = new THREE.PlaneGeometry(width, depth, 122, 112);
    geometry.rotateX(-Math.PI / 2);
    const points = geometry.attributes.position;
    const colors = [];
    for (let j = 0; j < points.count; j++) {
      const px = x + points.getX(j), pz = z + points.getZ(j);
      const y = ridgeHeight(px, pz, i);
      const change = Math.abs(ridgeHeight(px + 19, pz, i) - y)
        + Math.abs(ridgeHeight(px, pz + 19, i) - y);
      points.setY(j, y);
      const variation = 0.50 + 0.20 * Math.sin(px * 0.011 + pz * 0.009)
        + 0.18 * Math.cos(pz * 0.025 - px * 0.007);
      shade.copy(dark).lerp(trees, variation)
        .lerp(rock, THREE.MathUtils.smoothstep(change, 16, 50) * 0.65)
        .lerp(coast, 1 - THREE.MathUtils.smoothstep(y, 1, 19));
      colors.push(shade.r, shade.g, shade.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, terrain);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
  });
}

function runway(scene) {
  const { runwayWidth: width, runwayLength: length, taxiX, apronX, apronZ, connectors } = FIELD;
  const apron = concrete().color;
  const asphaltMap = asphalt();
  const shoulder = paving(asphaltMap, 4, length, 0x9ba5a5);
  for (const side of [-1, 1]) surface(scene, 4, length, side * (width / 2 + 2), -length / 2, shoulder, 0);
  surface(scene, width, length, 0, -length / 2, paving(asphaltMap, width, length), 0);
  surface(scene, 24, 3480, taxiX, -1800, paving(asphaltMap, 24, 3480), 0);
  const apronEdge = taxiX + 12, apronWidth = apronX + 280 - apronEdge;
  surface(scene, apronWidth, 750, apronEdge + apronWidth / 2, apronZ, paving(apron, apronWidth, 750), 0);
  const white = [], yellow = [], rubber = [], edgeLights = [], taxiLights = [], thresholdLights = [];
  const tile = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  for (const z of connectors) {
    const first = width / 2, last = taxiX - 12;
    surface(scene, last - first, 24, (last + first) / 2, z, paving(asphaltMap, last - first, 24), 0.005);
    yellow.push([(taxiX + first) / 2, 0.024, z, taxiX - first, 1, 0.30]);
    for (let x = 35; x < taxiX; x += 15) {
      taxiLights.push([x, 0.11, z - 11.8], [x, 0.11, z + 11.8]);
    }
  }
  for (const x of [-width / 2 + 1.1, width / 2 - 1.1]) white.push([x, 0.033, -1800, 0.48, 1, 3490]);
  let previous = -60;
  for (const z of connectors) {
    yellow.push([taxiX, 0.024, (previous + z + 0.25) / 2, 0.43, 1, previous - z - 0.25]);
    previous = z - 0.25;
  }
  yellow.push([taxiX, 0.024, (previous - 3540) / 2, 0.43, 1, previous + 3540]);
  for (let z = -190; z >= -3410; z -= 60) white.push([0, 0.033, z, 0.9, 1, 29]);
  for (let z = -30; z >= -3570; z -= 30) {
    edgeLights.push([-30.9, 0.12, z], [30.9, 0.12, z]);
    taxiLights.push([taxiX - 12, 0.11, z], [taxiX + 12, 0.11, z]);
  }
  for (const direction of [1, -1]) {
    const threshold = direction === 1 ? -53 : -3547;
    for (let x = -28; x <= 28; x += 4) thresholdLights.push([x, 0.12, threshold]);
    for (let x = -25.5; x <= 26; x += 4.25) white.push([x, 0.033, threshold - direction * 16, 1.7, 1, 27]);
    for (const side of [-1, 1]) {
      white.push([side * 9, 0.033, threshold - direction * 310, 5.4, 1, 44]);
      for (const [offset, count] of [[145, 3], [445, 2], [595, 1]]) {
        for (let i = 0; i < count; i++) white.push([side * (8.8 + i * 2.4), 0.033, threshold - direction * offset, 1.45, 1, 22]);
      }
    }
    const number = document.createElement('canvas');
    number.width = 256;
    number.height = 256;
    const ctx = number.getContext('2d');
    ctx.fillStyle = '#dfe3dd';
    ctx.font = '900 150px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(direction === 1 ? '36' : '18', 128, 183);
    const map = new THREE.CanvasTexture(number);
    map.colorSpace = THREE.SRGBColorSpace;
    const mark = surface(scene, 12, 18, 0, threshold - direction * 70,
      decal(0xffffff, { map, transparent: true }), 0.035);
    mark.rotation.z = direction === 1 ? 0 : Math.PI;
  }
  const rand = random(4812);
  for (let i = 0; i < 230; i++) {
    const z = -(180 + rand() * 560);
    const x = (rand() > 0.5 ? 1 : -1) * (3.2 + rand() * 4.1);
    rubber.push([x, 0.018, z, 0.15 + rand() * 0.7, 1, 2 + rand() * 20]);
    rubber.push([x, 0.018, -3600 - z, 0.25 + rand() * 0.8, 1, 2 + rand() * 18]);
  }
  batch(scene, tile, decal(0xebe9da), white);
  batch(scene, tile, decal(0xd9ac34), yellow);
  batch(scene, tile, decal(0x202329, { transparent: true, opacity: 0.22 }), rubber);
  const fixture = new THREE.SphereGeometry(0.24, 7, 4);
  batch(scene, fixture, new THREE.MeshBasicMaterial({ color: 0xfff5c6 }), edgeLights);
  batch(scene, fixture, new THREE.MeshBasicMaterial({ color: 0x83c7ff }), taxiLights);
  batch(scene, fixture, new THREE.MeshBasicMaterial({ color: 0x72faab }), thresholdLights);

  // Precision approach lights, viewed from the direction of the approaching aircraft.
  const papi = [];
  for (const direction of [1, -1]) {
    const z = direction === 1 ? -365 : -3235;
    for (let i = 0; i < 4; i++) {
      const x = direction * (-38 - i * 8.3);
      block(scene, material(0x525457), 1.05, 0.56, 0.62, x, 0.29, z);
      const bulb = new THREE.MeshBasicMaterial({ color: 0xff4e38, toneMapped: false });
      block(scene, bulb, 0.73, 0.23, 0.09, x, 0.36, z + direction * 0.34);
      papi.push({ bulb, z, direction, angle: [3.5, 3.17, 2.83, 2.5][i] * Math.PI / 180 });
    }
  }
  return papi;
}

function buildings(scene) {
  const cladding = material(0xa9b1af);
  const sidingTexture = corrugated('#b7bdb9').clone();
  sidingTexture.repeat.set(14, 3);
  const siding = material(0xe0e3db, { map: sidingTexture, roughness: 0.86, metalness: 0.16 });
  const dark = material(0x4c5757);
  const glass = material(0x415f68, { metalness: 0.38, roughness: 0.26 });
  const roof = material(0x768381);
  const red = material(0xa85547);
  for (let i = 0; i < 5; i++) {
    const z = -650 - i * 120;
    block(scene, siding, 95, 16, 108, 613, 8, z);
    block(scene, roof, 99, 2, 111, 614, 17, z);
    const roofSlope = block(scene, roof, 49, 0.8, 111, 594, 19.1, z);
    roofSlope.rotation.z = 0.096;
    const otherSlope = block(scene, roof, 50, 0.8, 111, 642.5, 19.1, z);
    otherSlope.rotation.z = -0.096;
    block(scene, dark, 0.5, 11, 70, 565.2, 6, z);
    for (let j = -3; j <= 3; j++) block(scene, glass, 0.32, 2.8, 7, 565.1, 11.4, z + j * 12);
    for (let j = -3; j <= 3; j++) block(scene, siding, 0.55, 10.6, 0.22, 565, 6, z + j * 10);
    block(scene, red, 0.6, 1, 105, 565.2, 14.2, z);
    for (let j = -2; j <= 2; j++) {
      block(scene, cladding, 3.2, 2.7, 5.1, 530 - i * 8, 1.35, z + j * 6.2);
      block(scene, dark, 3.0, 0.48, 4.9, 530 - i * 8, 0.42, z + j * 6.2);
    }
  }
  block(scene, cladding, 12, 43, 13, 365, 21.5, -350);
  block(scene, dark, 21, 2.1, 17, 365, 41, -350);
  block(scene, glass, 20, 5, 16, 365, 44.5, -350);
  for (let i = -2; i <= 2; i++) block(scene, dark, 0.31, 5.3, 0.26, 354.99, 44.5, -350 + i * 3.15);
  block(scene, roof, 22, 1.6, 18, 365, 47.8, -350);
  block(scene, dark, 0.35, 7, 0.35, 368, 51.5, -352);
  for (const z of [-530, -735, -940, -1145, -1250]) {
    block(scene, dark, 0.32, 20, 0.32, 528, 10, z);
    block(scene, cladding, 3.4, 0.25, 1.0, 528, 20.1, z);
  }
}

function apronDetails(scene) {
  const asphaltMark = decal(0xc9a747);
  const paint = decal(0xe0dcd2);
  const sh = decal(0x192227, { opacity: 0.22, transparent: true });
  const poles = material(0x728186);
  const luminous = new THREE.MeshBasicMaterial({ color: 0xe3e9dd });
  const rand = random(90);
  for (let i = 0; i < 5; i++) {
    const z = -650 - i * 120;
    surface(scene, 55, 0.38, 384, z, asphaltMark, 0.024);
    surface(scene, 56, 92, 600, z + 12, sh, 0.019);
    for (const offset of [-36, 36]) surface(scene, 145, 0.29, 402, z + offset, paint, 0.025);
    for (const side of [-1, 1]) {
      block(scene, poles, 0.22, 14, 0.22, 520, 7, z + side * 46);
      block(scene, luminous, 1.6, 0.22, 0.56, 519.4, 14, z + side * 46);
    }
    for (let n = 0; n < 6; n++) {
      const width = 1.6 + rand() * 1.3, length = 3.4 + rand() * 2.5, lane = z + 38 - rand() * 12;
      const x = 459 + n * 8.2;
      block(scene, material(n % 2 ? 0xb8bdb6 : 0x7f9091), length, 1.63, width, x, 1.03, lane);
      block(scene, material(0x252a2a), length * 0.80, 0.38, width * 0.99, x, 0.21, lane);
    }
  }
  const sign = label('A   36–18', { color: '#ffe171', font: 'bold 58px monospace', w: 384, h: 96 });
  const board = material(0x202320);
  const signFace = new THREE.MeshBasicMaterial({ map: sign, transparent: true, depthWrite: false, toneMapped: false });
  for (const z of FIELD.connectors) {
    block(scene, board, 5.5, 0.93, 0.40, 46, 0.60, z + 15);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5.15, 0.81), signFace);
    face.position.set(46, 0.60, z + 15.21);
    scene.add(face);
  }

  preloadAircraft(['a350-cathay.glb', 'b747-8f.glb']).then(templates => {
    [[0, 448, -650, 66.8, 64.8], [1, 458, -890, 76, 68.4], [0, 444, -1130, 66.8, 64.8]]
      .forEach(([type, x, z, length, span]) => {
        const template = templates[type];
        if (!template) return;
        const airframe = template.clone(true);
        const sx = span / template.userData.span, sz = length / template.userData.length;
        airframe.scale.set(sx, (sx + sz) / 2, sz);
        airframe.rotation.y = Math.PI / 2;
        airframe.position.set(x, 0.01, z);
        scene.add(airframe);
        surface(scene, length * 0.68, span * 0.48, x + 13, z + 5, sh, 0.018);
      });
  });
}

function windsock(scene) {
  const stand = new THREE.Group();
  stand.position.set(-72, 0, -320);
  scene.add(stand);
  const white = material(0xe1ded3);
  const red = material(0xd66943);
  block(stand, white, 0.17, 6.2, 0.17, 0, 3.1, 0);
  block(stand, red, 0.19, 1.5, 0.19, 0, 5.1, 0);
  const arm = new THREE.Group();
  arm.position.y = 6.02;
  arm.rotation.y = -0.91;
  stand.add(arm);
  const geometry = new THREE.CylinderGeometry(0.29, 0.12, 1.76, 26, 5, true);
  for (let i = 0; i < geometry.groups.length; i++) geometry.groups[i].materialIndex = 0;
  geometry.clearGroups();
  for (let stripe = 0; stripe < 5; stripe++) geometry.addGroup(stripe * 156, 156, stripe % 2);
  const sleeve = new THREE.Mesh(geometry, [material(0xe47240, { side: THREE.DoubleSide }),
    material(0xdbdfd6, { side: THREE.DoubleSide })]);
  sleeve.rotation.z = -Math.PI / 2;
  sleeve.position.x = -0.88;
  arm.add(sleeve);
  return arm;
}

function seawater(scene) {
  const water = material(0xffffff, { roughness: 0.52, metalness: 0.12 });
  const elapsed = { value: 0 };
  const shore = { value: new THREE.Vector4(...FIELD.islandBounds) };
  water.onBeforeCompile = shader => {
    shader.uniforms.uSeaTime = elapsed;
    shader.uniforms.uShore = shore;
    shader.vertexShader = 'varying vec2 vSea;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvSea = (modelMatrix * vec4(position, 1.0)).xz;',
    );
    shader.fragmentShader = 'varying vec2 vSea; uniform float uSeaTime; uniform vec4 uShore;\n'
      + shader.fragmentShader.replace(
      '#include <color_fragment>', `#include <color_fragment>
      vec2 p = vSea;
      float swell = sin(p.x * 0.039 + p.y * 0.061 + uSeaTime * 0.72)
        + 0.55 * cos(p.x * 0.084 - p.y * 0.052 - uSeaTime * 0.9);
      float ripple = sin(p.x * 0.47 + p.y * 0.22 + swell * 1.3 + uSeaTime * 1.4);
      float distanceToEye = length(cameraPosition.xz - p);
      float gloss = (0.5 + 0.5 * ripple) * (1.0 - smoothstep(180.0, 1250.0, distanceToEye));
      float glaze = 0.38 + 0.29 * swell;
      diffuseColor.rgb *= mix(vec3(0.029, 0.100, 0.124), vec3(0.095, 0.222, 0.255),
        clamp(glaze + gloss * 0.30, 0.0, 1.0));
      vec2 shore = max(max(uShore.xz - p, p - uShore.yw), vec2(0.0));
      float wash = (1.0 - smoothstep(0.8, 8.0, length(shore))) * (0.5 + 0.5 * ripple);
      diffuseColor.rgb += vec3(0.06, 0.09, 0.085) * wash;
      `,
    );
  };
  const plane = surface(scene, 95000, 95000, 0, 0, water, WATER_LEVEL);
  return { elapsed, plane };
}

function turf(width, length) {
  const ground = paving(grass(), width, length, 0xb8ba9c);
  ground.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vField;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvField = (modelMatrix * vec4(position, 1.0)).xz;',
    );
    shader.fragmentShader = 'varying vec2 vField;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>', `#include <color_fragment>
      float colorVariation = 0.52 + 0.23 * sin(vField.x * 0.013 + cos(vField.y * 0.009))
        + 0.12 * sin(vField.y * 0.021);
      float stripes = sin(vField.x * 0.41 + sin(vField.y * 0.004) * 0.22);
      float mow = 0.05 * smoothstep(-0.25, 0.25, stripes);
      diffuseColor.rgb *= mix(vec3(0.71, 0.79, 0.68), vec3(1.18, 1.11, 1.04), colorVariation) + mow;
      `,
    );
  };
  return ground;
}

export function buildAirport(scene) {
  scene.background = new THREE.Color(0xaac5d5);
  scene.fog = new THREE.FogExp2(0xaabfca, 0.000112);
  new THREE.TextureLoader().load('/assets/cockpit/coastal-sky.jpg', texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
    scene.backgroundIntensity = 0.95;
    scene.backgroundRotation.y = Math.PI * 0.36;
    scene.environmentIntensity = 0.27;
    scene.environmentRotation.copy(scene.backgroundRotation);
  });
  const sun = new THREE.Vector3(-0.74, 0.51, -0.36).normalize();
  scene.add(new THREE.HemisphereLight(0xd9eaff, 0x7e8179, 1.56));
  const daylight = new THREE.DirectionalLight(0xffecd9, 2.25);
  daylight.position.copy(sun);
  scene.add(daylight);

  const sea = seawater(scene);
  const [west, east, north, south] = FIELD.islandBounds;
  const width = east - west, length = south - north;
  const centerX = (west + east) / 2, centerZ = (north + south) / 2;
  surface(scene, width, length, centerX, centerZ, turf(width, length), -0.04);
  const seawall = material(0x87877c);
  const band = material(0x686d68);
  const wallHeight = -WATER_LEVEL + 0.08;
  for (const z of [north, south]) {
    const sign = z === north ? -1 : 1;
    block(scene, seawall, width, wallHeight, 0.9, centerX, WATER_LEVEL / 2, z + sign * 0.45);
    block(scene, band, width, 0.42, 2.4, centerX, WATER_LEVEL + 0.03, z + sign * 1.2);
  }
  for (const x of [west, east]) {
    const sign = x === west ? -1 : 1;
    block(scene, seawall, 0.9, wallHeight, length, x + sign * 0.45, WATER_LEVEL / 2, centerZ);
    block(scene, band, 2.4, 0.42, length, x + sign * 1.2, WATER_LEVEL + 0.03, centerZ);
  }
  landforms(scene);
  const papi = runway(scene);
  buildings(scene);
  apronDetails(scene);
  const sock = windsock(scene);
  return {
    update(flight, time) {
      sea.elapsed.value = time;
      sea.plane.position.x = flight.position.x;
      sea.plane.position.z = flight.position.z;
      sock.rotation.z = 0.19 + Math.sin(time * 2.6) * 0.055;
      for (const { bulb, z, direction, angle } of papi) {
        const distance = direction * (flight.position.z - z);
        const above = distance > 0 && Math.atan2(flight.position.y + 3.2, distance) >= angle;
        bulb.color.setHex(above ? 0xfff2ce : 0xf04931);
      }
    },
  };
}
