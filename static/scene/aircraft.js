/* Four-engine jumbo freighter in local coordinates. +X points through the nose, +Y is up,
   +Z is the starboard wing; the main gear stands on y = 0 and the airframe is 10 units long.
   Positions and smooth normals are interleaved for one static GPU buffer per material.
   Illustrative proportions, not a surveyed airframe. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const AROUND = 40;

  // [x, bottom, top, half width]: the forward sections carry the raised upper deck.
  const bodyStations = [
    [5, .6, .6, 0], [4.985, .55, .67, .055], [4.95, .5, .75, .105], [4.89, .46, .83, .155], [4.82, .43, .9, .2],
    [4.72, .39, .98, .25], [4.62, .36, 1.05, .29], [4.52, .345, 1.12, .32], [4.42, .33, 1.18, .345],
    [4.32, .32, 1.245, .367], [4.22, .31, 1.3, .385], [4.12, .305, 1.345, .399], [4.02, .3, 1.38, .41], [3.8, .3, 1.42, .423], [3.6, .3, 1.44, .43],
    [2.6, .3, 1.44, .43], [1.9, .3, 1.38, .43], [1.3, .3, 1.23, .43], [.85, .3, 1.16, .43],
    [-1.6, .3, 1.16, .43], [-2.6, .36, 1.16, .41], [-3.4, .5, 1.15, .34], [-4.1, .66, 1.13, .23],
    [-4.6, .8, 1.1, .12], [-4.93, .92, 1.04, .045], [-5, .98, .98, 0],
  ];

  // Outline of one fuselage section, starting at the crown and running to starboard.
  function bodyRing([x, bottom, top, width]) {
    const centre = Math.min(bottom + width, (bottom + top) / 2);
    const upper = top - centre, lower = centre - bottom;
    const hump = Math.max(0, Math.min(1, (upper - width) / .28));
    const ring = [];
    for (let j = 0; j < AROUND; j++) {
      const angle = TAU * j / AROUND, c = Math.cos(angle), s = Math.sin(angle);
      const narrow = c > 0 ? 1 - .3 * hump * Math.pow(c, 1.4) : 1;
      ring.push([x, centre + (c > 0 ? upper : lower) * c, width * s * narrow]);
    }
    return ring;
  }

  function meshBuilder() {
    const groups = {body: [], belly: [], metal: [], teal: [], glass: [], dark: [], gear: [], tyre: []};
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return l < 1e-9 ? null : [v[0] / l, v[1] / l, v[2] / l]; };
    const centroid = ring => ring.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]).map(v => v / ring.length);

    function triangle(material, a, na, b, nb, c, nc) {
      const g = cross(sub(b, a), sub(c, a));
      if (Math.hypot(...g) < 1e-12) return;
      if (g[0] * (na[0] + nb[0] + nc[0]) + g[1] * (na[1] + nb[1] + nc[1]) + g[2] * (na[2] + nb[2] + nc[2]) < 0) {
        [b, c, nb, nc] = [c, b, nc, nb];
      }
      groups[material].push(...a, ...na, ...b, ...nb, ...c, ...nc);
    }

    /* Skin a stack of closed rings with smooth normals. `material` is a name or (ring, panel) => name;
       `inward` turns the surface inside out (engine intakes); `prefer` is the way end caps and
       discs should face, where "away from the axis" says nothing. */
    function skin(rings, material, {inward = false, prefer = null} = {}) {
      const count = rings[0].length, centres = rings.map(centroid);
      const normals = rings.map((ring, i) => ring.map((point, j) => {
        const around = sub(ring[(j + 1) % count], ring[(j + count - 1) % count]);
        const along = sub(rings[Math.min(i + 1, rings.length - 1)][j], rings[Math.max(i - 1, 0)][j]);
        let n = unit(cross(around, along));
        if (!n) {
          // Collapsed ring (a tip): point along the axis, away from the neighbouring section.
          if (prefer) return prefer;
          const other = centres[i === 0 ? 1 : i - 1];
          n = unit(sub(centres[i], other)) || [1, 0, 0];
          return inward ? n.map(v => -v) : n;
        }
        const out = unit(sub(point, centres[i])) || [0, 0, 0];
        let facing = n[0] * out[0] + n[1] * out[1] + n[2] * out[2];
        if (prefer) facing += 2 * (n[0] * prefer[0] + n[1] * prefer[1] + n[2] * prefer[2]);
        return (facing >= 0) !== inward ? n : n.map(v => -v);
      }));
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < count; j++) {
        const k = (j + 1) % count;
        const name = typeof material === 'function' ? material(i, j) : material;
        triangle(name, rings[i][j], normals[i][j], rings[i][k], normals[i][k], rings[i + 1][k], normals[i + 1][k]);
        triangle(name, rings[i][j], normals[i][j], rings[i + 1][k], normals[i + 1][k], rings[i + 1][j], normals[i + 1][j]);
      }
    }

    // Flat two-sided panel.
    function panel(material, a, b, c, d) {
      const n = unit(cross(sub(b, a), sub(c, a))), back = n.map(v => -v);
      for (const normal of [n, back]) {
        triangle(material, a, normal, b, normal, c, normal);
        triangle(material, a, normal, c, normal, d, normal);
      }
    }

    const circle = (axis, centre, radius, count = 16) => Array.from({length: count}, (_, j) => {
      const angle = TAU * j / count, c = Math.cos(angle) * radius, s = Math.sin(angle) * radius;
      if (axis === 'x') return [centre[0], centre[1] + c, centre[2] + s];
      if (axis === 'z') return [centre[0] + c, centre[1] + s, centre[2]];
      return [centre[0] + c, centre[1], centre[2] + s];
    });

    // Aerofoil ring at one span station: [span, leading x, trailing x, height, thickness].
    function aerofoil([span, lead, trail, y, thickness], side, vertical = false) {
      const chord = lead - trail;
      const outline = [[0, 0], [.04, .55], [.22, 1], [.55, .8], [.85, .32], [1, 0], [.85, -.2], [.55, -.42], [.22, -.5], [.04, -.3]];
      return outline.map(([along, height]) => vertical
        ? [lead - chord * along, span, height * thickness * side]
        : [lead - chord * along, y + height * thickness, span * side]);
    }

    // ---- fuselage ----
    skin(bodyStations.map(bodyRing), (ring, panel) => {
      const fromCrown = Math.min(panel, AROUND - 1 - panel);
      if (ring >= 5 && ring <= 7 && fromCrown >= 3 && fromCrown <= 6) return 'glass';
      return fromCrown >= 14 ? 'belly' : 'body';
    });

    // Main-deck cargo doorway on each side, following the hull, with the door swung up above it.
    const hull = (x, y) => {
      const i = bodyStations.findIndex(st => st[0] <= x);
      const a = bodyStations[i - 1], b = bodyStations[i], t = (a[0] - x) / (a[0] - b[0]);
      const [, bottom, top, width] = a.map((v, k) => v + (b[k] - v) * t);
      const centre = Math.min(bottom + width, (bottom + top) / 2), upper = top - centre, lower = centre - bottom;
      const hump = Math.max(0, Math.min(1, (upper - width) / .28));
      const c = Math.max(-1, Math.min(1, (y - centre) / (y > centre ? upper : lower)));
      return width * Math.sqrt(1 - c * c) * (c > 0 ? 1 - .3 * hump * Math.pow(c, 1.4) : 1);
    };
    for (const side of [-1, 1]) {
      const x0 = 2.62, x1 = 3.18, steps = 8;
      for (let k = 0; k < steps; k++) {
        const y0 = .48 + .52 * k / steps, y1 = .48 + .52 * (k + 1) / steps;
        panel('dark', [x0, y0, side * (hull(x0, y0) + .006)], [x1, y0, side * (hull(x1, y0) + .006)],
          [x1, y1, side * (hull(x1, y1) + .006)], [x0, y1, side * (hull(x0, y1) + .006)]);
      }
      const top = hull(2.9, 1.0);
      panel('body', [x0 - .02, 1.0, side * top], [x1 + .02, 1.0, side * top], [x1 + .02, 1.24, side * (top + .46)], [x0 - .02, 1.24, side * (top + .46)]);
    }
    // Main-deck side door outline, aft of the wing on the port side.
    panel('belly', [-2.5, .78, -.437], [-1.85, .78, -.437], [-1.85, .8, -.437], [-2.5, .8, -.437]);

    // ---- wings, tailplane, fin ----
    const wing = [[.4, 1.35, -1.15, .52, .115], [1.5, .56, -1.0, .6, .085], [3, -.55, -1.52, .74, .05],
      [4.5, -1.65, -2.08, .9, .026], [4.78, -2.02, -2.2, .94, .006]];
    const tailplane = [[.1, -3.72, -4.62, 1.0, .06], [1.75, -4.55, -4.92, 1.15, .022], [1.9, -4.7, -4.95, 1.17, .004]];
    for (const side of [-1, 1]) {
      skin(wing.map(section => aerofoil(section, side)), ring => ring === wing.length - 2 ? 'teal' : 'metal');
      skin(tailplane.map(section => aerofoil(section, side)), 'metal');
    }
    const fin = [[1.08, -3.15, -4.75, 0, .09], [1.9, -3.86, -4.88, 0, .062], [2.5, -4.38, -4.97, 0, .034], [2.6, -4.52, -4.99, 0, .006]];
    skin(fin.map(section => aerofoil(section, 1, true)), 'teal');

    // ---- engines: inboard and outboard on each wing ----
    const engines = [];
    for (const side of [-1, 1]) for (const [span, lead, wingY] of [[1.95, .23, .64], [3.25, -.73, .77]]) {
      const z = span * side, y = wingY - .27, lip = lead + 1.02;
      engines.push([lip, y, z]);
      skin([[0, .182], [-.05, .208], [-.5, .216], [-.86, .19], [-.96, .168]].map(([dx, r]) => circle('x', [lip + dx, y, z], r, 20)),
        ring => ring === 0 ? 'metal' : ring === 1 ? 'teal' : 'body');
      skin([[0, .182], [-.03, .168], [-.2, .16]].map(([dx, r]) => circle('x', [lip + dx, y, z], r, 20)), 'dark', {inward: true});
      skin([[-.2, .16], [-.2, .05], [-.06, 0]].map(([dx, r]) => circle('x', [lip + dx, y, z], r, 20)), ring => ring === 0 ? 'dark' : 'metal', {prefer: [1, 0, 0]});
      skin([[-.96, .168], [-.96, .125], [-1.22, .09], [-1.45, 0]].map(([dx, r]) => circle('x', [lip + dx, y, z], r, 20)), 'metal', {prefer: [-1, 0, 0]});
      // Pylon from the nacelle crown up to the wing.
      const pylon = (x, top, bottom, half) => [[x, top, z - half], [x, top, z + half], [x, bottom, z + half], [x, bottom, z - half]];
      skin([pylon(lip - .12, y + .2, y + .19, .012), pylon(lip - .5, wingY + .02, y + .2, .03), pylon(lead - .45, wingY + .01, y + .12, .02)], 'body');
    }
    // Flap-track fairings under the trailing edge.
    for (const side of [-1, 1]) for (const [span, x, y] of [[1.15, -.75, .5], [2.4, -1.02, .62], [3.6, -1.6, .76]]) {
      skin([[.55, 0], [.3, .05], [-.1, .06], [-.42, 0]].map(([dx, r]) => circle('x', [x + dx, y - r * .4, span * side], r, 10)), 'metal');
    }

    // ---- landing gear: nose pair and four main bogies ----
    const wheel = (x, y, z, r, width) => {
      skin([[-.5, r * .55], [-.46, r * .9], [-.36, r], [.36, r], [.46, r * .9], [.5, r * .55]]
        .map(([dz, radius]) => circle('z', [x, y, z + dz * width], radius, 14)), 'tyre');
      for (const face of [-1, 1]) {
        skin([[face * .5, r * .55], [face * .3, 0]].map(([dz, radius]) => circle('z', [x, y, z + dz * width], radius, 14)), 'gear', {prefer: [0, 0, face]});
      }
    };
    const strut = (x, z, top, bottom, r) => skin([[top, r], [bottom, r * .8]].map(([y, radius]) => circle('y', [x, y, z], radius, 10)), 'gear');
    strut(3.75, 0, .4, .1, .035);
    for (const z of [-.085, .085]) wheel(3.75, .095, z, .095, .06);
    for (const [x, z] of [[-.42, -.74], [-.42, .74], [-1.0, -.27], [-1.0, .27]]) {
      strut(x, z, .5, .12, .045);
      for (const dx of [-.125, .125]) for (const dz of [-.09, .09]) wheel(x + dx, .105, z + dz, .105, .075);
      skin([[x - .2, .03], [x + .2, .03]].map(([px, r]) => circle('x', [px, .12, z], r, 8)), 'gear');
    }

    return {
      meshes: Object.fromEntries(Object.entries(groups).map(([name, data]) => [name, new Float32Array(data)])),
      engines,
    };
  }

  const built = meshBuilder();

  // Lamp positions in model space.
  const lights = {
    port: [-2.08, .95, -4.78], starboard: [-2.08, .95, 4.78], tail: [-5, 1, 0],
    beaconTop: [.6, 1.19, 0], beaconBelly: [.2, .29, 0],
    landing: [[1.15, .56, -.62], [1.15, .56, .62], [3.78, .33, 0]],
    logo: [-4.1, 1.9, 0],
  };

  // Orthographic silhouette for browsers without WebGL2.
  function drawPlan(context, pose, scale, accent, showWindows) {
    context.save();
    context.translate(pose.x, pose.z);
    context.rotate(pose.heading);
    context.scale(scale, scale);
    const outline = (points, fill) => {
      context.beginPath();
      for (const [i, point] of points.entries()) {
        if (i === 0) context.moveTo(...point);
        else context.lineTo(...point);
      }
      context.closePath();
      context.fillStyle = fill;
      context.fill();
    };
    outline([[1.35, 0], [-1.65, 4.5], [-2.2, 4.78], [-2.08, 4.5], [-1.15, 0],
      [-2.08, -4.5], [-2.2, -4.78], [-1.65, -4.5]], '#abc0c7');
    outline([[-3.72, 0], [-4.55, 1.75], [-4.95, 1.9], [-4.62, 0], [-4.95, -1.9], [-4.55, -1.75]], accent);
    for (const [x, , z] of built.engines) outline([[x, z - .2], [x, z + .2], [x - 1, z + .18], [x - 1, z - .18]], '#8fa4ac');
    const side = bodyStations.map(([x, , , width]) => [x, width]);
    outline([...side, ...side.slice().reverse().map(([x, z]) => [x, -z])], '#fcffff');
    if (showWindows) outline([[4.25, -.3], [4.6, -.22], [4.6, .22], [4.25, .3]], '#234953');
    context.restore();
  }

  window.RelayAircraftModel = {meshes: built.meshes, engines: built.engines, lights, drawPlan, length: 10, span: 9.56, noseGear: 3.75};
})();
