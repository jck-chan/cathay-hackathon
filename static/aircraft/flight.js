/* Aircraft pose → model matrix. Poses come from the ground operations model. */
(() => {
  'use strict';

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

  window.RelayFlight = {transform};
})();
