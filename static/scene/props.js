/* RELAY ground props: people, vehicles and ground equipment drawn with the engine's Pen.
   Every function takes the drawing context `g` = {pen, engine, night, time} and places one
   object. Local frames use +x forward, +y up, +z right. Shapes are illustrative. */
(() => {
'use strict';

const {MATERIAL: M, clamp, lerp, smooth} = window.RelayEngine;

const C = {
  tyre: [.07, .07, .075], hub: [.62, .64, .66], dark: [.1, .11, .13], frame: [.2, .22, .25],
  steel: [.5, .53, .56], light: [.82, .85, .87], white: [.93, .94, .95], glass: [.16, .24, .3],
  yellow: [.96, .76, .12], amber: [1, .6, .1], red: [.85, .12, .1], headlamp: [1, .96, .84],
  seat: [.14, .15, .17], rubber: [.09, .09, .1], lime: [.8, .95, .16], orange: [1, .42, .06],
  navy: [.1, .13, .2], boot: [.07, .07, .08], band: [.86, .88, .9], wand: [1, .35, .05],
  alloy: [.72, .75, .78], pallet: [.33, .36, .4], cold: [.9, .95, .98], coldStripe: [.1, .5, .85],
  blocked: [.5, .42, .42], blockedStripe: [.82, .16, .12], curtain: [.58, .64, .7],
};
const SKIN = [[.86, .66, .52], [.7, .5, .36], [.93, .76, .64], [.52, .36, .26], [.8, .6, .45]];
// Real-world proportions: one unit is about 3.2 m.
const SCALE = {tug: .65, dolly: .85, truck: .8, forklift: .7, cone: .7, seated: .62, pushback: 1, cart: 1};

// ---- wheels --------------------------------------------------------------------------
// Tyre and hub with the axle along local z; `spin` is the rolled angle, `steer` a yaw.
function wheel(g, x, z, radius, width, spin = 0, steer = 0) {
  const p = g.pen;
  p.push(x, radius, z, steer, -spin, 0);
  p.put('wheel', radius * 2, radius * 2, width, 0, 0, 0, C.tyre, M.rubber);
  p.push(0, 0, 0, 0, 0, Math.PI / 2);
  p.put('cyl', radius * 1.15, width * 1.06, radius * 1.15, 0, 0, 0, C.hub, M.steel);
  p.put('box', radius * .9, width * 1.1, radius * .2, 0, 0, 0, C.frame, M.steel);
  p.pop().pop();
}

// Headlamp lens, with a glow and a pool of light on the ground after dark.
function headlamp(g, x, y, z, size = .09, reach = 4.5) {
  const p = g.pen;
  p.put('cbox', size * .5, size, size * 1.3, x, y, z, C.headlamp, M.nightLamp);
  if (g.night > .25) {
    const [wx, wy, wz] = p.point(x + .02, y, z);
    const [fx, , fz] = p.point(x + 1, y, z);
    g.engine.glow(wx, wy, wz, size * 5, C.headlamp, g.night * .8);
    g.engine.pool(wx, wz, reach, C.headlamp, g.night * .5, Math.atan2(fz - wz, fx - wx), 1.5);
  }
}

function tailLamp(g, x, y, z, bright = 0) {
  const p = g.pen;
  p.put('cbox', .03, .07, .1, x, y, z, C.red, M.nightLamp, bright);
  if (g.night > .25 || bright > .3) {
    const [wx, wy, wz] = p.point(x - .02, y, z);
    g.engine.glow(wx, wy, wz, .34, C.red, Math.max(g.night * .5, bright * .7));
  }
}

// Amber rotating beacon.
function beacon(g, x, y, z, phase = 0, size = .09) {
  const p = g.pen, pulse = Math.pow(.5 + .5 * Math.sin(g.time * 7.5 + phase), 6);
  p.put('cyl', size, size * .9, size, x, y, z, C.amber, M.lamp, .15 + pulse * 1.4);
  const [wx, wy, wz] = p.point(x, y, z);
  g.engine.glow(wx, wy, wz, size * (5 + g.night * 6), C.amber, pulse * (.35 + g.night * .9));
}

// ---- people --------------------------------------------------------------------------
/* Seated figure (drivers). Origin at the seat cushion, facing +x. */
function seated(g, x, y, z, vest = C.lime, helmet = C.white, skin = SKIN[0], reach = .34, scale = 1) {
  const p = g.pen;
  p.push(x, y, z, 0, 0, 0, scale);
  p.put('cbox', .17, .3, .27, -.03, .2, 0, vest, M.hivis);
  p.put('box', .175, .035, .275, -.03, .2, 0, C.band, M.reflective);
  p.put('sphere', .13, .14, .13, 0, .46, 0, skin, M.skin);
  p.put('dome', .16, .16, .16, 0, .47, 0, helmet, M.gloss);
  for (const side of [-1, 1]) {
    p.push(.02, .05, side * .08, 0, Math.PI / 2 - .12);
    p.put('limb', .085, .3, .085, 0, 0, 0, C.navy, M.cloth);
    p.pop();
    p.push(.3, .03, side * .08, 0, .25);
    p.put('limb', .075, .28, .075, 0, 0, 0, C.navy, M.cloth);
    p.pop();
    p.push(-.02, .32, side * .14, 0, 1.05, side * -.12);
    p.put('limb', .065, reach * .62, .065, 0, 0, 0, vest, M.hivis);
    p.push(0, -reach * .62, 0, 0, .55);
    p.put('limb', .055, reach * .58, .055, 0, 0, 0, skin, M.skin);
    p.pop().pop();
  }
  p.pop();
}

/* Standing, walking or working crew member.
   `w` carries position, heading, speed and distance walked; the gait is driven by distance
   so that feet stay planted, and the hips ride on whichever leg is more extended. */
function person(g, w) {
  const p = g.pen, t = g.time, seed = w.index || 0;
  const H = .9 * (w.build || 1);
  const thigh = .245 * H, shin = .245 * H, foot = .035 * H;
  const speed = w.speed || 0;
  const moving = smooth(speed / .8), jog = smooth((speed - 1.8) / .9);
  const swing = (.42 + .2 * jog) * moving;
  // One gait cycle (two steps) covers this much ground.
  const stride = 3.6 * (thigh + shin) * Math.sin(.42 + .2 * jog);
  const walked = w.stride - (w.lastStride ?? w.stride);
  w.lastStride = w.stride;
  w.gait = ((w.gait ?? seed * 1.7) + walked / stride * Math.PI * 2) % (Math.PI * 2);
  const phase = w.gait;
  const act = w.act || 'idle';
  const still = 1 - moving;
  const sway = Math.sin(t * .7 + seed * 2.1) * still;

  const legs = [-1, 1].map(side => {
    const a = phase + (side > 0 ? Math.PI : 0);
    const hip = swing * Math.sin(a) + .05 * moving + side * .04 * still * sway;
    const knee = moving * ((.95 + .45 * jog) * Math.pow(Math.max(0, Math.cos(a + .55)), 1.4) + .1) + .04 * still;
    return {side, hip, knee, reach: thigh * Math.cos(hip) + shin * Math.cos(hip - knee), a};
  });
  const hipHeight = Math.max(legs[0].reach, legs[1].reach) + foot + .012 * H * jog * Math.abs(Math.sin(phase));
  const lean = -(.05 + .13 * jog) * moving;
  const twist = .08 * Math.sin(phase) * moving;

  const vest = w.busy ? C.orange : C.lime, helmet = w.busy ? C.white : C.yellow;
  const skin = SKIN[seed % SKIN.length];

  p.push(w.x, 0, w.z, w.heading);
  p.push(0, hipHeight, sway * .012 * H, 0, lean, 0);

  // Legs.
  for (const leg of legs) {
    p.push(0, 0, leg.side * .058 * H, 0, leg.hip, 0);
    p.put('limb', .1 * H, thigh, .1 * H, 0, .01, 0, C.navy, M.cloth);
    p.push(0, -thigh, 0, 0, -leg.knee, 0);
    p.put('limb', .082 * H, shin, .082 * H, 0, 0, 0, C.navy, M.cloth);
    // Keep the sole near level; let the toe drop as the foot leaves the ground.
    const toe = moving * .5 * Math.pow(Math.max(0, Math.sin(leg.a + 2.4)), 2);
    p.push(0, -shin, 0, 0, -(leg.hip - leg.knee) - toe, 0);
    p.put('cbox', .15 * H, foot * 1.5, .068 * H, .035 * H, -foot * .2, 0, C.boot, M.rubber);
    p.pop().pop().pop();
  }

  // Pelvis and torso.
  p.put('cbox', .13 * H, .1 * H, .2 * H, 0, .03 * H, 0, C.navy, M.cloth);
  p.push(0, .07 * H, 0, twist, 0, 0);
  const breathe = 1 + .012 * Math.sin(t * 1.6 + seed);
  p.put('cbox', .145 * H * breathe, .25 * H, .23 * H, 0, .135 * H, 0, vest, M.hivis);
  for (const y of [.07, .16]) p.put('box', .15 * H, .022 * H, .236 * H, 0, y * H, 0, C.band, M.reflective);
  for (const side of [-1, 1]) p.put('box', .152 * H, .2 * H, .02 * H, 0, .16 * H, side * .07 * H, C.band, M.reflective);

  // Arms.
  for (const side of [-1, 1]) {
    const a = phase + (side > 0 ? 0 : Math.PI);          // opposite to the leg on this side
    let shoulder = swing * .8 * Math.sin(a) + .03, out = side * -.07, elbow = .18 + .55 * jog + .2 * moving * Math.max(0, Math.sin(a));
    if (act === 'marshal') {
      // Beckon the tug in: upper arms raised, forearms waving back over the shoulders.
      shoulder = lerp(shoulder, 2.25, still);
      out = lerp(out, side * -.45, still);
      elbow = lerp(elbow, .9 + .7 * Math.sin(t * 5.2), still);
    } else if (act === 'operate' && side > 0) {
      // Right hand on the loader controls.
      shoulder = lerp(shoulder, 1.0 + .06 * Math.sin(t * 2.3 + seed), still);
      elbow = lerp(elbow, .55 + .1 * Math.sin(t * 3.1), still);
    } else if (act === 'operate') {
      shoulder = lerp(shoulder, .25, still);
      elbow = lerp(elbow, 1.1, still);
    } else if (seed % 3 === 1) {
      // Hands clasped in front while waiting.
      shoulder = lerp(shoulder, .28, still);
      out = lerp(out, side * .16, still);
      elbow = lerp(elbow, .75, still);
    }
    p.push(0, .245 * H, side * .135 * H, 0, shoulder, out);
    p.put('sphere', .085 * H, .085 * H, .085 * H, 0, 0, 0, vest, M.hivis);
    p.put('limb', .075 * H, .165 * H, .075 * H, 0, 0, 0, vest, M.hivis);
    p.push(0, -.165 * H, 0, 0, elbow, 0);
    p.put('limb', .064 * H, .15 * H, .064 * H, 0, 0, 0, vest, M.hivis);
    p.put('sphere', .06 * H, .07 * H, .06 * H, 0, -.165 * H, 0, skin, M.skin);
    if (act === 'marshal') p.put('limb', .028 * H, .3 * H, .028 * H, 0, -.17 * H, 0, C.wand, M.lamp, .9);
    p.pop().pop();
  }

  // Neck, head, ear defenders, hard hat.
  const look = act === 'operate' ? .35 : .45 * Math.sin(t * .45 + seed * 1.9) * still - twist * .7;
  const nod = act === 'operate' ? .22 : 0;
  p.put('cyl', .055 * H, .05 * H, .055 * H, 0, .285 * H, 0, skin, M.skin);
  p.push(0, .345 * H, 0, look, nod, 0);
  p.put('sphere', .125 * H, .14 * H, .125 * H, .005 * H, 0, 0, skin, M.skin);
  p.put('dome', .16 * H, .17 * H, .16 * H, 0, .012 * H, 0, helmet, M.gloss);
  p.put('cbox', .08 * H, .012 * H, .13 * H, .08 * H, .02 * H, 0, helmet, M.gloss);
  for (const side of [-1, 1]) p.put('sphere', .04 * H, .06 * H, .03 * H, 0, -.005 * H, side * .068 * H, C.dark, M.matte);
  p.pop().pop().pop().pop();
}

// ---- unit load device ------------------------------------------------------------------
/* One container. `lid` is the colour of its deadline state; `glow` lights the lid. */
function container(g, x, y, z, heading, job, lid, glow = 0, scale = 1) {
  const p = g.pen;
  const tall = (job.priority >= 3 ? .92 : job.priority === 2 ? .8 : .68) * scale;
  const w = .88 * scale, d = .8 * scale;
  const body = job.blocked ? C.blocked : job.cold ? C.cold : C.alloy;
  p.push(x, y, z, heading);
  p.put('cbox', w, .05 * scale, d, 0, .025 * scale, 0, C.pallet, M.steel);
  p.put('cbox', w * .97, tall - .05 * scale, d * .97, 0, tall / 2 + .02 * scale, 0, body, job.cold ? M.gloss : M.alloy);
  // Corner posts and a fabric door on one face.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.put('box', .035 * scale, tall - .06 * scale, .035 * scale, sx * w * .48, tall / 2 + .02 * scale, sz * d * .48, C.steel, M.steel);
  }
  p.put('box', w * .8, tall * .74, .012, 0, tall * .5, d * .49, job.cold ? C.light : C.curtain, M.cloth);
  if (job.cold) {
    p.put('box', w * .985, tall * .16, d * .985, 0, tall * .62, 0, C.coldStripe, M.gloss);
    p.put('cbox', .1 * scale, tall * .5, d * .6, -w * .5, tall * .45, 0, C.light, M.steel);
  }
  if (job.blocked) p.put('box', w * .985, tall * .14, d * .985, 0, tall * .55, 0, C.blockedStripe, M.paint);
  // Deadline state: lid panel and a band under the roof edge.
  p.put('cbox', w * .9, .035 * scale, d * .9, 0, tall + .015 * scale, 0, lid, M.paint, glow);
  p.put('box', w * .99, .05 * scale, d * .99, 0, tall - .06 * scale, 0, lid, M.paint, glow * .6);
  p.pop();
}

// Plain parked container for storage racks and truck loads.
function crate(g, x, y, z, heading, tall = .78, tint = C.alloy) {
  const p = g.pen;
  p.push(x, y, z, heading);
  p.put('cbox', .88, .05, .8, 0, .025, 0, C.pallet, M.steel);
  p.put('cbox', .85, tall - .05, .78, 0, tall / 2 + .02, 0, tint, M.alloy);
  p.put('box', .7, tall * .7, .012, 0, tall * .5, .392, C.curtain, M.cloth);
  p.pop();
}

// ---- tow tractor and dolly -------------------------------------------------------------
function tug(g, pose, color, options = {}) {
  const k = SCALE.tug, p = g.pen, spin = (pose.distance || 0) / (.19 * k), steer = pose.steer || 0;
  p.push(pose.x, 0, pose.z, pose.heading, 0, 0, k);
  // Chassis, bonnet, rear ballast.
  p.put('cbox', 1.42, .26, .7, 0, .36, 0, color, M.gloss);
  p.put('cbox', .5, .2, .64, .43, .56, 0, color, M.gloss);
  p.put('cbox', .36, .16, .66, -.5, .55, 0, C.frame, M.steel);
  p.put('cbox', .08, .14, .72, .73, .3, 0, C.dark, M.rubber);
  p.put('cbox', .08, .1, .6, -.74, .3, 0, C.dark, M.rubber);
  p.put('box', .02, .1, .5, .69, .52, 0, C.dark, M.matte);
  // Seat, dashboard, steering wheel.
  p.put('cbox', .3, .06, .34, -.16, .52, 0, C.seat, M.rubber);
  p.put('cbox', .06, .34, .34, -.33, .7, 0, C.seat, M.rubber);
  p.put('cbox', .1, .22, .5, .17, .68, 0, C.dark, M.matte);
  p.push(.07, .82, 0, 0, -.9, 0);
  p.put('cyl', .2, .02, .2, 0, 0, 0, C.dark, M.rubber);
  p.pop();
  // Cab frame, roof, windscreen.
  for (const sx of [-.36, .22]) for (const sz of [-1, 1]) p.put('box', .035, .68, .035, sx, .96, sz * .32, C.frame, M.steel);
  p.put('cbox', .78, .045, .72, -.07, 1.31, 0, C.white, M.paint);
  p.push(.24, .98, 0, 0, .12, 0);
  p.put('box', .015, .56, .6, 0, 0, 0, C.glass, M.glass);
  p.pop();
  if (options.driver !== false) seated(g, -.17, .55, 0, C.lime, C.white, SKIN[options.seed % SKIN.length || 0]);
  beacon(g, -.07, 1.38, 0, pose.x);
  for (const sz of [-1, 1]) {
    headlamp(g, .75, .5, sz * .24);
    tailLamp(g, -.72, .5, sz * .26, options.braking ? 1 : 0);
  }
  // Mudguards and wheels.
  for (const sx of [-.44, .44]) for (const sz of [-1, 1]) {
    p.put('cbox', .46, .04, .16, sx, .43, sz * .36, C.dark, M.rubber);
    wheel(g, sx, sz * .36, .19, .15, spin, sx > 0 ? steer : 0);
  }
  p.put('cbox', .16, .05, .06, -.8, .28, 0, C.steel, M.steel);
  p.pop();
}

function dolly(g, pose, tugPose) {
  const k = SCALE.dolly, p = g.pen, spin = (pose.distance || 0) / (.11 * k);
  p.push(pose.x, 0, pose.z, pose.heading, 0, 0, k);
  p.put('cbox', 1.16, .07, .92, 0, .27, 0, C.frame, M.steel);
  for (const sz of [-1, 1]) p.put('cbox', 1.16, .05, .05, 0, .33, sz * .45, C.yellow, M.paint);
  for (let k = -3; k <= 3; k++) {
    p.push(k * .15, .315, 0, 0, 0, Math.PI / 2);
    p.put('cyl', .045, .78, .045, 0, 0, 0, C.steel, M.metal);
    p.pop();
  }
  for (const sx of [-.4, .4]) for (const sz of [-1, 1]) wheel(g, sx, sz * .36, .11, .09, spin);
  p.pop();
  if (tugPose) {
    // Drawbar from the dolly's nose to the tractor's hitch.
    const ax = pose.x + Math.cos(pose.heading) * .58 * k, az = pose.z + Math.sin(pose.heading) * .58 * k;
    const bx = tugPose.x - Math.cos(tugPose.heading) * .8 * SCALE.tug, bz = tugPose.z - Math.sin(tugPose.heading) * .8 * SCALE.tug;
    const length = Math.hypot(bx - ax, bz - az);
    p.push((ax + bx) / 2, .21, (az + bz) / 2, Math.atan2(bz - az, bx - ax));
    p.put('box', length, .035, .045, 0, 0, 0, C.steel, M.steel);
    p.pop();
  }
}

// ---- forklift ------------------------------------------------------------------------
// `carry` is how high the forks are raised (0 on the ground).
function forklift(g, x, z, heading, carry = .16, distance = 0) {
  const k = SCALE.forklift, p = g.pen, spin = distance / (.15 * k);
  carry /= k;
  p.push(x, 0, z, heading, 0, 0, k);
  p.put('cbox', .92, .36, .58, -.05, .37, 0, C.yellow, M.gloss);
  p.put('cbox', .3, .34, .6, -.48, .5, 0, C.frame, M.steel);
  p.put('cbox', .3, .05, .36, -.14, .58, 0, C.seat, M.rubber);
  p.put('cbox', .05, .3, .36, -.29, .74, 0, C.seat, M.rubber);
  for (const sx of [-.4, .2]) for (const sz of [-1, 1]) p.put('box', .035, .72, .035, sx, .92, sz * .26, C.frame, M.steel);
  p.put('cbox', .7, .035, .6, -.1, 1.29, 0, C.frame, M.steel);
  // Mast, carriage and forks.
  for (const sz of [-1, 1]) p.put('box', .05, 1.3, .05, .45, .7, sz * .2, C.frame, M.steel);
  p.put('box', .05, .05, .5, .45, 1.34, 0, C.frame, M.steel);
  p.put('cbox', .04, .3, .5, .49, carry + .18, 0, C.dark, M.steel);
  for (const sz of [-1, 1]) p.put('box', .8, .025, .08, .9, carry + .02, sz * .2, C.steel, M.metal);
  seated(g, -.15, .61, 0, C.lime, C.yellow, SKIN[2], .3);
  beacon(g, -.1, 1.35, 0, x * 3, .07);
  headlamp(g, .4, .62, .22, .07, 3);
  headlamp(g, .4, .62, -.22, .07, 3);
  for (const sx of [-.36, .28]) for (const sz of [-1, 1]) wheel(g, sx, sz * .27, sx > 0 ? .16 : .13, .12, spin);
  p.pop();
}

// ---- road truck ------------------------------------------------------------------------
function truck(g, pose, loaded, braking, distance) {
  const k = SCALE.truck, p = g.pen, spin = distance / (.27 * k);
  p.push(pose.x, 0, pose.z, pose.heading, 0, 0, k);
  // Cab.
  p.put('cbox', 1.02, 1.12, 1.24, 1.58, .98, 0, C.white, M.gloss);
  p.put('cbox', .3, .34, 1.26, 1.98, .56, 0, C.frame, M.steel);
  p.push(2.085, 1.2, 0, 0, .1, 0);
  p.put('box', .02, .5, 1.1, 0, 0, 0, C.glass, M.glass);
  p.pop();
  for (const sz of [-1, 1]) {
    p.put('box', .5, .4, .015, 1.72, 1.22, sz * .625, C.glass, M.glass);
    p.put('cbox', .05, .2, .1, 1.96, 1.3, sz * .72, C.dark, M.matte);
    headlamp(g, 2.1, .62, sz * .44, .12, 7);
    tailLamp(g, -2.08, .56, sz * .5, braking ? 1 : 0);
    p.put('box', .04, .03, .03, 1.9, 1.56, sz * .4, C.amber, M.nightLamp);
  }
  p.put('cbox', .1, .1, 1.3, 2.12, .42, 0, C.dark, M.rubber);
  p.put('cyl', .07, .9, .07, 1.0, 1.25, .56, C.steel, M.chrome);
  // Chassis, flatbed and headboard.
  p.put('cbox', 3.9, .14, .7, .1, .5, 0, C.frame, M.steel);
  p.put('cbox', 3.0, .08, 1.28, -.58, .64, 0, C.steel, M.steel);
  p.put('cbox', .06, .7, 1.28, .92, 1.0, 0, C.steel, M.steel);
  for (const sz of [-1, 1]) p.put('box', 3.0, .1, .03, -.58, .73, sz * .63, C.yellow, M.paint);
  if (loaded) {
    for (const [k, sx] of [-1.6, -.62, .36].entries()) crate(g, sx, .68, 0, 0, .74 + (k % 2) * .1, k === 1 ? C.cold : C.alloy);
  }
  for (const sx of [-1.55, -.75, 1.55]) for (const sz of [-1, 1]) {
    p.put('cbox', .7, .05, .2, sx, .58, sz * .56, C.dark, M.rubber);
    wheel(g, sx, sz * .55, .27, sx < 0 ? .3 : .2, spin);
  }
  p.pop();
}

// ---- cargo loader beside the aircraft door ------------------------------------------------
/* Scissor platform. `side` is which side of the stand it serves, `platform` the height of
   its deck, `crewed` whether a crew member is assigned to the stand. */
function loader(g, point, side, platform, crewed) {
  const p = g.pen;
  const body = crewed ? C.yellow : [.6, .6, .56];
  p.push(point.x, 0, point.z, -side * Math.PI / 2);     // local +x points at the fuselage
  p.put('cbox', 2.35, .16, 1.2, 0, .2, 0, body, M.paint);
  for (const sx of [-.8, .8]) for (const sz of [-1, 1]) wheel(g, sx, sz * .52, .13, .14);
  // Scissor arms.
  const rise = platform - .3, reach = 1.9, angle = Math.asin(clamp(rise / reach, 0, .9));
  for (const sz of [-1, 1]) for (const direction of [-1, 1]) {
    p.push(0, .28 + rise / 2, sz * .5, 0, direction * angle, 0);
    p.put('box', reach, .06, .05, 0, 0, 0, C.frame, M.steel);
    p.pop();
  }
  // Deck with rollers, side rails and the bridge that meets the door sill.
  p.put('cbox', 2.3, .05, 1.16, 0, platform - .03, 0, C.steel, M.steel);
  for (let k = -5; k <= 5; k++) {
    p.push(k * .2, platform + .002, 0, 0, 0, Math.PI / 2);
    p.put('cyl', .05, 1.0, .05, 0, 0, 0, C.light, M.metal);
    p.pop();
  }
  for (const sz of [-1, 1]) {
    p.put('cbox', 2.3, .05, .04, 0, platform + .2, sz * .58, body, M.paint);
    for (const sx of [-1.1, -.37, .37, 1.1]) p.put('box', .035, .22, .035, sx, platform + .09, sz * .58, body, M.paint);
  }
  p.put('cbox', .1, .1, 1.16, 1.2, platform - .04, 0, C.rubber, M.rubber);
  // Control console at the outer end, on the nose side.
  p.put('cbox', .22, .5, .2, -.95, platform + .27, -side * .5, C.frame, M.steel);
  p.put('cbox', .18, .04, .16, -.95, platform + .54, -side * .5, C.dark, M.matte);
  beacon(g, -1.05, platform + .6, side * .5, point.z, .06);
  if (g.night > .25 && crewed) {
    const [wx, wy, wz] = p.point(-.95, platform + .7, -side * .5);
    p.put('cbox', .1, .05, .1, -.95, platform + .66, -side * .5, C.headlamp, M.nightLamp);
    g.engine.glow(wx, wy, wz, .5, C.headlamp, g.night * .6);
  }
  p.pop();
}

// ---- pushback tractor ------------------------------------------------------------------
function pushback(g, x, z, heading, distance = 0, towbar = 0) {
  const p = g.pen, spin = distance / .24;
  g.night = g.night || 0;
  p.push(x, 0, z, heading);
  p.put('cbox', 2.0, .36, 1.14, 0, .42, 0, C.white, M.gloss);
  p.put('cbox', 2.02, .07, 1.16, 0, .26, 0, C.yellow, M.paint);
  p.put('cbox', .62, .34, .7, .35, .76, 0, C.white, M.gloss);
  p.put('box', .64, .22, .72, .35, .8, 0, C.glass, M.glass);
  p.put('cbox', .66, .04, .74, .35, .95, 0, C.white, M.gloss);
  beacon(g, .35, .99, 0, x);
  for (const sz of [-1, 1]) { headlamp(g, 1.0, .5, sz * .4, .09, 5); tailLamp(g, -1.0, .5, sz * .42); }
  for (const sx of [-.62, .62]) for (const sz of [-1, 1]) wheel(g, sx, sz * .5, .24, .2, spin);
  if (towbar > 0) p.put('box', towbar, .05, .06, 1.0 + towbar / 2, .2, 0, C.steel, M.steel);
  p.pop();
}

// ---- personnel cart ----------------------------------------------------------------------
// Open electric cart with a canopy; `driver` is the crew member at the wheel, if any.
function cart(g, c, driver, index = 0) {
  const p = g.pen, spin = (c.distance || 0) / .1;
  p.push(c.x, 0, c.z, c.heading);
  const body = [.95, .95, .93];
  p.put('cbox', .86, .14, .46, 0, .18, 0, body, M.gloss);
  p.put('cbox', .22, .12, .44, .33, .3, 0, body, M.gloss);
  p.put('cbox', .2, .06, .42, -.06, .3, 0, C.seat, M.rubber);
  p.put('cbox', .05, .16, .42, -.17, .39, 0, C.seat, M.rubber);
  p.put('cbox', .2, .05, .42, -.32, .3, 0, C.frame, M.steel);
  for (const sx of [-.38, .23]) for (const sz of [-1, 1]) p.put('box', .025, .38, .025, sx, .53, sz * .2, C.frame, M.steel);
  p.put('cbox', .7, .03, .48, -.07, .73, 0, C.white, M.paint);
  p.push(.24, .53, 0, 0, .25, 0);
  p.put('box', .01, .3, .42, 0, 0, 0, C.glass, M.glass);
  p.pop();
  p.push(.12, .4, -.1, 0, -.9, 0);
  p.put('cyl', .1, .015, .1, 0, 0, 0, C.dark, M.rubber);
  p.pop();
  beacon(g, -.1, .76, 0, index * 1.7 + c.x, .035);
  for (const sz of [-1, 1]) { headlamp(g, .44, .22, sz * .17, .04, 2.2); tailLamp(g, -.44, .22, sz * .18); }
  for (const sx of [-.27, .27]) for (const sz of [-1, 1]) wheel(g, sx, sz * .2, .085, .07, spin);
  if (driver) seated(g, -.07, .31, -.1, driver.busy ? C.orange : C.lime, driver.busy ? C.white : C.yellow,
    SKIN[driver.index % SKIN.length], .3, SCALE.seated);
  p.pop();
}

// Traffic cone and wheel chock.
function cone(g, x, z) {
  const p = g.pen;
  p.push(x, 0, z, 0, 0, 0, SCALE.cone);
  p.put('cbox', .2, .02, .2, 0, .01, 0, C.orange, M.paint);
  p.put('cone', .15, .3, .15, 0, .02, 0, C.orange, M.paint);
  p.put('cyl', .085, .05, .085, 0, .19, 0, C.white, M.reflective);
  p.pop();
}
function chock(g, x, z, heading) {
  const p = g.pen;
  p.push(x, 0, z, heading);
  p.put('cbox', .1, .08, .3, 0, .04, 0, C.yellow, M.rubber);
  p.pop();
}

window.RelayProps = {C, SKIN, SCALE, cart, wheel, headlamp, tailLamp, beacon, seated, person, container, crate, tug, dolly, forklift, truck, loader, pushback, cone, chock};
})();
