// Procedural canvas textures: concrete, asphalt, grass, aluminium ULD skins, cardboard, wood.
// Generated once at start-up so the app needs no image assets beyond the aircraft GLB.
import * as THREE from 'three';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Small deterministic RNG so textures are identical between reloads.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function speckle(ctx, w, h, n, colors, size, seed, alpha = 1) {
  const r = rng(seed);
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(r() * colors.length) | 0];
    const s = size * (0.4 + r());
    ctx.fillRect(r() * w, r() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function blotches(ctx, w, h, n, color, rMin, rMax, alpha, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = rMin + r() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color.replace('A', String(alpha * (0.4 + r() * 0.6))));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function tex(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export function concrete() {
  return memo('concrete', () => {
    const W = 1024; const [c, x] = canvas(W);
    x.fillStyle = '#b9b8b1'; x.fillRect(0, 0, W, W);
    blotches(x, W, W, 90, 'rgba(120,118,110,A)', 30, 160, 0.18, 3);
    blotches(x, W, W, 60, 'rgba(225,223,215,A)', 20, 120, 0.2, 4);
    speckle(x, W, W, 60000, ['#a6a49c', '#c8c6bf', '#9b9990', '#d3d1ca'], 1.6, 5, 0.55);
    // tyre marks / oil stains
    blotches(x, W, W, 14, 'rgba(60,58,52,A)', 10, 50, 0.22, 6);
    // slab joints (each texture tile = 4 x 4 slabs)
    x.strokeStyle = 'rgba(70,68,62,0.55)'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      const p = i * W / 4;
      x.beginPath(); x.moveTo(p, 0); x.lineTo(p, W); x.stroke();
      x.beginPath(); x.moveTo(0, p); x.lineTo(W, p); x.stroke();
    }
    const color = tex(c);
    const [rc, rx] = canvas(256);
    rx.fillStyle = '#d8d8d8'; rx.fillRect(0, 0, 256, 256);
    speckle(rx, 256, 256, 5000, ['#bdbdbd', '#efefef', '#a8a8a8'], 1.4, 9, 0.6);
    const rough = tex(rc, { srgb: false });
    return { color, rough };
  });
}

export function asphalt() {
  return memo('asphalt', () => {
    const W = 512; const [c, x] = canvas(W);
    x.fillStyle = '#4a4b4d'; x.fillRect(0, 0, W, W);
    speckle(x, W, W, 50000, ['#3b3c3e', '#5a5b5e', '#2f3032', '#66676a'], 1.3, 11, 0.7);
    blotches(x, W, W, 30, 'rgba(25,25,27,A)', 20, 90, 0.25, 12);
    blotches(x, W, W, 20, 'rgba(110,110,112,A)', 20, 70, 0.12, 13);
    return tex(c);
  });
}

export function grass() {
  return memo('grass', () => {
    const W = 512; const [c, x] = canvas(W);
    x.fillStyle = '#6f8a4a'; x.fillRect(0, 0, W, W);
    blotches(x, W, W, 70, 'rgba(90,110,50,A)', 20, 110, 0.5, 21);
    blotches(x, W, W, 50, 'rgba(150,160,90,A)', 20, 90, 0.3, 22);
    speckle(x, W, W, 40000, ['#5d7a3c', '#7f9a55', '#8fa462', '#4e6a33'], 1.5, 23, 0.6);
    return tex(c);
  });
}

// Brushed aluminium skin with panel seams and rivet rows — ULD side walls.
export function aluminium(tint = '#c9ced2', seed = 31) {
  return memo('alu' + tint + seed, () => {
    const W = 512; const [c, x] = canvas(W);
    x.fillStyle = tint; x.fillRect(0, 0, W, W);
    const r = rng(seed);
    for (let i = 0; i < 2600; i++) { // brushed streaks
      x.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,45,50'},${0.03 + r() * 0.05})`;
      x.lineWidth = 0.6 + r(); const y = r() * W;
      x.beginPath(); x.moveTo(0, y); x.lineTo(W, y + (r() - 0.5) * 4); x.stroke();
    }
    blotches(x, W, W, 16, 'rgba(70,72,70,A)', 20, 90, 0.18, seed + 1); // grime
    x.strokeStyle = 'rgba(60,65,70,0.55)'; x.lineWidth = 3;
    for (let k = 1; k < 4; k++) { const p = (k * W) / 4; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, W); x.stroke(); }
    x.fillStyle = 'rgba(70,75,80,0.7)';
    for (let k = 0; k <= 4; k++) for (let j = 6; j < W; j += 18) {
      x.beginPath(); x.arc((k * W) / 4 + 7, j, 2.2, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = 'rgba(45,48,52,0.85)'; x.fillRect(0, W - 22, W, 22); // base rail
    return tex(c);
  });
}

// ULD front: curtain door with straps and an ID plate, e.g. "AKE 12345 CX".
export function uldDoor(label, curtain = '#2f3b46', accent = '#c9ced2') {
  return memo('door' + label + curtain, () => {
    const W = 512; const [c, x] = canvas(W);
    x.fillStyle = accent; x.fillRect(0, 0, W, W);
    x.fillStyle = curtain; x.fillRect(22, 30, W - 44, W - 70);
    const r = rng(label.length * 7 + 3);
    for (let i = 0; i < 900; i++) { // fabric weave
      x.fillStyle = `rgba(255,255,255,${r() * 0.05})`; x.fillRect(22 + r() * (W - 44), 30 + r() * (W - 70), 2, 2);
    }
    x.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 6; i++) x.fillRect(22, 70 + i * 70, W - 44, 4);
    x.fillStyle = '#d64b2a'; // straps
    for (const sx of [120, 256, 392]) x.fillRect(sx - 7, 30, 14, W - 70);
    x.fillStyle = '#f2f2ee'; x.fillRect(150, 52, 212, 54);
    x.fillStyle = '#16202a'; x.font = 'bold 34px Helvetica, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, 256, 80);
    x.fillStyle = 'rgba(45,48,52,0.9)'; x.fillRect(0, W - 22, W, 22);
    return tex(c);
  });
}

export function cardboard(seed = 41) {
  return memo('card' + seed, () => {
    const W = 256; const [c, x] = canvas(W);
    x.fillStyle = '#b48a5a'; x.fillRect(0, 0, W, W);
    speckle(x, W, W, 9000, ['#a57d50', '#c29869', '#9a7349'], 1.2, seed, 0.6);
    x.fillStyle = 'rgba(215,195,150,0.85)'; x.fillRect(W / 2 - 14, 0, 28, W); // tape
    x.strokeStyle = 'rgba(80,55,30,0.5)'; x.lineWidth = 2; x.strokeRect(2, 2, W - 4, W - 4);
    x.fillStyle = '#ffffff'; x.fillRect(24, 150, 80, 50);
    x.fillStyle = '#222'; for (let i = 0; i < 14; i++) x.fillRect(30 + i * 5, 158, i % 3 ? 2 : 3, 24);
    return tex(c);
  });
}

export function dgBox() {
  return memo('dgbox', () => {
    const W = 256; const [c, x] = canvas(W);
    x.drawImage(cardboard(43).image, 0, 0);
    const diamond = (cx, cy, s, fill, top = '#fff') => {
      x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4);
      x.fillStyle = '#fff'; x.fillRect(-s / 2 - 4, -s / 2 - 4, s + 8, s + 8);
      x.fillStyle = fill; x.fillRect(-s / 2, -s / 2, s, s); x.restore();
      x.fillStyle = top; x.font = 'bold 26px Arial'; x.textAlign = 'center'; x.fillText('3', cx, cy + 30);
    };
    diamond(70, 80, 64, '#d7261e');
    x.save(); x.translate(180, 80); x.rotate(Math.PI / 4);
    x.fillStyle = '#fff'; x.fillRect(-36, -36, 72, 72);
    x.fillStyle = '#111'; for (let i = 0; i < 4; i++) x.fillRect(-36 + i * 9, -36, 4, 36);
    x.restore();
    x.fillStyle = '#111'; x.font = 'bold 22px Arial'; x.textAlign = 'center'; x.fillText('UN 1266', 128, 230);
    return tex(c);
  });
}

export function cargoNet() {
  return memo('net', () => {
    const W = 256; const [c, x] = canvas(W);
    x.clearRect(0, 0, W, W);
    x.strokeStyle = 'rgba(30,30,30,0.95)'; x.lineWidth = 5;
    for (let i = -W; i < W * 2; i += 42) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + W, W); x.stroke();
      x.beginPath(); x.moveTo(i, W); x.lineTo(i + W, 0); x.stroke();
    }
    return tex(c);
  });
}

export function woodCrate() {
  return memo('crate', () => {
    const W = 512; const [c, x] = canvas(W);
    x.fillStyle = '#b8935f'; x.fillRect(0, 0, W, W);
    const r = rng(51);
    for (let p = 0; p < 8; p++) { // planks with grain
      const y = p * 64;
      x.fillStyle = `hsl(33, ${35 + r() * 12}%, ${50 + r() * 10}%)`; x.fillRect(0, y + 2, W, 60);
      for (let g = 0; g < 40; g++) {
        x.strokeStyle = `rgba(90,60,30,${0.08 + r() * 0.12})`; x.lineWidth = 1;
        const gy = y + 4 + r() * 56; x.beginPath(); x.moveTo(0, gy);
        x.bezierCurveTo(W * 0.3, gy + (r() - 0.5) * 8, W * 0.6, gy + (r() - 0.5) * 8, W, gy); x.stroke();
      }
      x.fillStyle = 'rgba(40,25,10,0.6)'; x.fillRect(0, y, W, 3);
    }
    x.fillStyle = 'rgba(120,85,45,1)'; // frame battens
    x.fillRect(0, 0, 40, W); x.fillRect(W - 40, 0, 40, W); x.fillRect(0, 0, W, 34); x.fillRect(0, W - 34, W, 34);
    x.fillStyle = '#1b1208'; // ventilation holes
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { x.beginPath(); x.arc(110 + i * 58, 120 + j * 40, 9, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#2e8b3e'; x.fillRect(150, 300, 212, 120);
    x.fillStyle = '#fff'; x.font = 'bold 30px Arial'; x.textAlign = 'center';
    x.fillText('LIVE', 256, 350); x.fillText('ANIMALS', 256, 392);
    return tex(c);
  });
}

export function pharmaSkin() {
  return memo('pharma', () => {
    const W = 512; const [c, x] = canvas(W);
    x.fillStyle = '#eef1f3'; x.fillRect(0, 0, W, W);
    speckle(x, W, W, 4000, ['#e2e6e9', '#f7f8f9'], 1.2, 61, 0.6);
    x.fillStyle = '#1d4f91'; x.fillRect(0, 300, W, 70);
    x.fillStyle = '#fff'; x.font = 'bold 34px Helvetica, Arial'; x.textAlign = 'center'; x.fillText('ACTIVE  +2°C / +8°C', 256, 347);
    x.fillStyle = '#1b2228'; x.fillRect(360, 110, 110, 70);
    x.fillStyle = '#4cff8f'; x.font = 'bold 34px monospace'; x.fillText('5.1°', 415, 157);
    x.strokeStyle = 'rgba(80,90,100,0.4)'; x.lineWidth = 3; x.strokeRect(8, 8, W - 16, W - 16);
    x.fillStyle = 'rgba(45,48,52,0.85)'; x.fillRect(0, W - 22, W, 22);
    return tex(c);
  });
}

export function secureSkin() {
  return memo('secure', () => {
    const W = 256; const [c, x] = canvas(W);
    x.fillStyle = '#3c4249'; x.fillRect(0, 0, W, W);
    speckle(x, W, W, 6000, ['#353a40', '#4a5159', '#2d3237'], 1.2, 71, 0.6);
    x.strokeStyle = 'rgba(20,22,25,0.8)'; x.lineWidth = 6; x.strokeRect(14, 14, W - 28, W - 28);
    x.fillStyle = '#d9b44a'; x.fillRect(W / 2 - 18, W / 2 - 10, 36, 30);
    x.strokeStyle = '#d9b44a'; x.lineWidth = 6; x.beginPath(); x.arc(W / 2, W / 2 - 10, 13, Math.PI, 0); x.stroke();
    x.fillStyle = '#e8e8e8'; x.font = 'bold 22px Arial'; x.textAlign = 'center'; x.fillText('SECURE', W / 2, W - 34);
    return tex(c);
  });
}

export function corrugated(color = '#d9dcd8') {
  return memo('corr' + color, () => {
    const W = 256; const [c, x] = canvas(W);
    x.fillStyle = color; x.fillRect(0, 0, W, W);
    for (let i = 0; i < W; i += 8) {
      const g = x.createLinearGradient(i, 0, i + 8, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.16)'); g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.16)');
      x.fillStyle = g; x.fillRect(i, 0, 8, W);
    }
    blotches(x, W, W, 10, 'rgba(90,90,80,A)', 20, 60, 0.12, 81);
    return tex(c);
  });
}

// Text decal on transparent canvas (stand numbers, area labels).
export function label(text, { color = '#f2c230', font = 'bold 120px Helvetica, Arial', w = 512, h = 256 } = {}) {
  return memo('label' + text + color + font, () => {
    const [c, x] = canvas(w, h);
    x.clearRect(0, 0, w, h); x.fillStyle = color; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2);
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

export function hatch(color = 'rgba(215,60,50,0.85)') {
  return memo('hatch' + color, () => {
    const W = 128; const [c, x] = canvas(W);
    x.clearRect(0, 0, W, W); x.strokeStyle = color; x.lineWidth = 14;
    for (let i = -W; i < W * 2; i += 48) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + W, W); x.stroke(); }
    return tex(c);
  });
}

export function belt() {
  return memo('belt', () => {
    const H = 128; const [c, x] = canvas(32, H); // rollers run across the belt (vary along v)
    x.fillStyle = '#2a2c2f'; x.fillRect(0, 0, 32, H);
    for (let i = 0; i < H; i += 16) {
      const g = x.createLinearGradient(0, i, 0, i + 16);
      g.addColorStop(0, '#1c1d20'); g.addColorStop(0.5, '#8a8f95'); g.addColorStop(1, '#1c1d20');
      x.fillStyle = g; x.fillRect(0, i + 2, 32, 12);
    }
    return tex(c);
  });
}
