/* Freighter mesh in local coordinates. +X points through the nose, +Y is up.
   Positions and normals are interleaved for one static GPU buffer per material. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const segments = 16;
  const bodyStations = [
    [-3.85, 1.41, .04, .05], [-3.35, 1.33, .23, .25],
    [-2.5, 1.25, .49, .47], [-1.55, 1.23, .59, .55],
    [2.1, 1.23, .59, .55], [2.7, 1.23, .57, .52],
    [3.15, 1.19, .48, .46], [3.48, 1.15, .34, .34],
    [3.72, 1.13, .16, .18], [3.81, 1.13, 0, 0],
  ];

  function meshBuilder() {
    const groups = {body: [], metal: [], teal: [], cockpit: [], dark: [], gear: []};

    function triangle(material, a, b, c) {
      const u = b.map((value, i) => value - a[i]);
      const v = c.map((value, i) => value - a[i]);
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const length = Math.hypot(...normal);
      if (length < 1e-9) return;
      const unit = normal.map(value => value / length);
      for (const point of [a, b, c]) groups[material].push(...point, ...unit);
    }

    function quad(material, a, b, c, d) {
      triangle(material, a, b, c);
      triangle(material, a, c, d);
    }

    function loft(stations, materialAt, axis = point => point) {
      function point([x, y, ry, rz, z = 0], index) {
        const angle = TAU * index / segments;
        return axis([x, y + ry * Math.cos(angle), z + rz * Math.sin(angle)]);
      }

      for (let i = 0; i < stations.length - 1; i++) {
        for (let j = 0; j < segments; j++) {
          quad(materialAt(i, j), point(stations[i], j), point(stations[i], j + 1),
            point(stations[i + 1], j + 1), point(stations[i + 1], j));
        }
      }
    }

    // Each section defines a leading edge, trailing edge, centre height and thickness.
    function wing(sections) {
      for (const side of [-1, 1]) {
        const points = sections.map(([span, front, back, y, thickness]) => {
          const z = span * side;
          const section = [[front, y, z], [front * .68 + back * .32, y + thickness, z],
            [back, y, z], [front * .68 + back * .32, y - thickness * .55, z]];
          return side < 0 ? section.reverse() : section;
        });
        for (let i = 0; i < points.length - 1; i++) {
          const material = i === points.length - 2 ? 'teal' : 'metal';
          for (let j = 0; j < 4; j++) {
            const next = (j + 1) % 4;
            quad(material, points[i][j], points[i][next], points[i + 1][next], points[i + 1][j]);
          }
        }
      }
    }

    const gear = () => 'gear';
    loft(bodyStations, (station, panel) => {
      if (station >= 5 && station <= 6 && [1, 2, 13, 14].includes(panel)) return 'cockpit';
      return panel >= 5 && panel <= 10 ? 'metal' : 'body';
    });

    wing([
      [.34, 1.24, -1.7, .98, .13], [1.42, .51, -1.49, 1.03, .10],
      [3.0, -.78, -1.93, 1.19, .054], [3.34, -1.07, -1.97, 1.38, 0],
    ]);
    wing([
      [.05, -2.34, -3.6, 1.3, .085], [1.33, -3.08, -3.85, 1.43, .045],
      [1.51, -3.29, -3.93, 1.49, 0],
    ]);

    // Swept vertical stabilizer with a contrasting stripe across both faces.
    const fin = [[-1.98, -3.72, 1.42, .19], [-3.04, -3.94, 2.59, .10],
      [-3.22, -3.98, 2.85, .065], [-3.29, -3.99, 3.0, 0]];
    const finPoints = fin.map(([front, back, y, width]) =>
      [[front, y, 0], [front - .24, y, width], [back, y, 0], [front - .24, y, -width]]);
    for (let i = 0; i < finPoints.length - 1; i++) {
      for (let j = 0; j < 4; j++) {
        const next = (j + 1) % 4;
        quad(i === 1 ? 'body' : 'teal', finPoints[i][next], finPoints[i][j],
          finPoints[i + 1][j], finPoints[i + 1][next]);
      }
    }

    for (const z of [-1.38, 1.38]) {
      // The last rings fold back into the nacelle to form a recessed intake.
      loft([
        [-.94, .68, .19, .19, z], [-.68, .68, .29, .29, z],
        [.49, .68, .33, .33, z], [.62, .68, .27, .27, z],
        [.56, .68, .2, .2, z], [.38, .68, .19, .19, z], [.38, .68, 0, 0, z],
      ], index => ['metal', 'teal', 'metal', 'metal', 'dark', 'dark'][index]);
    }

    for (const [x, z] of [[-1.1, -.36], [-1.1, .36], [2.48, 0]]) {
      loft([[.16, 0, 0, 0], [.16, 0, .15, .15], [-.16, 0, .15, .15],
        [-.16, 0, 0, 0]], gear, ([axle, y, depth]) => [x + depth, y + .16, z + axle]);
      loft([[.16, 0, .05, .05], [.92, 0, .055, .055]], gear,
        ([height, y, depth]) => [x - y, height, z + depth]);
    }

    return Object.fromEntries(Object.entries(groups).map(([name, data]) => [name, new Float32Array(data)]));
  }

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
    outline([[1.25, 0], [-1.07, 3.34], [-1.97, 3.34], [-1.63, 0],
      [-1.97, -3.34], [-1.07, -3.34]], '#abc0c7');
    outline([[-2.34, 0], [-3.29, 1.51], [-3.93, 1.51],
      [-3.6, 0], [-3.93, -1.51], [-3.29, -1.51]], accent);
    const side = bodyStations.map(([x, , , radius]) => [x, radius]);
    outline([...side, ...side.slice().reverse().map(([x, z]) => [x, -z])], '#fcffff');
    if (showWindows) outline([[2.7, -.39], [3.29, -.28], [3.29, .28], [2.7, .39]], '#234953');
    context.restore();
  }

  window.RelayAircraftModel = {meshes: meshBuilder(), drawPlan};
})();
