/* Illustrative airport circuit in the same coordinates as the ground scene. */
(() => {
  'use strict';

  const runway = {x: 22, halfLength: 19, width: 9};
  const radius = 16;
  const speed = 5.4;
  const accents = [[.035, .47, .49], [.08, .57, .51]];
  const flightScale = .96;
  const defaultStand = index => ({x: 15.7, y: .042, z: -14 + index * 5.15, scale: .71});

  const smooth = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };

  function createCircuit(runway, surface = .042) {
    const straight = runway.halfLength * 2;
    const turn = Math.PI * radius;
    const lap = 2 * (straight + turn);
    const wrap = distance => ((distance % lap) + lap) % lap;

    function altitude(distance) {
      const fromRunwayCenter = Math.abs(wrap(distance + lap / 2 - straight / 2) - lap / 2);
      return 12 * smooth((fromRunwayCenter - 7) / 42);
    }

    function poseAt(seconds) {
      const distance = wrap(straight / 2 - 4 + seconds * speed);
      const headingOnRunway = Math.PI / 2;
      const farX = runway.x - radius * 2;
      let x, z, heading, bank = 0;
      if (distance < straight) {
        x = runway.x;
        z = distance - runway.halfLength;
        heading = headingOnRunway;
      } else if (distance < straight + turn) {
        const angle = (distance - straight) / radius;
        x = runway.x - radius * (1 - Math.cos(angle));
        z = runway.halfLength + radius * Math.sin(angle);
        heading = headingOnRunway + angle;
        bank = .19 * Math.sin(angle) ** 2;
      } else if (distance < straight * 2 + turn) {
        x = farX;
        z = runway.halfLength - (distance - straight - turn);
        heading = -headingOnRunway;
      } else {
        const angle = (distance - straight * 2 - turn) / radius;
        x = farX + radius * (1 - Math.cos(angle));
        z = -runway.halfLength - radius * Math.sin(angle);
        heading = -headingOnRunway + angle;
        bank = .19 * Math.sin(angle) ** 2;
      }
      const height = altitude(distance);
      const pitch = Math.atan2(altitude(distance + .04) - altitude(distance - .04), .08);
      return {x, y: surface + height, z, heading, pitch, bank, gear: 1 - smooth(height / 1.4)};
    }

    return {poseAt, lapDuration: lap / speed};
  }

  const defaultCircuit = createCircuit(runway);

  function drawFleet(seconds, standCount, draw, circuit = defaultCircuit, stand = defaultStand) {
    const stands = Math.min(6, Math.max(1, standCount ?? 3));
    for (let i = 0; i < stands; i++) {
      const {x, y, z, scale} = stand(i);
      draw({x, y, z, heading: Math.PI, pitch: 0, bank: 0, gear: 1}, scale, accents[i % accents.length]);
    }
    draw(circuit.poseAt(seconds), flightScale, accents[0]);
  }

  function transform(pose, scale, gearLift = 0) {
    // Rotation columns are forward, up and right. Forward follows the path tangent.
    const {heading, pitch, bank, x, y, z} = pose;
    const gearScale = 1 - gearLift * .8;
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cb = Math.cos(bank), sb = Math.sin(bank);
    const forward = [ch * cp, sp, sh * cp];
    const up = [-ch * sp * cb - sh * sb, cp * cb, -sh * sp * cb + ch * sb];
    const right = [ch * sp * sb - sh * cb, -cp * sb, sh * sp * sb + ch * cb];
    return new Float32Array([
      ...forward.map(value => value * scale), 0,
      ...up.map(value => value * scale * gearScale), 0,
      ...right.map(value => value * scale), 0,
      x + up[0] * gearLift * scale, y + up[1] * gearLift * scale, z + up[2] * gearLift * scale, 1,
    ]);
  }

  window.RelayFlight = {runway, ...defaultCircuit, createCircuit, drawFleet, transform};
})();
