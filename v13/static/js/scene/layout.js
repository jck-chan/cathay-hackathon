// Apron layout in metres. +x east, +z towards the camera (south), y up.
// Everything is derived from the stand count the server reports.
import * as THREE from 'three';

export const CARGO_SCALE = 2.3;       // visual exaggeration of cargo units (tidy, easy to grab)
export const RUNWAY_Z = -232;
export const TAXI_Z = -134;        // departures (eastbound)
export const TAXI_IN_Z = -172;     // arrivals (westbound)
export const STAND_Z = -50;           // aircraft reference point when parked (nose faces +z)
export const RUNWAY_HALF = 1100;
export const THRESHOLD_E = 760;       // departures line up here, heading west
export const TOUCHDOWN_X = 640;       // arrivals touch down here, heading west

export function makeLayout(stands, stagingCap) {
  const spacing = 70;
  const standX = Array.from({ length: stands }, (_, i) => (i - (stands - 1) / 2) * spacing);
  const cols = Math.ceil(stagingCap / 3);
  const pitch = 17;
  const rowPitch = 22;
  const staging = [];
  for (let k = 0; k < stagingCap; k++) {
    const r = Math.floor(k / cols), c = k % cols;
    staging.push(new THREE.Vector3((c - (cols - 1) / 2) * pitch, 0, 20 + r * rowPitch));
  }
  const exception = [];
  const exX = -((cols - 1) / 2) * pitch - 30;
  for (let k = 0; k < 24; k++) exception.push(new THREE.Vector3(exX - (k % 4) * 7.5, 0, 20 + Math.floor(k / 4) * 7.5));
  const beltStart = new THREE.Vector3(Math.max(230, standX[stands - 1] + 80), 1.25, 82);
  const beltEnd = new THREE.Vector3(((cols - 1) / 2) * pitch + 18, 1.25, 82);
  return {
    stands, spacing, standX, staging, stagingCols: cols, stagingPitch: pitch, exception,
    beltStart, beltEnd, beltLen: beltStart.distanceTo(beltEnd),
    dolly(stand, k) { // loading positions beside the forward starboard door (starboard = -x when nose faces +z)
      const col = Math.floor(k / 4), row = k % 4;
      return new THREE.Vector3(standX[stand] - 12 - col * 5.6, 0, STAND_Z + 31 - row * 5.4);
    },
    camera: { pos: new THREE.Vector3(0, 90, 196), target: new THREE.Vector3(0, 0, -18) },
  };
}

// ---- motion paths --------------------------------------------------------------------
const v = (x, z, y = 0) => new THREE.Vector3(x, y, z);

function path(...segs) {
  const p = new THREE.CurvePath();
  for (const s of segs) p.add(s);
  return p;
}
const line = (a, b) => new THREE.LineCurve3(a, b);
const cubic = (a, b, c, d) => new THREE.CubicBezierCurve3(a, b, c, d);
const quad = (a, b, c) => new THREE.QuadraticBezierCurve3(a, b, c);

export const exitFor = sx => Math.min(TOUCHDOWN_X - 240, sx + 200);

export function arrivalPaths(sx) {
  const exitX = exitFor(sx);
  return {
    approach: line(v(TOUCHDOWN_X + 1150, RUNWAY_Z, 1150 * Math.tan(3 * Math.PI / 180)), v(TOUCHDOWN_X, RUNWAY_Z, 0)),
    rollout: line(v(TOUCHDOWN_X, RUNWAY_Z), v(exitX, RUNWAY_Z)),
    taxi: path(
      cubic(v(exitX, RUNWAY_Z), v(exitX - 45, RUNWAY_Z), v(exitX - 45, TAXI_IN_Z), v(exitX - 90, TAXI_IN_Z)),
      line(v(exitX - 90, TAXI_IN_Z), v(sx + 40, TAXI_IN_Z)),
      quad(v(sx + 40, TAXI_IN_Z), v(sx, TAXI_IN_Z), v(sx, TAXI_IN_Z + 40)),
      line(v(sx, TAXI_IN_Z + 40), v(sx, STAND_Z)),
    ),
  };
}

export function departurePaths(sx) {
  return {
    pushback: path( // travelled tail-first: heading = -tangent
      line(v(sx, STAND_Z), v(sx, TAXI_Z + 34)),
      quad(v(sx, TAXI_Z + 34), v(sx, TAXI_Z), v(sx - 34, TAXI_Z)),
    ),
    taxi: path(
      line(v(sx - 34, TAXI_Z), v(sx - 14, TAXI_Z)),
      line(v(sx - 14, TAXI_Z), v(THRESHOLD_E - 10, TAXI_Z)),
      cubic(v(THRESHOLD_E - 10, TAXI_Z), v(THRESHOLD_E + 75, TAXI_Z), v(THRESHOLD_E + 75, RUNWAY_Z), v(THRESHOLD_E, RUNWAY_Z)),
    ),
    roll: line(v(THRESHOLD_E, RUNWAY_Z), v(-60, RUNWAY_Z)),
    climb: line(v(-60, RUNWAY_Z, 0), v(-2400, RUNWAY_Z, 330)),
    tow: path(line(v(sx - 34, TAXI_Z), v(-RUNWAY_HALF + 200, TAXI_Z))),
  };
}

// Lead-in centre lines painted on the apron follow the same curves the aircraft use.
export function taxiLineCurves(layout) {
  const out = [];
  for (const sx of layout.standX) {
    out.push(path(quad(v(sx + 40, TAXI_IN_Z), v(sx, TAXI_IN_Z), v(sx, TAXI_IN_Z + 40)), line(v(sx, TAXI_IN_Z + 40), v(sx, STAND_Z + 10))));
    const ex = exitFor(sx);
    out.push(cubic(v(ex, RUNWAY_Z), v(ex - 45, RUNWAY_Z), v(ex - 45, TAXI_IN_Z), v(ex - 90, TAXI_IN_Z)));
  }
  out.push(cubic(v(THRESHOLD_E - 10, TAXI_Z), v(THRESHOLD_E + 75, TAXI_Z), v(THRESHOLD_E + 75, RUNWAY_Z), v(THRESHOLD_E, RUNWAY_Z)));
  return out;
}
