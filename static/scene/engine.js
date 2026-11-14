/* RELAY render engine · native WebGL2, no external libraries.
   A small physically based forward renderer for the ground twin:
   instanced meshes, a sun shadow map, a depth pre-pass with ambient occlusion,
   HDR + MSAA colour, bloom, filmic tone mapping, a time-of-day sky, local lamps and
   wet-surface reflections. The scene code (ground.js) only describes what is where. */
(() => {
'use strict';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const normalize = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---- matrices: column-major Float32Array(16) ----------------------------------------
const mat = {
  mul(a, b, out = new Float32Array(16)) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return out;
  },
  perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  },
  look(eye, target, up = [0, 1, 0]) {
    const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = normalize([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  invert(m, out = new Float32Array(16)) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06 || 1);
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },
};

// ---- meshes: interleaved position + normal ---------------------------------------------
const TAU = Math.PI * 2;

function builder() {
  const data = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Flat triangle; `outward` flips the winding so the normal points away from the origin.
  function flat(a, b, c, outward = false) {
    let n = cross(sub(b, a), sub(c, a));
    const length = Math.hypot(...n);
    if (length < 1e-10) return;
    if (outward && n[0] * (a[0] + b[0] + c[0]) + n[1] * (a[1] + b[1] + c[1]) + n[2] * (a[2] + b[2] + c[2]) < 0) {
      [b, c] = [c, b];
      n = n.map(v => -v);
    }
    for (const p of [a, b, c]) data.push(p[0], p[1], p[2], n[0] / length, n[1] / length, n[2] / length);
  }
  // Triangle with explicit per-vertex normals.
  function tri(a, na, b, nb, c, nc) {
    // Wind the triangle so its face agrees with the supplied normals.
    const g = cross(sub(b, a), sub(c, a));
    if (g[0] * (na[0] + nb[0] + nc[0]) + g[1] * (na[1] + nb[1] + nc[1]) + g[2] * (na[2] + nb[2] + nc[2]) < 0) {
      [b, c, nb, nc] = [c, b, nc, nb];
    }
    data.push(...a, ...na, ...b, ...nb, ...c, ...nc);
  }
  function quad(a, na, b, nb, c, nc, d, nd) { tri(a, na, b, nb, c, nc); tri(a, na, c, nc, d, nd); }
  return {data, flat, tri, quad, done: () => new Float32Array(data)};
}

// Surface of revolution around `axis` ('y' or 'z') from a profile of [radius, height] points,
// listed from the top of the shape to the bottom so that normals face outward.
function revolve(profile, segments, axis = 'y', smoothProfile = true) {
  const b = builder();
  const place = (r, h, angle) => axis === 'y'
    ? [r * Math.cos(angle), h, r * Math.sin(angle)]
    : [r * Math.cos(angle), r * Math.sin(angle), h];
  const normals = profile.map((_, i) => {
    const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(profile.length - 1, i + 1)];
    const dr = next[0] - prev[0], dh = next[1] - prev[1], l = Math.hypot(dr, dh) || 1;
    return [-dh / l, dr / l];
  });
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, h0] = profile[i], [r1, h1] = profile[i + 1];
    let n0 = normals[i], n1 = normals[i + 1];
    if (!smoothProfile) { const dr = r1 - r0, dh = h1 - h0, l = Math.hypot(dr, dh) || 1; n0 = n1 = [-dh / l, dr / l]; }
    for (let j = 0; j < segments; j++) {
      const a0 = TAU * j / segments, a1 = TAU * (j + 1) / segments;
      const p = [place(r0, h0, a0), place(r0, h0, a1), place(r1, h1, a1), place(r1, h1, a0)];
      const n = [place(n0[0], n0[1], a0), place(n0[0], n0[1], a1), place(n1[0], n1[1], a1), place(n1[0], n1[1], a0)];
      b.quad(p[0], n[0], p[1], n[1], p[2], n[2], p[3], n[3]);
    }
  }
  return b.done();
}

const meshes = {
  box() {
    const b = builder();
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const corner = (su, sv) => { const p = [0, 0, 0]; p[axis] = sign * .5; p[u] = su * .5; p[v] = sv * .5; return p; };
      b.flat(corner(-1, -1), corner(1, -1), corner(1, 1), true);
      b.flat(corner(-1, -1), corner(1, 1), corner(-1, 1), true);
    }
    return b.done();
  },
  // Cube with bevelled edges: the bevels catch a highlight that hard edges never do.
  cbox(c = .07) {
    const b = builder(), h = .5, i = .5 - c;
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const corner = (su, sv) => { const p = [0, 0, 0]; p[axis] = sign * h; p[u] = su * i; p[v] = sv * i; return p; };
      b.flat(corner(-1, -1), corner(1, -1), corner(1, 1), true);
      b.flat(corner(-1, -1), corner(1, 1), corner(-1, 1), true);
    }
    for (const axis of [0, 1, 2]) for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const point = (along, onU) => { const p = [0, 0, 0]; p[axis] = along * i; p[u] = su * (onU ? h : i); p[v] = sv * (onU ? i : h); return p; };
      b.flat(point(-1, true), point(1, true), point(1, false), true);
      b.flat(point(-1, true), point(1, false), point(-1, false), true);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      b.flat([sx * h, sy * i, sz * i], [sx * i, sy * h, sz * i], [sx * i, sy * i, sz * h], true);
    }
    return b.done();
  },
  cyl: () => revolve([[0, .5], [.5, .5], [.5, -.5], [0, -.5]], 24, 'y', false),
  // Tyre with rounded shoulders, axle along z.
  wheel: () => revolve([[.3, .5], [.44, .5], [.5, .36], [.5, -.36], [.44, -.5], [.3, -.5]], 20, 'z'),
  sphere() {
    const profile = [];
    for (let k = 0; k <= 10; k++) { const a = Math.PI * k / 10; profile.push([.5 * Math.sin(a), .5 * Math.cos(a)]); }
    return revolve(profile, 18, 'y');
  },
  // Limb: pivot at the top (y = 0), extends to y = -1, rounded both ends.
  limb() {
    const profile = [];
    for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 * k / 4; profile.push([.5 * Math.sin(a), -.12 * (1 - Math.cos(a))]); }
    for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 * k / 4; profile.push([.5 * Math.cos(a), -.88 - .12 * Math.sin(a)]); }
    return revolve(profile, 12, 'y');
  },
  cone: () => revolve([[0, 1], [.1, 1], [.5, 0], [0, 0]], 16, 'y', false),
  dome() {
    const profile = [];
    for (let k = 0; k <= 6; k++) { const a = Math.PI / 2 * k / 6; profile.push([.5 * Math.sin(a), .5 * Math.cos(a)]); }
    return revolve(profile, 20, 'y');
  },
  quad() {
    const b = builder(), up = [0, 1, 0];
    b.quad([-.5, 0, -.5], up, [-.5, 0, .5], up, [.5, 0, .5], up, [.5, 0, -.5], up);
    return b.done();
  },
  // Barrel vault: half-ellipse roof with the ridge along x, base at y = 0.
  barrel() {
    const b = builder(), steps = 14;
    const ring = k => { const a = Math.PI * k / steps; return [[-Math.cos(a) * .5, Math.sin(a)], [-Math.cos(a), Math.sin(a) * .5]]; };
    for (let k = 0; k < steps; k++) {
      const [[z0, y0], [nz0, ny0]] = ring(k), [[z1, y1], [nz1, ny1]] = ring(k + 1);
      const l0 = Math.hypot(nz0, ny0), l1 = Math.hypot(nz1, ny1);
      const n0 = [0, ny0 / l0, nz0 / l0], n1 = [0, ny1 / l1, nz1 / l1];
      b.quad([-.5, y0, z0], n0, [.5, y0, z0], n0, [.5, y1, z1], n1, [-.5, y1, z1], n1);
      for (const x of [-.5, .5]) {
        const a = [x, 0, 0], p = [x, y0, z0], q = [x, y1, z1], n = [Math.sign(x), 0, 0];
        b.tri(a, n, p, n, q, n);
      }
    }
    return b.done();
  },
  // Gable roof: ridge along x at y = 1.
  gable() {
    const b = builder();
    for (const s of [-1, 1]) {
      b.flat([-.5, 0, s * .5], [.5, 0, s * .5], [.5, 1, 0], true);
      b.flat([-.5, 0, s * .5], [.5, 1, 0], [-.5, 1, 0], true);
      b.flat([s * .5, 0, -.5], [s * .5, 0, .5], [s * .5, 1, 0], true);
    }
    return b.done();
  },
};

// ---- instance storage ----------------------------------------------------------------
const STRIDE = 24;   // mat4 + colour/emissive + roughness/metalness/nightGlow/kind

class InstanceSet {
  constructor() { this.batches = new Map(); this.version = 0; }
  begin() { for (const batch of this.batches.values()) batch.count = 0; this.version++; }
  batch(name) {
    let batch = this.batches.get(name);
    if (!batch) { batch = {data: new Float32Array(STRIDE * 64), count: 0, buffer: null, vao: null, uploaded: -1}; this.batches.set(name, batch); }
    if ((batch.count + 1) * STRIDE > batch.data.length) {
      const grown = new Float32Array(batch.data.length * 2);
      grown.set(batch.data);
      batch.data = grown;
    }
    return batch;
  }
}

/* Pen: a matrix stack that writes instances. Local frames use +x forward, +y up, +z right;
   `yaw` turns about y so that +x points along (cos yaw, 0, sin yaw). */
class Pen {
  constructor() {
    this.stack = new Float32Array(12 * 32);   // rotation columns X, Y, Z and translation
    this.depth = 0;
    this.set = null;
    this.reset();
  }
  reset() { this.depth = 0; this.stack.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 0); return this; }
  into(set) { this.set = set; return this.reset(); }
  // current = current · T(t) · Ry(yaw) · Rz(pitch) · Rx(roll) · S(scale)
  push(tx = 0, ty = 0, tz = 0, yaw = 0, pitch = 0, roll = 0, scale = 1) {
    const s = this.stack, o = this.depth * 12, n = o + 12;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // Local rotation columns.
    const k = scale;
    const xx = cy * cp * k, xy = sp * k, xz = sy * cp * k;
    const yx = (-cy * sp * cr - sy * sr) * k, yy = cp * cr * k, yz = (-sy * sp * cr + cy * sr) * k;
    const zx = (cy * sp * sr - sy * cr) * k, zy = -cp * sr * k, zz = (sy * sp * sr + cy * cr) * k;
    for (let r = 0; r < 3; r++) {
      const a = s[o + r], b = s[o + 3 + r], c = s[o + 6 + r];
      s[n + r] = a * xx + b * xy + c * xz;
      s[n + 3 + r] = a * yx + b * yy + c * yz;
      s[n + 6 + r] = a * zx + b * zy + c * zz;
      s[n + 9 + r] = a * tx + b * ty + c * tz + s[o + 9 + r];
    }
    this.depth++;
    return this;
  }
  pop() { this.depth--; return this; }
  // World position of a local point in the current frame.
  point(x, y, z) {
    const s = this.stack, o = this.depth * 12;
    return [s[o] * x + s[o + 3] * y + s[o + 6] * z + s[o + 9], s[o + 1] * x + s[o + 4] * y + s[o + 7] * z + s[o + 10],
      s[o + 2] * x + s[o + 5] * y + s[o + 8] * z + s[o + 11]];
  }
  // Add `mesh` scaled to (sx, sy, sz) with its origin at local (x, y, z).
  put(mesh, sx, sy, sz, x, y, z, color, material = MATERIAL.paint, emissive = 0) {
    const batch = this.set.batch(mesh), d = batch.data, i = batch.count * STRIDE;
    const s = this.stack, o = this.depth * 12;
    d[i] = s[o] * sx; d[i + 1] = s[o + 1] * sx; d[i + 2] = s[o + 2] * sx; d[i + 3] = 0;
    d[i + 4] = s[o + 3] * sy; d[i + 5] = s[o + 4] * sy; d[i + 6] = s[o + 5] * sy; d[i + 7] = 0;
    d[i + 8] = s[o + 6] * sz; d[i + 9] = s[o + 7] * sz; d[i + 10] = s[o + 8] * sz; d[i + 11] = 0;
    d[i + 12] = s[o] * x + s[o + 3] * y + s[o + 6] * z + s[o + 9];
    d[i + 13] = s[o + 1] * x + s[o + 4] * y + s[o + 7] * z + s[o + 10];
    d[i + 14] = s[o + 2] * x + s[o + 5] * y + s[o + 8] * z + s[o + 11];
    d[i + 15] = 1;
    d[i + 16] = color[0]; d[i + 17] = color[1]; d[i + 18] = color[2]; d[i + 19] = emissive;
    d[i + 20] = material[0]; d[i + 21] = material[1]; d[i + 22] = material[2]; d[i + 23] = material[3];
    batch.count++;
    return this;
  }
  // Add a mesh with a full 4x4 model matrix (aircraft poses).
  matrix(mesh, m, color, material = MATERIAL.paint, emissive = 0) {
    const batch = this.set.batch(mesh), d = batch.data, i = batch.count * STRIDE;
    d.set(m, i);
    d[i + 16] = color[0]; d[i + 17] = color[1]; d[i + 18] = color[2]; d[i + 19] = emissive;
    d[i + 20] = material[0]; d[i + 21] = material[1]; d[i + 22] = material[2]; d[i + 23] = material[3];
    batch.count++;
    return this;
  }
}

// [roughness, metalness, glow at night, kind]
// kind: 0 solid · 1 glass · 2 lamp (unlit, emissive) · 3 ground paint · 4 window wall · 5 ribbed cladding
const MATERIAL = {
  paint: [.55, 0, 0, 0],
  gloss: [.22, 0, 0, 0],
  matte: [.9, 0, 0, 0],
  rubber: [.95, 0, 0, 0],
  metal: [.38, .9, 0, 0],
  steel: [.55, .6, 0, 0],
  chrome: [.14, 1, 0, 0],
  aircraft: [.3, .05, 0, 0],
  alloy: [.36, .75, 0, 0],
  cloth: [.85, 0, 0, 0],
  hivis: [.7, 0, .05, 0],
  reflective: [.4, 0, .5, 0],
  skin: [.6, 0, 0, 0],
  concrete: [.92, 0, 0, 0],
  glass: [.06, 0, 0, 1],
  litGlass: [.08, 0, .9, 1],
  lamp: [.5, 0, 0, 2],
  nightLamp: [.5, 0, 1, 2],
  marking: [.7, 0, 0, 3],
  windows: [.3, 0, 1, 4],
  cladding: [.5, .35, 0, 5],
};

// ---- shaders -------------------------------------------------------------------------
const GLSL_HEAD = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
`;

const GLSL_COMMON = `
const float PI = 3.14159265;
uniform vec3 uSunDir, uSunColor, uSunGlow;
uniform vec3 uSkyZenith, uSkyHorizon, uSkyAmbient, uGroundBounce, uFogColor;
uniform vec3 uCamPos;
uniform float uFogDensity, uNight, uWet, uTime, uFlash, uLdr, uExposure;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMat;
uniform float uShadowTexel, uShadowWorld;
uniform sampler2D uAO;
uniform vec2 uInvRes;
uniform int uLightCount;
uniform vec4 uLightPos[16];
uniform vec4 uLightCol[16];

float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * noise2(p); p = p * 2.03 + 17.3; a *= .5; } return s; }

vec3 skyRadiance(vec3 d) {
  float h = d.y;
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(max(h, 0.), .45));
  if (h < 0.) c = mix(uSkyHorizon, uGroundBounce, smoothstep(0., -.3, h));
  float s = max(dot(d, uSunDir), 0.);
  return c + uSunGlow * (pow(s, 6.) * .18 + pow(s, 80.) * .9);
}

float sunShadow(vec3 P, vec3 N) {
  vec4 q = uShadowMat * vec4(P + N * uShadowWorld * 1.6, 1.);
  vec3 c = q.xyz / q.w * .5 + .5;
  if (c.x < 0. || c.x > 1. || c.y < 0. || c.y > 1. || c.z > 1.) return 1.;
  float lit = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    lit += texture(uShadowMap, vec3(c.xy + vec2(x, y) * uShadowTexel * 1.25, c.z - .00016));
  }
  float edge = min(min(c.x, 1. - c.x), min(c.y, 1. - c.y));
  return mix(1., lit / 9., smoothstep(0., .04, edge));
}

float ggxD(float NH, float a) { float a2 = a * a, d = NH * NH * (a2 - 1.) + 1.; return a2 / (PI * d * d); }
float smithV(float NL, float NV, float a) { float k = a * .5; return .25 / ((NL * (1. - k) + k) * (NV * (1. - k) + k)); }

vec3 directLight(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 diffuse, vec3 F0, float rough) {
  float NL = max(dot(N, L), 0.);
  if (NL <= 0.) return vec3(0.);
  vec3 H = normalize(L + V);
  float NV = max(dot(N, V), 1e-3), NH = max(dot(N, H), 0.), VH = max(dot(V, H), 0.);
  float a = max(rough * rough, .012);
  vec3 F = F0 + (1. - F0) * pow(1. - VH, 5.);
  vec3 spec = F * min(ggxD(NH, a) * smithV(NL, NV, a) * PI, 60.);
  return (diffuse + spec) * radiance * NL;
}

// P world position, N normal, ao ambient occlusion, env reflection scale.
vec3 shade(vec3 P, vec3 N, vec3 albedo, float rough, float metal, float ao, float envScale) {
  vec3 V = normalize(uCamPos - P);
  float NV = max(dot(N, V), 1e-3);
  vec3 F0 = mix(vec3(.04), albedo, metal);
  vec3 diffuse = albedo * (1. - metal);
  float shadow = sunShadow(P, N);
  vec3 color = directLight(N, V, uSunDir, uSunColor * shadow, diffuse, F0, rough);
  vec3 irradiance = mix(uGroundBounce, uSkyAmbient, N.y * .5 + .5) + uFlash;
  color += diffuse * irradiance * ao;
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) * .92 + .08;
  vec3 env = mix(skyRadiance(normalize(R)), irradiance, rough * rough);
  vec3 Fr = F0 + (max(vec3(1. - rough), F0) - F0) * pow(1. - NV, 5.);
  color += env * Fr * ao * envScale * mix(.55, 1., shadow);
  for (int i = 0; i < 16; i++) {
    if (i >= uLightCount) break;
    vec3 toLight = uLightPos[i].xyz - P;
    float d2 = dot(toLight, toLight), range = uLightPos[i].w;
    float fall = clamp(1. - d2 / (range * range), 0., 1.);
    if (fall <= 0.) continue;
    vec3 L = toLight * inversesqrt(d2);
    float cone = mix(1., smoothstep(.15, .75, L.y), uLightCol[i].a);
    color += directLight(N, V, L, uLightCol[i].rgb * fall * fall * cone / (1. + d2 * .02), diffuse, F0, rough) * mix(.5, 1., ao);
  }
  return color;
}

vec3 applyFog(vec3 color, vec3 P) {
  vec3 ray = P - uCamPos;
  float dist = length(ray);
  float height = exp(-max(P.y, 0.) * .035);
  float fog = 1. - exp(-dist * uFogDensity * (.35 + .65 * height));
  vec3 tint = uFogColor + uSunGlow * pow(max(dot(ray / dist, uSunDir), 0.), 8.) * .35;
  return mix(color, tint, clamp(fog, 0., 1.));
}

vec3 filmic(vec3 x) {
  x *= uExposure;
  return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.);
}
vec4 outputColor(vec3 hdr) {
  if (uLdr > .5) return vec4(pow(filmic(hdr), vec3(1. / 2.2)), 1.);
  return vec4(min(hdr, vec3(64.)), 1.);
}
`;

const VS_INSTANCED = GLSL_HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in mat4 iModel;
layout(location=6) in vec4 iColor;
layout(location=7) in vec4 iMat;
uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNor;
out vec3 vLocal;
flat out vec4 vColor;
flat out vec4 vMat;
void main() {
  vec4 world = iModel * vec4(aPos, 1.);
  mat3 m = mat3(iModel);
  vec3 s = vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
  vNor = m * (aNor / max(s, vec3(1e-8)));
  vPos = world.xyz;
  vLocal = aPos;
  vColor = iColor;
  vMat = iMat;
  gl_Position = uViewProj * world;
}`;

const FS_LIT = GLSL_HEAD + GLSL_COMMON + `
in vec3 vPos;
in vec3 vNor;
in vec3 vLocal;
flat in vec4 vColor;
flat in vec4 vMat;
out vec4 color;
void main() {
  vec3 N = normalize(vNor);
  if (!gl_FrontFacing) N = -N;
  vec3 albedo = pow(vColor.rgb, vec3(2.2));
  float rough = vMat.x, metal = vMat.y;
  int kind = int(vMat.w + .5);
  float glow = vColor.a + vMat.z * uNight;
  if (kind == 2) { color = outputColor(applyFog(albedo * (glow * 6. + .35), vPos)); return; }
  float ao = texture(uAO, gl_FragCoord.xy * uInvRes).r;
  float envScale = 1.;
  vec3 emissive = albedo * glow * 4.;
  if (kind == 1) {
    envScale = 2.2;
    emissive = albedo * vMat.z * uNight * 2.4;
    albedo *= .25;
  } else if (kind == 4 && abs(N.y) < .7) {
    // Curtain wall: glazing bands between floor slabs, a share of rooms lit after dark.
    vec3 T = normalize(vec3(-N.z, 0., N.x));
    vec2 cell = vec2(dot(vPos.xz, T.xz) / .62, vPos.y / .78);
    vec2 f = fract(cell);
    float pane = smoothstep(.06, .1, f.x) * smoothstep(.94, .9, f.x) * smoothstep(.2, .25, f.y) * smoothstep(.86, .81, f.y);
    float lit = step(.52, hash12(floor(cell) + 7.)) * uNight;
    vec3 glass = vec3(.035, .06, .08);
    emissive = pane * lit * vec3(1., .82, .52) * (1.3 + hash12(floor(cell)) * 1.4);
    rough = mix(rough, .06, pane);
    envScale = mix(1., 2.4, pane);
    albedo = mix(albedo, glass, pane);
  } else if (kind == 5) {
    // Profiled metal sheet: vertical ribs.
    vec3 T = normalize(vec3(-N.z, 0., N.x) + vec3(1e-4, 0., 0.));
    float rib = sin(dot(vPos.xz, T.xz) * 26.);
    N = normalize(N + T * rib * .32 * step(abs(N.y), .5));
    albedo *= .93 + .07 * rib;
  } else if (kind == 3) {
    // Paint wears with traffic and darkens when wet.
    albedo *= (.82 + .2 * noise2(vPos.xz * 9.)) * mix(1., .72, uWet);
    rough = mix(rough, .25, uWet * .8);
  } else {
    // Dust gathers low on everything that stands on the apron.
    float grime = fbm(vPos.xz * 2.3 + vPos.y * 3.1);
    albedo *= mix(.84, 1.04, grime) * mix(.8, 1., smoothstep(0., .22, vPos.y));
    rough = clamp(rough + (grime - .5) * .12 - uWet * .18 * step(.5, N.y), .04, 1.);
  }
  vec3 lit = shade(vPos, N, albedo, rough, metal, ao, envScale) + emissive;
  color = outputColor(applyFog(lit, vPos));
}`;

const FS_DEPTH = GLSL_HEAD + `
void main() {}`;

const VS_GROUND = GLSL_HEAD + `
layout(location=0) in vec2 aCorner;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uExtent;
out vec3 vPos;
void main() {
  vPos = vec3(aCorner.x * uExtent + uCamPos.x, 0., aCorner.y * uExtent + uCamPos.z);
  gl_Position = uViewProj * vec4(vPos, 1.);
}`;

const FS_GROUND = GLSL_HEAD + GLSL_COMMON + `
in vec3 vPos;
uniform sampler2D uSite;
uniform vec4 uSiteRect;      // x0, z0, 1/width, 1/depth
uniform vec4 uRunway;        // centre x, half width, start z
uniform vec2 uRoad;          // landside road: centre x, half width
uniform float uSeaX;
out vec4 color;

vec3 grass(vec2 p) {
  float n = fbm(p * .09), fine = noise2(p * 2.6), mow = .5 + .5 * sin(p.y * 1.15);
  vec3 c = mix(vec3(.075, .12, .045), vec3(.15, .18, .075), n);
  c = mix(c, vec3(.24, .22, .12), smoothstep(.5, .85, fbm(p * .031 + 40.)) * .75);
  return c * (.82 + .3 * fine) * (.95 + .08 * mow);
}

void main() {
  vec2 p = vPos.xz;
  vec3 N = vec3(0., 1., 0.);
  vec3 albedo;
  float rough = 1., metal = 0., envScale = 1.;
  vec2 uv = (p - uSiteRect.xy) * uSiteRect.zw;
  float ao = texture(uAO, gl_FragCoord.xy * uInvRes).r;
  if (p.x > uSeaX) {
    // Open water: two drifting wave layers, sky reflection and sun glitter.
    vec2 w1 = p * .16 + uTime * vec2(.09, .05), w2 = p * .43 - uTime * vec2(.07, .11);
    float e = .35;
    float hx = fbm(w1 + vec2(e, 0.)) - fbm(w1 - vec2(e, 0.)) + .5 * (noise2(w2 + vec2(e, 0.)) - noise2(w2 - vec2(e, 0.)));
    float hz = fbm(w1 + vec2(0., e)) - fbm(w1 - vec2(0., e)) + .5 * (noise2(w2 + vec2(0., e)) - noise2(w2 - vec2(0., e)));
    float calm = 1. / (1. + length(vPos - uCamPos) * .004);
    N = normalize(vec3(-hx * .9 * calm, 1., -hz * .9 * calm));
    albedo = vec3(.006, .028, .04);
    rough = .1; envScale = 1.6; ao = 1.;
  } else {
    // Site paint where surveyed; beyond it grass, with the runway carried on analytically.
    float paved = 0.;
    vec3 hard = vec3(0.);
    if (uv.x > 0. && uv.x < 1. && uv.y > 0. && uv.y < 1.) {
      vec4 site = texture(uSite, uv);
      paved = site.a;
      hard = pow(site.rgb / max(site.a, 1e-3), vec3(2.2));
    } else {
      float rx = abs(p.x - uRunway.x);
      if (rx < uRunway.y + 1.6 && p.y > uRunway.z) {
        paved = 1.;
        hard = pow(mix(vec3(.2, .205, .215), vec3(.27, .27, .27), step(uRunway.y, rx)), vec3(2.2));
        float edge = smoothstep(.16, .1, abs(rx - (uRunway.y - .45)));
        float dash = step(fract(p.y / 9.), .55) * smoothstep(.2, .13, rx);
        hard = mix(hard, vec3(.78), max(edge, dash) * .9);
      } else if (abs(p.x - uRoad.x) < uRoad.y) {
        paved = 1.;
        hard = vec3(.05, .052, .056);
        float lane = step(fract(p.y / 3.), .45) * smoothstep(.1, .05, abs(p.x - uRoad.x));
        float kerb = smoothstep(.08, .04, abs(abs(p.x - uRoad.x) - (uRoad.y - .2)));
        hard = mix(hard, vec3(.7), max(lane, kerb) * .85);
      }
    }
    // Aggregate grain, patchy staining, then rain: darker, glossier, with standing water.
    float grain = noise2(p * 23.) * .5 + noise2(p * 61.) * .5;
    float stain = fbm(p * .21 + 3.);
    hard *= (.86 + .26 * grain) * (.86 + .28 * stain);
    float puddle = smoothstep(.56, .7, fbm(p * .33 + 11.)) * uWet * paved;
    float film = uWet * .75 * paved;
    hard *= mix(1., .5, max(film, puddle));
    albedo = mix(grass(p) * mix(1., .8, uWet), hard, paved);
    rough = mix(1., mix(mix(.9, .3, film), .035, puddle), paved);
    envScale = 1. + puddle * 1.4 + film * .4;
    vec2 ripple = vec2(noise2(p * 7. + uTime * 1.3), noise2(p * 7. - uTime * 1.1)) - .5;
    N = normalize(vec3(ripple.x * .05 * uWet, 1., ripple.y * .05 * uWet) + vec3(grain - .5, 0., stain - .5) * .05 * paved * (1. - puddle));
  }
  vec3 lit = shade(vPos, N, albedo, rough, metal, ao, envScale);
  color = outputColor(applyFog(lit, vPos));
}`;

const VS_SCREEN = GLSL_HEAD + `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

const FS_SKY = GLSL_HEAD + GLSL_COMMON + `
in vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uMoonDir, uCloudLit, uCloudDark;
uniform float uCloudCover, uSunDisc;
out vec4 color;
void main() {
  vec4 far = uInvViewProj * vec4(vUv * 2. - 1., 1., 1.);
  vec3 d = normalize(far.xyz / far.w - uCamPos);
  vec3 c = skyRadiance(d);
  float s = dot(d, uSunDir);
  c += uSunColor * uSunDisc * smoothstep(.99955, .99985, s);
  float moon = smoothstep(.99982, .99992, dot(d, uMoonDir));
  c += vec3(.75, .82, 1.) * moon * uNight * 2.2;
  if (uNight > .2 && d.y > 0.) {
    vec3 g = floor(d * 190.);
    float star = step(.9965, hash12(g.xy + g.z * 7.31)) * hash12(g.zx + 3.) * uNight;
    c += vec3(.75, .85, 1.) * star * .5 * smoothstep(0., .25, d.y);
  }
  if (d.y > .015) {
    vec2 q = d.xz / (d.y + .1) * .9 + uTime * vec2(.006, .003);
    float n = fbm(q) * .7 + fbm(q * 2.7 + 5.) * .3;
    float cover = smoothstep(1. - uCloudCover, 1.18 - uCloudCover, n + .12);
    float shade = smoothstep(.2, .85, fbm(q * 1.7 + uSunDir.xz * .6));
    vec3 cloud = mix(uCloudLit, uCloudDark, shade) + uSunGlow * pow(max(s, 0.), 12.) * .5;
    c = mix(c, cloud, cover * smoothstep(.015, .16, d.y));
  }
  // Hazy ridgelines on the horizon.
  float az = atan(d.z, d.x);
  for (int layer = 0; layer < 2; layer++) {
    float k = float(layer);
    float ridge = (.018 + k * .016) + (.03 + k * .02) * noise2(vec2(az * (3. + k * 4.) + k * 9., k)) + .008 * noise2(vec2(az * 31., k + 4.));
    ridge *= .35 + .65 * smoothstep(-.9, .4, -cos(az + .3));
    vec3 hill = mix(uFogColor, uFogColor * vec3(.34, .42, .5), .55 - k * .22);
    c = mix(c, hill, smoothstep(ridge + .0025, ridge - .0025, d.y) * step(0., d.y + .02));
  }
  if (d.y < 0.) c = mix(c, uFogColor, smoothstep(0., -.02, d.y));
  color = outputColor(c);
}`;

const FS_AO = GLSL_HEAD + `
in vec2 vUv;
uniform sampler2D uDepth;
uniform mat4 uProj, uInvProj;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 color;
vec3 viewPos(vec2 uv) {
  float d = texture(uDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2. - 1., d * 2. - 1., 1.);
  return p.xyz / p.w;
}
void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 1.) { color = vec4(1.); return; }
  vec3 P = viewPos(vUv);
  vec3 r = viewPos(vUv + vec2(uTexel.x, 0.)) - P, l = P - viewPos(vUv - vec2(uTexel.x, 0.));
  vec3 u = viewPos(vUv + vec2(0., uTexel.y)) - P, d = P - viewPos(vUv - vec2(0., uTexel.y));
  vec3 dx = abs(r.z) < abs(l.z) ? r : l, dy = abs(u.z) < abs(d.z) ? u : d;
  vec3 N = normalize(cross(dx, dy));
  // Screen radius of a world-space sphere at this depth.
  float projected = uRadius * uProj[1][1] / max(uProj[3][3] > .5 ? 1. : -P.z, .01);
  float span = clamp(projected * .5, 2. * uTexel.y, .12);
  float angle = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))) * 6.2832;
  float sum = 0.;
  const int COUNT = 12;
  for (int i = 0; i < COUNT; i++) {
    float t = (float(i) + .5) / float(COUNT);
    float a = angle + float(i) * 2.39996;
    vec2 offset = vec2(cos(a), sin(a)) * span * sqrt(t);
    offset.x *= uTexel.x / uTexel.y;
    vec3 v = viewPos(vUv + offset) - P;
    float vv = dot(v, v), vn = dot(v, N);
    sum += max(vn - .03 - .002 * abs(P.z), 0.) / (vv + .02) * smoothstep(uRadius * uRadius * 4., uRadius * uRadius, vv);
  }
  color = vec4(clamp(1. - sum * 1.9 * uRadius / float(COUNT), 0., 1.));
}`;

const FS_AO_BLUR = GLSL_HEAD + `
in vec2 vUv;
uniform sampler2D uAO, uDepth;
uniform vec2 uStep;
uniform vec2 uLinear;   // near, far (perspective) — used only for edge weights
out vec4 color;
float lin(float d) { return uLinear.x * uLinear.y / (uLinear.y - d * (uLinear.y - uLinear.x)); }
void main() {
  float centre = lin(texture(uDepth, vUv).r);
  float sum = 0., weight = 0.;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uStep * float(i);
    float w = exp(-float(i * i) * .18) / (1. + abs(lin(texture(uDepth, uv).r) - centre) * 6. / max(centre * .02, .02));
    sum += texture(uAO, uv).r * w;
    weight += w;
  }
  color = vec4(sum / weight);
}`;

const FS_BLOOM_DOWN = GLSL_HEAD + `
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 color;
void main() {
  vec3 c = texture(uSource, vUv).rgb * .5;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i < 2 ? -1. : 1., (i & 1) == 0 ? -1. : 1.) * uTexel;
    c += texture(uSource, vUv + o).rgb * .125;
  }
  if (uThreshold > 0.) {
    float luma = max(c.r, max(c.g, c.b));
    c *= max(luma - uThreshold, 0.) / max(luma, 1e-4);
  }
  color = vec4(c, 1.);
}`;

const FS_BLOOM_UP = GLSL_HEAD + `
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
out vec4 color;
void main() {
  vec3 c = texture(uSource, vUv).rgb * .25;
  c += (texture(uSource, vUv + vec2(uTexel.x, 0.)).rgb + texture(uSource, vUv - vec2(uTexel.x, 0.)).rgb
    + texture(uSource, vUv + vec2(0., uTexel.y)).rgb + texture(uSource, vUv - vec2(0., uTexel.y)).rgb) * .125;
  c += (texture(uSource, vUv + uTexel).rgb + texture(uSource, vUv - uTexel).rgb
    + texture(uSource, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture(uSource, vUv + vec2(-uTexel.x, uTexel.y)).rgb) * .0625;
  color = vec4(c, 1.);
}`;

const FS_COMPOSITE = GLSL_HEAD + `
in vec2 vUv;
uniform sampler2D uScene, uBloom;
uniform float uExposure, uBloomAmount, uLdr, uTime, uSaturation;
out vec4 color;
vec3 filmic(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  if (uLdr > .5) {
    c = pow(c, vec3(2.2)) + bloom * uBloomAmount;
    c = pow(c, vec3(1. / 2.2));
  } else {
    c = filmic((c + bloom * uBloomAmount) * uExposure);
    c = pow(c, vec3(1. / 2.2));
  }
  float luma = dot(c, vec3(.2126, .7152, .0722));
  c = mix(vec3(luma), c, uSaturation);
  c = mix(c, c * c * (3. - 2. * c), .22);
  vec2 q = vUv - .5;
  c *= 1. - dot(q, q) * .34;
  c += (fract(sin(dot(gl_FragCoord.xy + uTime * 61., vec2(12.9898, 78.233))) * 43758.5453) - .5) / 255. * 1.6;
  color = vec4(c, 1.);
}`;

const VS_SPRITE = GLSL_HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPlace;    // x, y, z, size
layout(location=2) in vec4 iColor;    // rgb, opacity (0 = additive glow)
layout(location=3) in vec4 iShape;    // kind, heading, aspect, softness
uniform mat4 uViewProj;
uniform vec3 uCamRight, uCamUp, uCamPos;
out vec2 vCorner;
flat out vec4 vColor;
flat out vec4 vShape;
out vec3 vPos;
void main() {
  vec3 world;
  if (iShape.x > .5 && iShape.x < 1.5) {
    // Pool of light lying on the ground, stretched along its heading.
    vec2 local = vec2((aCorner.x + .8) * iShape.z, aCorner.y) * iPlace.w;
    float c = cos(iShape.y), s = sin(iShape.y);
    world = iPlace.xyz + vec3(local.x * c - local.y * s, 0., local.x * s + local.y * c);
  } else {
    vec3 toCam = normalize(uCamPos - iPlace.xyz);
    world = iPlace.xyz + toCam * iPlace.w * .35 + (uCamRight * aCorner.x + uCamUp * aCorner.y) * iPlace.w;
  }
  vCorner = aCorner;
  vColor = iColor;
  vShape = iShape;
  vPos = world;
  gl_Position = uViewProj * vec4(world, 1.);
}`;

const FS_SPRITE = GLSL_HEAD + `
in vec2 vCorner;
flat in vec4 vColor;
flat in vec4 vShape;
in vec3 vPos;
uniform vec3 uCamPos, uFogColor;
uniform float uFogDensity, uLdr, uExposure;
out vec4 color;
void main() {
  float r = length(vCorner) * 2.;
  if (r > 1.) discard;
  float fog = exp(-length(vPos - uCamPos) * uFogDensity * .6);
  vec3 rgb = pow(vColor.rgb, vec3(2.2));
  float scale = uLdr > .5 ? .35 * uExposure : 1.;
  if (vShape.x > 1.5) {
    // Smoke or spray puff.
    float a = vColor.a * pow(1. - r, 1.5) * fog;
    color = vec4(rgb * a * scale, a);
  } else if (vShape.x > .5) {
    float fall = pow(1. - r, 2.);
    color = vec4(rgb * fall * vColor.a * fog * scale, 0.);
  } else {
    float core = exp(-r * r * 14.), halo = pow(1. - r, 3.);
    color = vec4(rgb * (core * 3. + halo * .55) * vColor.a * fog * scale, 0.);
  }
}`;

function compile(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw Error('Shader compile failed: ' + log);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Program link failed: ' + gl.getProgramInfoLog(program));
  const locations = new Map();
  return {program, loc(name) {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name);
  }};
}

// ---- time of day ---------------------------------------------------------------------
const SUNRISE = normalize([-.8, 0, .6]), NOON = normalize([.6, 0, .8]);

/* Lighting for an hour of the day (0-24) and a weather state.
   The sun rises over the landside and sets beyond the runway. */
function environment(hour, weather = 'CLEAR', flash = 0) {
  const day = hour >= 6 && hour <= 18.5;
  const phase = day ? (hour - 6) / 12.5 : ((hour + 24 - 18.5) % 24) / 11.5;
  const altitude = day ? Math.sin(phase * Math.PI) * .87 : -Math.sin(phase * Math.PI) * .7;
  const azimuth = (day ? phase : 1 + phase) * Math.PI;
  const ca = Math.cos(altitude);
  const sun = normalize([
    (Math.cos(azimuth) * SUNRISE[0] + Math.sin(azimuth) * NOON[0]) * ca, Math.sin(altitude),
    (Math.cos(azimuth) * SUNRISE[2] + Math.sin(azimuth) * NOON[2]) * ca]);
  const elevation = Math.sin(altitude);
  const dayness = smooth((elevation + .04) / .3);
  const night = smooth((.06 - elevation) / .22);
  const dusk = Math.exp(-((elevation - .04) ** 2) / .022);
  const overcast = {CLEAR: 0, RAIN: .7, STORM: 1, FOG: .55}[weather] ?? 0;
  const wet = {RAIN: .75, STORM: 1}[weather] ?? 0;

  let zenith = mix3(mix3([.004, .007, .018], [.09, .13, .32], 1 - night), [.12, .3, .72], dayness);
  let horizon = mix3(mix3([.012, .017, .032], [.95, .46, .2], Math.min(1, dusk * 1.15)), [.56, .7, .88], dayness);
  const grey = scale3([.42, .46, .5], .12 + .88 * Math.max(dayness, dusk * .5));
  zenith = mix3(zenith, scale3(grey, .8), overcast);
  horizon = mix3(horizon, scale3(grey, 1.1), overcast * .9);

  const warm = smooth(elevation / .32);
  let sunColor = scale3(mix3([1, .5, .22], [1, .95, .86], warm), 3.6 * smooth((elevation + .02) / .1));
  sunColor = scale3(sunColor, 1 - overcast * .86);
  const moon = normalize([-.45, .72, .52]);
  const moonColor = scale3([.5, .62, .9], .16 * (1 - overcast * .7));
  const useMoon = elevation < -.02;
  const lightDir = useMoon ? moon : sun;
  const lightColor = useMoon ? scale3(moonColor, smooth((-.02 - elevation) / .1)) : sunColor;

  const ambient = scale3(mix3(zenith, horizon, .45), 1.05 + overcast * .5);
  const bounce = scale3(mix3(horizon, [.35, .33, .3], .5), .22 + .1 * dayness);
  const fogColor = mix3(horizon, zenith, .12);
  const density = {CLEAR: .0011, RAIN: .0042, STORM: .0065, FOG: .016}[weather] ?? .0011;
  return {
    hour, weather, sun, moon, lightDir, lightColor, elevation, dayness, night, dusk, overcast, wet,
    zenith, horizon, ambient, bounce, fogColor, fogDensity: density + night * .0006,
    sunGlow: scale3(mix3([1, .45, .18], [1, .9, .75], warm), (useMoon ? 0 : 1) * (1 - overcast * .9) * smooth((elevation + .1) / .2) * 1.5),
    sunDisc: useMoon ? 0 : 14 * (1 - overcast),
    cloudCover: lerp(.42, .98, overcast),
    cloudLit: mix3(scale3(mix3([1, .62, .4], [1, 1, 1], warm), .2 + 1.25 * Math.max(dayness, dusk * .7)), grey, overcast * .7),
    cloudDark: scale3(mix3(zenith, grey, .5 + overcast * .4), .55 + .5 * dayness),
    exposure: lerp(lerp(.62, .9, dusk), 2.2, night) * (1 + overcast * .35 * dayness),
    flash,
  };
}

// ---- engine --------------------------------------------------------------------------
class Engine {
  constructor(gl, options = {}) {
    this.gl = gl;
    this.tier = options.tier === 'high' ? 'high' : 'medium';
    this.float = Boolean(gl.getExtension('EXT_color_buffer_float'));
    gl.getExtension('OES_texture_float_linear');
    this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    this.shadowSize = Math.min(this.tier === 'high' ? 4096 : 2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    this.meshes = new Map();
    this.staticSet = new InstanceSet();
    this.dynamicSet = new InstanceSet();
    this.pen = new Pen();
    this.sprites = {data: new Float32Array(12 * 256), count: 0};
    this.lights = {position: new Float32Array(64), color: new Float32Array(64), count: 0};
    this.targets = null;
    this.site = null;
    this.programs = {
      lit: compile(gl, VS_INSTANCED, FS_LIT),
      depth: compile(gl, VS_INSTANCED, FS_DEPTH),
      ground: compile(gl, VS_GROUND, FS_GROUND),
      groundDepth: compile(gl, VS_GROUND, FS_DEPTH),
      sky: compile(gl, VS_SCREEN, FS_SKY),
      ao: compile(gl, VS_SCREEN, FS_AO),
      aoBlur: compile(gl, VS_SCREEN, FS_AO_BLUR),
      bloomDown: compile(gl, VS_SCREEN, FS_BLOOM_DOWN),
      bloomUp: compile(gl, VS_SCREEN, FS_BLOOM_UP),
      composite: compile(gl, VS_SCREEN, FS_COMPOSITE),
      sprite: compile(gl, VS_SPRITE, FS_SPRITE),
    };
    for (const [name, build] of Object.entries(meshes)) this.addMesh(name, build());
    this.initQuads();
    this.initShadow();
    this.white = this.solidTexture([255, 255, 255, 255]);
  }

  addMesh(name, vertices) {
    const gl = this.gl, buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    this.meshes.set(name, {buffer, count: vertices.length / 6});
  }

  solidTexture(rgba) {
    const gl = this.gl, texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }

  initQuads() {
    const gl = this.gl;
    const corners = new Float32Array([-.5, -.5, .5, -.5, .5, .5, -.5, -.5, .5, .5, -.5, .5]);
    this.cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    // Ground: one large quad that follows the camera.
    this.groundVao = gl.createVertexArray();
    gl.bindVertexArray(this.groundVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Sprites: instanced corners.
    this.spriteVao = gl.createVertexArray();
    this.spriteBuffer = gl.createBuffer();
    gl.bindVertexArray(this.spriteVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    for (let k = 0; k < 3; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 48, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }
    this.screenVao = gl.createVertexArray();
    gl.bindVertexArray(null);
  }

  initShadow() {
    const gl = this.gl, size = this.shadowSize;
    this.shadowTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Site paint: a canvas whose alpha marks paved (1) against soft (0) ground.
  setSite(canvas, rect) {
    const gl = this.gl;
    if (this.site) gl.deleteTexture(this.site.texture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.anisotropy) {
      gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    this.site = {texture, rect};
  }

  // ---- render targets ------------------------------------------------------------------
  texture(width, height, internal, format, type, filter) {
    const gl = this.gl, texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  colorTarget(width, height, hdr = true) {
    const gl = this.gl;
    const texture = hdr && this.float
      ? this.texture(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR)
      : this.texture(width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return {fbo, texture, width, height};
  }

  resize(width, height) {
    const gl = this.gl, old = this.targets;
    if (old && old.width === width && old.height === height) return;
    this.releaseTargets();
    const t = {width, height};
    // Depth pre-pass.
    t.depthTexture = this.texture(width, height, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    t.depthFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.depthFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depthTexture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const halfW = Math.max(1, width >> 1), halfH = Math.max(1, height >> 1);
    t.ao = [this.colorTarget(halfW, halfH, false), this.colorTarget(halfW, halfH, false)];
    // Multisampled HDR scene, resolved into a texture for post-processing.
    const format = this.float ? gl.RGBA16F : gl.RGBA8;
    t.sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.sceneFbo);
    t.sceneColor = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, t.sceneColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, format, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.sceneColor);
    t.sceneDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, t.sceneDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.sceneDepth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      // Multisampled float targets unsupported: fall back to 8-bit with in-shader tone mapping.
      this.float = false;
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.sceneColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, width, height);
    }
    t.resolve = this.colorTarget(width, height);
    t.bloom = [];
    let w = halfW, h = halfH;
    for (let level = 0; level < 5 && w >= 4 && h >= 4; level++) {
      t.bloom.push(this.colorTarget(w, h));
      w >>= 1; h >>= 1;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = t;
  }

  releaseTargets() {
    const gl = this.gl, t = this.targets;
    if (!t) return;
    gl.deleteTexture(t.depthTexture);
    gl.deleteFramebuffer(t.depthFbo);
    for (const target of [...t.ao, t.resolve, ...t.bloom]) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.fbo); }
    gl.deleteRenderbuffer(t.sceneColor);
    gl.deleteRenderbuffer(t.sceneDepth);
    gl.deleteFramebuffer(t.sceneFbo);
    this.targets = null;
  }

  // ---- per-frame inputs ----------------------------------------------------------------
  clearLights() { this.lights.count = 0; }
  // A local lamp. `cone` 1 lights only what lies below it.
  light(x, y, z, range, color, intensity, cone = 1) {
    const l = this.lights;
    if (l.count >= 16 || intensity <= 0) return;
    const i = l.count * 4;
    l.position[i] = x; l.position[i + 1] = y; l.position[i + 2] = z; l.position[i + 3] = range;
    l.color[i] = color[0] * intensity; l.color[i + 1] = color[1] * intensity; l.color[i + 2] = color[2] * intensity; l.color[i + 3] = cone;
    l.count++;
  }

  clearSprites() { this.sprites.count = 0; }
  sprite(kind, x, y, z, size, color, opacity, heading = 0, aspect = 1) {
    const s = this.sprites;
    if ((s.count + 1) * 12 > s.data.length) { const grown = new Float32Array(s.data.length * 2); grown.set(s.data); s.data = grown; }
    const i = s.count * 12, d = s.data;
    d[i] = x; d[i + 1] = y; d[i + 2] = z; d[i + 3] = size;
    d[i + 4] = color[0]; d[i + 5] = color[1]; d[i + 6] = color[2]; d[i + 7] = opacity;
    d[i + 8] = kind; d[i + 9] = heading; d[i + 10] = aspect; d[i + 11] = 0;
    s.count++;
  }
  glow(x, y, z, size, color, strength = 1) { this.sprite(0, x, y, z, size, color, strength); }
  pool(x, z, size, color, strength, heading = 0, aspect = 1) { this.sprite(1, x, .03, z, size, color, strength, heading, aspect); }
  puff(x, y, z, size, color, opacity) { this.sprite(2, x, y, z, size, color, opacity); }

  // ---- drawing -------------------------------------------------------------------------
  uploadSet(set, usage) {
    const gl = this.gl;
    for (const [name, batch] of set.batches) {
      if (batch.uploaded === set.version) continue;
      batch.uploaded = set.version;
      const mesh = this.meshes.get(name);
      if (!mesh) throw Error('Unknown mesh: ' + name);
      if (!batch.buffer) {
        batch.buffer = gl.createBuffer();
        batch.vao = gl.createVertexArray();
        gl.bindVertexArray(batch.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
        for (let k = 0; k < 6; k++) {
          gl.enableVertexAttribArray(2 + k);
          gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, STRIDE * 4, k * 16);
          gl.vertexAttribDivisor(2 + k, 1);
        }
        batch.mesh = mesh;
        batch.capacity = 0;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
      if (batch.capacity < batch.data.length) {
        gl.bufferData(gl.ARRAY_BUFFER, batch.data, usage);
        batch.capacity = batch.data.length;
      } else if (batch.count) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * STRIDE);
      }
    }
  }

  drawSets() {
    const gl = this.gl;
    for (const set of [this.staticSet, this.dynamicSet]) for (const batch of set.batches.values()) {
      if (!batch.count || !batch.vao) continue;
      gl.bindVertexArray(batch.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.mesh.count, batch.count);
    }
  }

  setEnvironment(program, env, frame) {
    const gl = this.gl, u = name => program.loc(name);
    gl.uniform3fv(u('uSunDir'), env.lightDir);
    gl.uniform3fv(u('uSunColor'), env.lightColor);
    gl.uniform3fv(u('uSunGlow'), env.sunGlow);
    gl.uniform3fv(u('uSkyZenith'), env.zenith);
    gl.uniform3fv(u('uSkyHorizon'), env.horizon);
    gl.uniform3fv(u('uSkyAmbient'), env.ambient);
    gl.uniform3fv(u('uGroundBounce'), env.bounce);
    gl.uniform3fv(u('uFogColor'), env.fogColor);
    gl.uniform3fv(u('uCamPos'), frame.eye);
    gl.uniform1f(u('uFogDensity'), env.fogDensity);
    gl.uniform1f(u('uNight'), env.night);
    gl.uniform1f(u('uWet'), env.wet);
    gl.uniform1f(u('uTime'), frame.time);
    gl.uniform1f(u('uFlash'), env.flash);
    gl.uniform1f(u('uLdr'), this.float ? 0 : 1);
    gl.uniform1f(u('uExposure'), env.exposure);
    gl.uniformMatrix4fv(u('uShadowMat'), false, this.shadowMatrix);
    gl.uniform1f(u('uShadowTexel'), 1 / this.shadowSize);
    gl.uniform1f(u('uShadowWorld'), this.shadowWorldTexel);
    gl.uniform2f(u('uInvRes'), 1 / this.targets.width, 1 / this.targets.height);
    gl.uniform1i(u('uShadowMap'), 0);
    gl.uniform1i(u('uAO'), 1);
    gl.uniform1i(u('uLightCount'), this.lights.count);
    gl.uniform4fv(u('uLightPos[0]'), this.lights.position);
    gl.uniform4fv(u('uLightCol[0]'), this.lights.color);
  }

  fitShadow(env, frame) {
    const size = this.shadowSize;
    // Radius steps keep the texel grid stable while the camera zooms.
    const wanted = clamp(frame.shadowRadius, 14, 110);
    const radius = 14 * Math.pow(1.3, Math.ceil(Math.log(wanted / 14) / Math.log(1.3)));
    const d = env.lightDir, c = frame.focus;
    const view = mat.look([c[0] + d[0] * 220, c[1] + d[1] * 220, c[2] + d[2] * 220], c, Math.abs(d[1]) > .97 ? [1, 0, 0] : [0, 1, 0]);
    // Snap the focus to whole texels in light space.
    const texel = radius * 2 / size;
    const lx = view[0] * c[0] + view[4] * c[1] + view[8] * c[2] + view[12];
    const ly = view[1] * c[0] + view[5] * c[1] + view[9] * c[2] + view[13];
    const ox = lx - Math.round(lx / texel) * texel, oy = ly - Math.round(ly / texel) * texel;
    const proj = mat.ortho(-radius + ox, radius + ox, -radius + oy, radius + oy, 20, 440);
    this.shadowMatrix = mat.mul(proj, view);
    this.shadowWorldTexel = texel;
  }

  render(frame) {
    const gl = this.gl, env = frame.env, p = this.programs;
    this.resize(frame.width, frame.height);
    const t = this.targets;
    const viewProj = mat.mul(frame.projection, frame.view);
    this.uploadSet(this.staticSet, gl.STATIC_DRAW);
    this.uploadSet(this.dynamicSet, gl.DYNAMIC_DRAW);
    this.fitShadow(env, frame);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // 1 · sun shadow map
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.6, 3);
    gl.useProgram(p.depth.program);
    gl.uniformMatrix4fv(p.depth.loc('uViewProj'), false, this.shadowMatrix);
    this.drawSets();
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 2 · depth pre-pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.depthFbo);
    gl.viewport(0, 0, t.width, t.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(p.depth.loc('uViewProj'), false, viewProj);
    this.drawSets();
    gl.useProgram(p.groundDepth.program);
    gl.uniformMatrix4fv(p.groundDepth.loc('uViewProj'), false, viewProj);
    gl.uniform3fv(p.groundDepth.loc('uCamPos'), frame.eye);
    gl.uniform1f(p.groundDepth.loc('uExtent'), frame.groundExtent);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.groundVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3 · ambient occlusion from depth, then a depth-aware blur
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindVertexArray(this.screenVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.depthTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.ao[0].fbo);
    gl.viewport(0, 0, t.ao[0].width, t.ao[0].height);
    gl.useProgram(p.ao.program);
    gl.uniform1i(p.ao.loc('uDepth'), 0);
    gl.uniformMatrix4fv(p.ao.loc('uProj'), false, frame.projection);
    gl.uniformMatrix4fv(p.ao.loc('uInvProj'), false, mat.invert(frame.projection));
    gl.uniform2f(p.ao.loc('uTexel'), 1 / t.width, 1 / t.height);
    gl.uniform1f(p.ao.loc('uRadius'), frame.aoRadius ?? .55);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(p.aoBlur.program);
    gl.uniform1i(p.aoBlur.loc('uAO'), 1);
    gl.uniform1i(p.aoBlur.loc('uDepth'), 0);
    gl.uniform2f(p.aoBlur.loc('uLinear'), frame.near, frame.far);
    gl.activeTexture(gl.TEXTURE1);
    for (const [source, target, step] of [[t.ao[0], t.ao[1], [1 / t.ao[0].width, 0]], [t.ao[1], t.ao[0], [0, 1 / t.ao[0].height]]]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform2f(p.aoBlur.loc('uStep'), step[0], step[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 4 · lit scene into the multisampled HDR target
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.sceneFbo);
    gl.viewport(0, 0, t.width, t.height);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.ao[0].texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.site ? this.site.texture : this.white);

    gl.useProgram(p.sky.program);
    this.setEnvironment(p.sky, env, frame);
    gl.uniformMatrix4fv(p.sky.loc('uInvViewProj'), false, mat.invert(viewProj));
    gl.uniform3fv(p.sky.loc('uMoonDir'), env.moon);
    gl.uniform3fv(p.sky.loc('uCloudLit'), env.cloudLit);
    gl.uniform3fv(p.sky.loc('uCloudDark'), env.cloudDark);
    gl.uniform1f(p.sky.loc('uCloudCover'), env.cloudCover);
    gl.uniform1f(p.sky.loc('uSunDisc'), env.sunDisc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(p.ground.program);
    this.setEnvironment(p.ground, env, frame);
    gl.uniformMatrix4fv(p.ground.loc('uViewProj'), false, viewProj);
    gl.uniform1f(p.ground.loc('uExtent'), frame.groundExtent);
    gl.uniform1i(p.ground.loc('uSite'), 2);
    const rect = this.site ? this.site.rect : [0, 0, 1, 1];
    gl.uniform4f(p.ground.loc('uSiteRect'), rect[0], rect[1], 1 / rect[2], 1 / rect[3]);
    gl.uniform4fv(p.ground.loc('uRunway'), frame.runway || [0, 0, 1e9, 0]);
    gl.uniform1f(p.ground.loc('uSeaX'), frame.seaX ?? 1e9);
    gl.uniform2fv(p.ground.loc('uRoad'), frame.road || [0, 0]);
    gl.bindVertexArray(this.groundVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.enable(gl.CULL_FACE);
    gl.useProgram(p.lit.program);
    this.setEnvironment(p.lit, env, frame);
    gl.uniformMatrix4fv(p.lit.loc('uViewProj'), false, viewProj);
    this.drawSets();

    // 5 · glows, light pools and smoke
    if (this.sprites.count) {
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(p.sprite.program);
      gl.uniformMatrix4fv(p.sprite.loc('uViewProj'), false, viewProj);
      gl.uniform3f(p.sprite.loc('uCamRight'), frame.view[0], frame.view[4], frame.view[8]);
      gl.uniform3f(p.sprite.loc('uCamUp'), frame.view[1], frame.view[5], frame.view[9]);
      gl.uniform3fv(p.sprite.loc('uCamPos'), frame.eye);
      gl.uniform3fv(p.sprite.loc('uFogColor'), env.fogColor);
      gl.uniform1f(p.sprite.loc('uFogDensity'), env.fogDensity);
      gl.uniform1f(p.sprite.loc('uLdr'), this.float ? 0 : 1);
      gl.uniform1f(p.sprite.loc('uExposure'), env.exposure);
      gl.bindVertexArray(this.spriteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.sprites.data.subarray(0, this.sprites.count * 12), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.sprites.count);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    // 6 · resolve, bloom, tone map
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.sceneFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.resolve.fbo);
    gl.blitFramebuffer(0, 0, t.width, t.height, 0, 0, t.width, t.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.bindVertexArray(this.screenVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(p.bloomDown.program);
    gl.uniform1i(p.bloomDown.loc('uSource'), 0);
    let source = t.resolve;
    for (const [level, target] of t.bloom.entries()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform2f(p.bloomDown.loc('uTexel'), 1 / source.width, 1 / source.height);
      gl.uniform1f(p.bloomDown.loc('uThreshold'), level === 0 ? (this.float ? 1.15 / env.exposure : .82) : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      source = target;
    }
    gl.useProgram(p.bloomUp.program);
    gl.uniform1i(p.bloomUp.loc('uSource'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let level = t.bloom.length - 1; level > 0; level--) {
      const from = t.bloom[level], to = t.bloom[level - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.viewport(0, 0, to.width, to.height);
      gl.bindTexture(gl.TEXTURE_2D, from.texture);
      gl.uniform2f(p.bloomUp.loc('uTexel'), 1 / from.width, 1 / from.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, frame.outputWidth ?? t.width, frame.outputHeight ?? t.height);
    gl.useProgram(p.composite.program);
    gl.bindTexture(gl.TEXTURE_2D, t.resolve.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.bloom.length ? t.bloom[0].texture : this.white);
    gl.uniform1i(p.composite.loc('uScene'), 0);
    gl.uniform1i(p.composite.loc('uBloom'), 1);
    gl.uniform1f(p.composite.loc('uExposure'), env.exposure);
    gl.uniform1f(p.composite.loc('uBloomAmount'), t.bloom.length ? .055 + env.night * .05 + env.wet * .02 : 0);
    gl.uniform1f(p.composite.loc('uLdr'), this.float ? 0 : 1);
    gl.uniform1f(p.composite.loc('uTime'), frame.time % 100);
    gl.uniform1f(p.composite.loc('uSaturation'), 1.08 - env.overcast * .16);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    this.releaseTargets();
    for (const mesh of this.meshes.values()) gl.deleteBuffer(mesh.buffer);
    for (const set of [this.staticSet, this.dynamicSet]) for (const batch of set.batches.values()) {
      if (batch.buffer) gl.deleteBuffer(batch.buffer);
      if (batch.vao) gl.deleteVertexArray(batch.vao);
    }
    for (const program of Object.values(this.programs)) gl.deleteProgram(program.program);
    for (const vao of [this.groundVao, this.spriteVao, this.screenVao]) gl.deleteVertexArray(vao);
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.spriteBuffer);
    gl.deleteTexture(this.shadowTexture);
    gl.deleteFramebuffer(this.shadowFbo);
    gl.deleteTexture(this.white);
    if (this.site) gl.deleteTexture(this.site.texture);
  }
}

window.RelayEngine = {Engine, InstanceSet, Pen, MATERIAL, mat, environment, meshBuilder: builder, revolve, clamp, lerp, smooth};
})();
