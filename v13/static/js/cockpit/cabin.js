import * as THREE from 'three';
import { label } from '../scene/textures.js';
import { FEET, KNOTS, RAD } from './flight.js';

export const SEAT = new THREE.Vector3(-0.67, 1.34, 0.86);
export const AISLE = new THREE.Vector3(0, 1.65, 1.95);
const WIDTH = 1.62;
const roundedGeometry = new Map();

function material(color, roughness = 0.83, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(parent, mat, w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function rounded(parent, mat, w, h, d, x, y, z, radius = 0.025) {
  const bevel = Math.min(w, h, d, radius * 2) * 0.46;
  const key = `${w}/${h}/${d}/${bevel}`;
  let geometry = roundedGeometry.get(key);
  if (!geometry) {
    const shape = new THREE.Shape();
    const a = w / 2 - bevel, b = h / 2 - bevel;
    shape.moveTo(-a, -b);
    shape.lineTo(a, -b);
    shape.lineTo(a, b);
    shape.lineTo(-a, b);
    shape.closePath();
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: d - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
      bevelSegments: 3, curveSegments: 1, steps: 1,
    });
    geometry.translate(0, 0, -(d - 2 * bevel) / 2);
    roundedGeometry.set(key, geometry);
  }
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function placard(parent, name, x, y, z, w, h, pitch = 0, color = '#b9c9ce') {
  const map = label(name, { color, font: 'bold 52px monospace', w: 384, h: 78 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, toneMapped: false,
  }));
  mesh.position.set(x, y, z);
  mesh.rotation.x = pitch;
  parent.add(mesh);
}

function fabricMaterial(color, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#bdc1c1';
  ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 2) {
    ctx.fillStyle = x % 4 ? '#a1a9aa' : '#d1d2d0';
    ctx.fillRect(x, 0, 1, 128);
  }
  ctx.globalAlpha = 0.42;
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = y % 4 ? '#717a7d' : '#dddfdc';
    ctx.fillRect(0, y, 128, 1);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(scale, scale);
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ color, map, bumpMap: map, bumpScale: 0.009, roughness: 0.95 });
}

function beam(parent, mat, start, end, width, depth = width) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const mid = a.clone().lerp(b, 0.5);
  const mesh = box(parent, mat, width, a.distanceTo(b), depth, mid.x, mid.y, mid.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  return mesh;
}

function quad(parent, mat, [a, b, c, d]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat);
  parent.add(mesh);
  return mesh;
}

function displaySurface() {
  const canvas = document.createElement('canvas');
  canvas.width = 352;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { ctx, map };
}

function pixelDisplay(parent, x, y, z, width, height, map) {
  rounded(parent, material(0x111d23, 0.49), width + 0.045, height + 0.043, 0.032, x, y, z - 0.019, 0.015);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
    map, toneMapped: false,
  }));
  mesh.position.set(x, y, z + 0.002);
  parent.add(mesh);
}

function text(ctx, value, x, y, color = '#b8f2d4', size = 20, align = 'center') {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.font = `600 ${size}px monospace`;
  ctx.fillText(value, x, y);
}

function line(ctx, points, color = '#d4f5de', width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.stroke();
}

function clear(ctx) {
  ctx.fillStyle = '#071117';
  ctx.fillRect(0, 0, 352, 320);
}

function paintPfd(ctx, flight) {
  clear(ctx);
  const cx = 176, cy = 151;
  ctx.save();
  ctx.beginPath();
  ctx.rect(67, 39, 218, 222);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-flight.bank);
  const horizon = flight.pitch / RAD * 4.8;
  ctx.fillStyle = '#2392c4';
  ctx.fillRect(-430, -380, 860, 380 + horizon);
  ctx.fillStyle = '#9d633e';
  ctx.fillRect(-430, horizon, 860, 380);
  line(ctx, [[-400, horizon], [400, horizon]], '#e9f7ed', 3);
  for (const pitch of [-20, -15, -10, -5, 5, 10, 15, 20]) {
    const y = horizon - pitch * 4.8;
    const width = pitch % 10 === 0 ? 28 : 16;
    line(ctx, [[-width, y], [width, y]]);
    if (pitch % 10 === 0) {
      text(ctx, Math.abs(pitch), -43, y + 4, '#eef5ed', 13);
      text(ctx, Math.abs(pitch), 43, y + 4, '#eef5ed', 13);
    }
  }
  ctx.restore();
  line(ctx, [[97, cy], [140, cy], [140, cy + 13]], '#ffd16b', 5);
  line(ctx, [[255, cy], [212, cy], [212, cy + 13]], '#ffd16b', 5);
  ctx.fillStyle = '#ffd16b';
  ctx.fillRect(cx - 3, cy - 3, 6, 6);

  for (const [start, value, step] of [[9, flight.ias, 10], [291, flight.altitude, 100]]) {
    ctx.fillStyle = '#263837';
    ctx.fillRect(start, 46, 52, 212);
    for (let k = -2; k <= 2; k++) {
      const tick = Math.floor(value / step) * step + k * step;
      if (tick < 0) continue;
      const y = cy + (value - tick) * 36 / step;
      if (y > 247 || y < 60) continue;
      text(ctx, tick, start + 24, y + 4, '#d0eadf', 13);
    }
    ctx.fillStyle = '#071217';
    ctx.fillRect(start - 2, cy - 14, 56, 28);
    ctx.strokeStyle = '#f6d273';
    ctx.strokeRect(start - 2, cy - 14, 56, 28);
    text(ctx, Math.round(value), start + 26, cy + 6, '#f7f7df', 16);
  }
  text(ctx, 'IAS', 34, 27, '#84bba9', 14);
  text(ctx, 'ATTITUDE', 176, 27, '#d6f4e6', 15);
  text(ctx, 'ALT', 316, 27, '#84bba9', 14);
  text(ctx, `HDG ${String(flight.course || 360).padStart(3, '0')}°`, 111, 292);
  text(ctx, `${Math.round(flight.velocity.y * FEET * 60)} FPM`, 257, 292);
}

function paintNav(ctx, flight) {
  clear(ctx);
  text(ctx, 'NAVIGATION', 176, 27, '#c7e7da', 15);
  ctx.save();
  ctx.translate(176, 155);
  ctx.strokeStyle = '#49685f';
  ctx.setLineDash([5, 5]);
  for (const r of [53, 94]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.rotate(-flight.heading);
  const airportX = -flight.position.x / 33;
  const airportZ = (-1800 - flight.position.z) / 33;
  ctx.strokeStyle = '#9fe5b9';
  if (Math.hypot(airportX, airportZ) < 140) ctx.strokeRect(airportX - 3, airportZ - 50, 6, 100);
  text(ctx, 'N', 0, -106, '#8bcaac', 15);
  ctx.restore();
  line(ctx, [[165, 162], [176, 144], [187, 162], [176, 158], [165, 162]], '#fff0b9', 2);
  text(ctx, `GS ${Math.round(flight.groundSpeed * KNOTS)} KT`, 82, 292);
  text(ctx, 'RANGE  2 NM', 255, 292, '#7eb39e', 16);
}

function paintSystems(ctx, flight) {
  clear(ctx);
  text(ctx, 'ENGINE / CONFIG', 176, 29, '#c7e7da', 15);
  for (const x of [98, 253]) {
    const y = 116;
    ctx.lineWidth = 6;
    for (const [color, end] of [['#283b38', Math.PI * 2.19], ['#94deb0', Math.PI * (0.82 + flight.power * 1.37)]]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 47, Math.PI * 0.82, end);
      ctx.stroke();
    }
    text(ctx, Math.round(flight.power * 100), x, y + 7, '#a5eabc', 27);
    text(ctx, flight.reversePower > 0.05 ? 'REV' : 'THR %', x, 175, '#b6cbbc', 14);
  }
  text(ctx, `GEAR  ${flight.gear > 0.97 ? 'DOWN' : flight.gear < 0.03 ? 'UP' : 'TRANSIT'}`, 22, 217, '#b7e1bd', 19, 'left');
  text(ctx, `FLAPS ${flight.flap || 'UP'}`, 22, 245, '#b7e1bd', 19, 'left');
  text(ctx, `SPEED BRAKE  ${flight.spoilers ? 'OUT' : 'IN'}`, 22, 273, '#b7e1bd', 19, 'left');
}

function shell(cabin) {
  const liner = material(0xafaeb0, 0.79);
  const floor = fabricMaterial(0x34404b, 14);
  const frame = material(0x6a7981, 0.52, 0.19);
  const trim = material(0x283641, 0.65);
  const side = material(0x7c878f, 0.74);
  const glass = new THREE.MeshStandardMaterial({
    color: 0xb2cee4, transparent: true, opacity: 0.060, roughness: 0.20, metalness: 0.28,
    side: THREE.DoubleSide, depthWrite: false,
  });
  glass.name = 'cockpit glass';
  liner.side = side.side = THREE.DoubleSide;

  box(cabin, floor, 3.24, 0.12, 4.36, 0, -0.06, 0.61);
  box(cabin, trim, 0.31, 0.005, 2.0, 0, 0.005, 1.72);
  for (const x of [-0.62, -0.37, 0.37, 0.62]) {
    box(cabin, frame, 0.024, 0.014, 1.54, x, 0.025, 1.37);
  }
  rounded(cabin, liner, 3.25, 0.14, 4.12, 0, 2.05, 0.80, 0.07);
  for (const sign of [-1, 1]) {
    const a = [sign * 0.022, 0.83, -1.76];
    const b = [sign * 1.18, 0.84, -1.43];
    const c = [sign * 1.25, 1.91, -1.00];
    const d = [sign * 0.025, 1.95, -1.25];
    const e = [sign * WIDTH, 0.86, -0.32];
    const f = [sign * WIDTH, 1.85, -0.24];
    const g = [sign * WIDTH, 0.87, 0.96];
    const h = [sign * WIDTH, 1.85, 0.96];
    quad(cabin, glass, [a, b, c, d]);
    quad(cabin, glass, [b, e, f, c]);
    quad(cabin, glass, [e, g, h, f]);
    quad(cabin, side, [[a[0], 0, a[2]], [b[0], 0, b[2]], b, a]);
    quad(cabin, side, [[b[0], 0, b[2]], [e[0], 0, e[2]], e, b]);
    quad(cabin, side, [[e[0], 0, e[2]], [g[0], 0, g[2]], g, e]);
    quad(cabin, liner, [d, c, [c[0], 2.01, -0.98], [d[0], 2.01, -1.30]]);
    quad(cabin, liner, [c, f, [f[0], 2.01, f[2]], [c[0], 2.01, -0.98]]);
    quad(cabin, liner, [f, h, [h[0], 2.01, h[2]], [f[0], 2.01, f[2]]]);
    box(cabin, side, 0.12, 2.03, 1.85, sign * WIDTH, 1.02, 1.88);
    rounded(cabin, frame, 0.21, 0.12, 1.62, sign * 1.51, 0.67, 0.18, 0.06);
    rounded(cabin, liner, 0.26, 0.06, 0.65, sign * 1.43, 0.64, 1.20);
    for (const [start, end, width] of [[b, c, 0.077], [e, f, 0.045], [g, h, 0.085],
      [a, b, 0.08], [b, e, 0.08], [e, g, 0.08], [d, c, 0.09], [c, f, 0.09], [f, h, 0.09]]) {
      beam(cabin, trim, start, end, width);
      if (start[1] > 1.80) beam(cabin, frame, start.map((v, i) => v + (i === 1 ? 0.043 : 0)),
        end.map((v, i) => v + (i === 1 ? 0.043 : 0)), width * 0.70);
    }
    rounded(cabin, trim, 0.035, 1.12, 0.97, sign * 1.55, 0.79, 2.15);
    rounded(cabin, frame, 0.055, 0.18, 0.42, sign * 1.515, 0.68, 2.12);
    for (let i = 0; i < 8; i++) {
      box(cabin, trim, 0.012, 0.008, 0.26, sign * 1.483, 0.73 - i * 0.014, 2.12);
    }
  }
  beam(cabin, trim, [0, 0.83, -1.75], [0, 2.015, -1.23], 0.093, 0.10);
}

function seating(cabin, x) {
  const fabric = fabricMaterial(0x4c697e, 3);
  const edging = material(0x293e4d);
  const frame = material(0x454f55, 0.50, 0.23);
  rounded(cabin, frame, 0.46, 0.22, 0.49, x, 0.14, 0.87);
  rounded(cabin, edging, 0.55, 0.15, 0.54, x, 0.39, 0.81, 0.11);
  rounded(cabin, fabric, 0.50, 0.12, 0.49, x, 0.47, 0.78, 0.11);
  const back = new THREE.Group();
  back.position.set(x, 0.78, 1.13);
  back.rotation.x = 0.13;
  cabin.add(back);
  rounded(back, edging, 0.54, 0.64, 0.16, 0, 0, 0, 0.10);
  rounded(back, fabric, 0.43, 0.53, 0.085, 0, 0.005, -0.065, 0.064);
  rounded(back, fabric, 0.34, 0.20, 0.14, 0, 0.35, 0.01, 0.085);
  rounded(back, frame, 0.25, 0.21, 0.021, 0, -0.13, 0.084);
  for (const sign of [-1, 1]) {
    const offset = sign * 0.29;
    rounded(cabin, edging, 0.074, 0.073, 0.36, x + offset, 0.67, 0.92, 0.045);
    box(cabin, frame, 0.055, 0.22, 0.052, x + offset, 0.57, 1.02);
    const belt = box(cabin, frame, 0.037, 0.47, 0.015, x + sign * 0.09, 0.83, 1.007);
    belt.rotation.z = sign * 0.22;
  }
}

function panelControls(parent, mat, x, y, z, columns, rows, spacing) {
  const colors = [0xc6cbc4, 0x596772, 0x88989c];
  const studs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.011, 0.019),
    material(0xffffff), columns * rows);
  const position = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      studs.setMatrixAt(index, position.makeTranslation(x + col * spacing, y, z + row * spacing));
      studs.setColorAt(index, color.setHex(colors[(row + col * 2) % 3]));
    }
  }
  parent.add(studs);
  rounded(parent, mat, columns * spacing, 0.018, rows * spacing,
    x + (columns - 1) * spacing / 2, y - 0.010, z + (rows - 1) * spacing / 2, 0.012);
}

function buildInterior(cabin) {
  const wall = material(0xaab4b9);
  const lower = material(0x6b7c84);
  const trim = material(0x3c505b, 0.62);
  const panel = material(0x637580, 0.76);
  const metal = material(0xafb8b6, 0.5, 0.26);
  const carpet = fabricMaterial(0x374751, 16);
  const seatFabric = fabricMaterial(0x355967, 3);
  const glass = new THREE.MeshBasicMaterial({
    color: 0x9cc5d8, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false,
  });
  const doors = [];
  function door(name, z, width, halfWidth, height) {
    const edge = (halfWidth + width / 2) / 2;
    for (const sign of [-1, 1]) {
      box(cabin, wall, halfWidth - width / 2, height, 0.105, sign * edge, height / 2, z);
      rounded(cabin, trim, 0.065, 1.99, 0.14, sign * (width / 2 + 0.02), 1, z, 0.025);
    }
    box(cabin, wall, width, height - 1.98, 0.108, 0, (height + 1.98) / 2, z);
    const hinge = new THREE.Group();
    hinge.position.set(-width / 2, 0, z);
    cabin.add(hinge);
    rounded(hinge, panel, width - 0.035, 1.95, 0.075, width / 2, 0.995, 0, 0.029);
    for (const sign of [-1, 1]) {
      rounded(hinge, metal, 0.15, 0.038, 0.035, width - 0.14, 0.98, sign * 0.055, 0.013);
      const plate = new THREE.Group();
      plate.position.set(width / 2, 1.66, sign * 0.040);
      if (sign < 0) plate.rotation.y = Math.PI;
      hinge.add(plate);
      placard(plate, name.toUpperCase(), 0, 0, 0, width * 0.64, 0.075);
    }
    doors.push({ name, z, width, hinge, open: false, angle: 0 });
  }

  const first = 2.73, second = 6.48, end = 25.0;
  door('Cockpit door', first, 1.02, 1.62, 2.05);
  door('Cabin door', second, 1.12, 2.18, 2.24);
  const rooms = new THREE.Group();
  cabin.add(rooms);
  const length = end - first;
  const cabinLength = end - second, spacing = cabinLength / 12;
  const rowPositions = Array.from({ length: 12 }, (_, row) => second + (row + 0.5) * spacing);
  box(rooms, carpet, 4.40, 0.11, length, 0, -0.055, first + length / 2);
  box(rooms, wall, 3.75, 0.085, length, 0, 2.25, first + length / 2);
  box(rooms, panel, 4.41, 2.23, 0.12, 0, 1.115, end);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xe4eff0 });
  for (const sign of [-1, 1]) {
    box(rooms, wall, 0.11, 2.22, second - first, sign * 2.18, 1.11, (first + second) / 2);
    // Fair the cabin shell down into the narrower cockpit.
    const fairing = quad(rooms, wall, [[sign * 1.62, 0, first], [sign * 2.18, 0, first + 0.56],
      [sign * 2.18, 2.23, first + 0.56], [sign * 1.62, 2.05, first]]);
    fairing.material.side = THREE.DoubleSide;
    for (const z of [3.82, 5.20]) {
      rounded(rooms, trim, 1.46, 2.07, 1.23, sign * 1.42, 1.04, z, 0.045);
      for (const row of [0.34, 0.81, 1.36, 1.82]) {
        rounded(rooms, panel, 0.025, 0.37, 1.09, sign * 0.682, row, z, 0.015);
        rounded(rooms, metal, 0.012, 0.033, 0.16, sign * 0.659, row + 0.097, z, 0.013);
      }
    }

    const middle = second + cabinLength / 2;
    box(rooms, lower, 0.105, 1.08, cabinLength, sign * 2.18, 0.54, middle);
    box(rooms, wall, 0.115, 0.64, cabinLength, sign * 2.18, 1.91, middle);
    rounded(rooms, panel, 0.53, 0.28, cabinLength - 0.39, sign * 1.883, 2.04, middle, 0.07);
    box(rooms, lampMat, 0.028, 0.013, cabinLength - 0.52, sign * 1.628, 1.902, middle);
    for (const [row, z] of rowPositions.entries()) {
      const gap = 0.44, pillarWidth = spacing - gap;
      box(rooms, wall, 0.112, 0.53, pillarWidth / 2, sign * 2.18, 1.34, z - (spacing + gap) / 4);
      box(rooms, wall, 0.112, 0.53, pillarWidth / 2, sign * 2.18, 1.34, z + (spacing + gap) / 4);
      box(rooms, glass, 0.008, 0.52, gap + 0.024, sign * 2.17, 1.341, z);
      for (const y of [1.085, 1.59]) box(rooms, trim, 0.04, 0.022, gap + 0.035, sign * 2.105, y, z);
      if (row === 0 || row === rowPositions.length - 1) continue;
      for (const distance of [0.81, 1.43]) {
        const x = sign * distance;
        box(rooms, trim, 0.44, 0.20, 0.32, x, 0.27, z);
        rounded(rooms, seatFabric, 0.53, 0.14, 0.56, x, 0.47, z - 0.12, 0.075);
        const back = rounded(rooms, seatFabric, 0.54, 0.78, 0.14, x, 0.88, z + 0.18, 0.08);
        back.rotation.x = 0.12;
        rounded(rooms, panel, 0.32, 0.29, 0.035, x, 0.88, z + 0.249, 0.024);
        rounded(rooms, trim, 0.071, 0.055, 0.47, x - sign * 0.29, 0.65, z - 0.09, 0.025);
      }
    }
  }
  for (const [z, intensity] of [[4.9, 4], [9.2, 6.5], [15.7, 7.8], [21.6, 6.8]]) {
    const light = new THREE.PointLight(0xdcecff, intensity, z < 6 ? 4 : 8);
    light.position.set(0, 2.09, z);
    rooms.add(light);
  }
  return { doors, end, rooms, seatRows: rowPositions.slice(1, -1) };
}

export function buildCabin(aircraft) {
  const cabin = new THREE.Group();
  cabin.position.set(0, 1.92, -21.9);
  aircraft.add(cabin);
  shell(cabin);
  const interior = buildInterior(cabin);

  const dash = material(0x435360, 0.68);
  const vinyl = material(0x202b35, 0.82);
  const metal = material(0x8a979d, 0.46, 0.31);
  const white = material(0xdad9c8, 0.62);
  const amber = material(0xc18c55, 0.58);
  const seam = material(0x596970);
  rounded(cabin, dash, 2.88, 0.47, 0.55, 0, 0.55, -1.168, 0.08);
  const hood = rounded(cabin, vinyl, 2.96, 0.104, 0.69, 0, 0.828, -1.16, 0.09);
  hood.rotation.x = -0.061;
  rounded(cabin, seam, 2.88, 0.035, 0.073, 0, 0.822, -0.804, 0.024);
  rounded(cabin, vinyl, 2.78, 0.18, 0.47, 0, 0.23, -1.13, 0.06);
  rounded(cabin, dash, 1.42, 0.098, 0.075, 0, 0.751, -0.823, 0.025);
  for (const [x, title] of [[-0.59, 'AIR DATA'], [-0.29, 'FLIGHT DIRECTOR'], [0.19, 'DISPLAY'], [0.47, 'PANEL DIM']]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.030, 16), metal);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, 0.752, -0.779);
    cabin.add(knob);
    rounded(cabin, vinyl, 0.12, 0.027, 0.008, x + 0.085, 0.751, -0.780, 0.008);
    placard(cabin, title, x + 0.086, 0.751, -0.775, 0.115, 0.025);
  }
  for (const x of [-1.37, -1.33, -1.29, 1.29, 1.33, 1.37]) {
    box(cabin, metal, 0.017, 0.095, 0.013, x, 0.58, -0.883);
  }

  const displays = new Map();
  for (const [x, w, name, paint] of [
    [-1.02, 0.355, 'PFD · CAPT', paintPfd], [-0.60, 0.355, 'NAV · CAPT', paintNav],
    [0, 0.385, 'ENGINE / SYSTEMS', paintSystems], [0.60, 0.355, 'NAV · F/O', paintNav],
    [1.02, 0.355, 'PFD · F/O', paintPfd],
  ]) {
    if (!displays.has(paint)) displays.set(paint, displaySurface());
    pixelDisplay(cabin, x, 0.549, -0.882, w, 0.306, displays.get(paint).map);
    placard(cabin, name, x, 0.365, -0.889, 0.166, 0.023);
    for (const side of [-1, 1]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.003, 8), metal);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x + side * (w / 2 + 0.011), 0.375, -0.884);
      cabin.add(screw);
    }
  }
  for (const x of [-0.67, 0.67]) seating(cabin, x);

  const columns = [-0.67, 0.67].map(x => {
    const pivot = new THREE.Group();
    cabin.add(pivot);
    pivot.position.set(x, 0.17, -0.47);
    beam(pivot, vinyl, [0, 0, 0], [0, 0.40, 0.11], 0.048);
    const wheel = new THREE.Group();
    pivot.add(wheel);
    wheel.position.set(0, 0.40, 0.11);
    rounded(wheel, vinyl, 0.30, 0.049, 0.055, 0, 0, 0, 0.026);
    rounded(wheel, dash, 0.112, 0.079, 0.053, 0, 0.012, 0.013, 0.03);
    placard(wheel, 'RELAY', 0, 0.014, 0.041, 0.06, 0.018);
    for (const sign of [-1, 1]) {
      const grip = rounded(wheel, vinyl, 0.047, 0.146, 0.048, sign * 0.148, 0.040, 0.01, 0.022);
      grip.rotation.z = -sign * 0.30;
      rounded(wheel, amber, 0.016, 0.015, 0.014, sign * 0.166, 0.097, 0.039, 0.008);
      rounded(cabin, metal, 0.10, 0.082, 0.034, x + sign * 0.12, 0.16, -0.76, 0.016);
    }
    return { pivot, wheel };
  });

  rounded(cabin, dash, 0.40, 0.46, 1.57, 0, 0.23, 0.03, 0.05);
  rounded(cabin, vinyl, 0.43, 0.047, 1.62, 0, 0.472, 0.03, 0.022);
  rounded(cabin, dash, 0.40, 0.069, 0.38, 0, 0.519, -0.30, 0.035);
  panelControls(cabin, vinyl, -0.137, 0.502, 0.28, 7, 8, 0.037);
  panelControls(cabin, vinyl, -0.134, 0.510, -0.66, 7, 4, 0.036);
  placard(cabin, 'RADIO MANAGEMENT', 0, 0.499, 0.238, 0.25, 0.028, -Math.PI / 2);
  placard(cabin, 'SPEEDBRK', -0.144, 0.556, -0.127, 0.103, 0.019, -Math.PI / 2);
  placard(cabin, 'FLAPS', 0.147, 0.556, -0.127, 0.102, 0.019, -Math.PI / 2);

  function lever(x, z, knob, w) {
    rounded(cabin, vinyl, w + 0.018, 0.019, 0.20, x, 0.556, z, 0.012);
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.56, z);
    cabin.add(pivot);
    box(pivot, metal, 0.023, 0.15, 0.024, 0, 0.075, 0);
    rounded(pivot, knob, w, 0.041, 0.074, 0, 0.153, 0, 0.019);
    return pivot;
  }
  const thrust = [lever(-0.046, -0.31, vinyl, 0.055), lever(0.036, -0.31, vinyl, 0.055)];
  const flaps = lever(0.148, -0.26, white, 0.042);
  const spoiler = lever(-0.147, -0.26, amber, 0.045);
  const gear = new THREE.Group();
  gear.position.set(0.32, 0.61, -0.884);
  beam(gear, metal, [0, 0, 0], [0, 0.038, 0.084], 0.017);
  rounded(gear, white, 0.049, 0.032, 0.037, 0, 0.044, 0.09, 0.016);
  cabin.add(gear);
  placard(cabin, 'LDG GEAR', 0.333, 0.677, -0.890, 0.097, 0.023);

  rounded(cabin, dash, 0.88, 0.105, 1.07, 0, 1.964, -0.37, 0.039);
  const overhead = new THREE.Group();
  overhead.position.set(0, 1.906, -0.37);
  overhead.rotation.z = Math.PI;
  cabin.add(overhead);
  for (const [x, z, name] of [
    [-0.34, -0.38, 'FLIGHT CONTROLS'], [0.048, -0.38, 'ELECTRICAL'],
    [-0.34, -0.075, 'EXTERIOR LIGHTS'], [0.048, -0.075, 'FUEL / HYD'],
    [-0.34, 0.23, 'AIR CONDITIONING'], [0.048, 0.23, 'CABIN / SIGNS'],
  ]) {
    panelControls(overhead, vinyl, x, 0.004, z, 6, 4, 0.048);
    placard(overhead, name, x + 0.12, 0.007, z - 0.038, 0.26, 0.030, -Math.PI / 2);
  }
  const lamp = new THREE.PointLight(0xffdec0, 2.35, 3.4);
  lamp.position.set(0.18, 1.66, -0.50);
  cabin.add(lamp);
  const fill = new THREE.PointLight(0xd1e9ff, 2.7, 4);
  fill.position.set(-0.35, 1.72, 1.64);
  cabin.add(fill);
  const landing = new THREE.SpotLight(0xe8f6ff, 21000, 165, 0.21, 0.55);
  landing.position.set(0, -1.5, -3.25);
  landing.target.position.set(0, -5.6, -61);
  aircraft.add(landing, landing.target);

  return {
    cabin,
    interior,
    animate(flight, input) {
      for (const lever of thrust) lever.rotation.x = 0.47 - 1.15 * flight.throttle + flight.reversePower * 0.37;
      flaps.rotation.x = -0.55 + 1.25 * flight.flapLift / 0.88;
      spoiler.rotation.x = -0.51 + 1.18 * flight.spoiler;
      gear.rotation.x = 0.8 * flight.gear - 0.4;
      for (const { pivot, wheel } of columns) {
        pivot.rotation.x = -0.17 * input.pitch;
        wheel.rotation.z = -0.44 * input.roll;
      }
      lamp.visible = flight.panelLights;
      landing.visible = flight.landingLights;
    },
    paint(flight) {
      for (const [paint, { ctx, map }] of displays) {
        paint(ctx, flight);
        map.needsUpdate = true;
      }
    },
  };
}
