import * as THREE from 'three';
import { buildAirport } from './airport.js';
import { DeckAudio } from './audio.js';
import { AISLE, buildCabin, SEAT } from './cabin.js';
import { FEET, FLAPS, Flight, RAD, STEP } from './flight.js';
import { attachWings } from './wings.js';

const $ = id => document.getElementById(id);
const view = $('view');
const help = $('controls');
const failure = $('failure');
const notice = $('notice');
const announce = {
  staleAt: 0,
  show(message) {
    if (!message) return;
    notice.textContent = message;
    notice.hidden = false;
    this.staleAt = performance.now() + 3700;
  },
};

function showFailure(title, description, actionLabel, action) {
  $('failure-title').textContent = title;
  $('failure-description').textContent = description;
  $('failure-action').textContent = actionLabel;
  $('failure-action').onclick = action;
  failure.hidden = false;
}

function start() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true,
    });
  } catch (error) {
    console.error(error);
    $('phase').textContent = 'View unavailable';
    $('flight-tip').hidden = true;
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    $('failure-action').disabled = false;
    showFailure('WebGL is unavailable', 'Enable hardware acceleration or try another browser.', 'Reload', () => location.reload());
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  view.append(renderer.domElement);
  const scene = new THREE.Scene();
  const aircraft = new THREE.Group();
  scene.add(aircraft);
  attachWings(aircraft).catch(error => console.error('Could not load the player wings', error));
  const airport = buildAirport(scene);
  const { cabin, animate, interior, paint } = buildCabin(aircraft);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.075, 32000);
  camera.rotation.order = 'YXZ';
  cabin.add(camera);
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = view;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.fov = Math.min(88, Math.max(65, 2 * Math.atan(0.66 / camera.aspect) / RAD));
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  const basis = new THREE.Matrix4();
  const backward = new THREE.Vector3();
  const destination = SEAT.clone();
  const eye = SEAT.clone();
  const yoke = $('mouse-yoke');
  const yokeDot = yoke.querySelector('i');
  const capture = $('mouse-capture');
  const doorButton = $('door-toggle');
  const audio = new DeckAudio();
  const keys = new Set();
  const input = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
  const flightKeys = new Set([
    'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyQ', 'Equal', 'Minus',
    'NumpadAdd', 'NumpadSubtract', 'KeyB', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'KeyR', 'KeyF', 'KeyX', 'KeyG', 'KeyL', 'KeyN', 'KeyV', 'KeyC', 'KeyP', 'KeyH', 'Escape',
  ]);
  let flight = new Flight();
  let paused = false;
  let standing = false;
  let drag = null;
  let steeringPointer = null;
  let pointer = null;
  let mouseFlying = false;
  let mouseX = 0, mouseY = 0;
  let mouseRoll = 0, mousePitch = 0;
  let yaw = 0, pitch = -0.19;
  let previous = performance.now(), accumulator = 0, nextPaint = 0;
  let simTime = 0;

  function setView(stand) {
    centerMouse();
    standing = stand;
    keys.clear();
    if (document.pointerLockElement === view) document.exitPointerLock();
    destination.copy(stand ? AISLE : SEAT);
    eye.copy(destination);
    camera.position.copy(eye);
    yaw = stand ? Math.PI : 0;
    pitch = stand ? -0.04 : -0.19;
    $('seat-toggle').firstChild.nodeValue = stand ? 'Sit in pilot seat ' : 'Leave seat ';
    updateMouseHint();
    updateInterior(0);
  }

  function pause(value) {
    paused = value;
    $('pause').firstChild.nodeValue = value ? 'Resume ' : 'Pause ';
    if (paused) {
      accumulator = 0;
      centerMouse();
    }
  }

  function reset() {
    if (document.pointerLockElement === view) document.exitPointerLock();
    flight = new Flight();
    simTime = 0;
    for (const door of interior.doors) {
      door.open = false;
      door.angle = 0;
    }
    failure.hidden = true;
    notice.hidden = true;
    setView(false);
    keys.clear();
    $('pause').disabled = false;
    pause(false);
    nextPaint = 0;
  }

  function toggleHelp(force) {
    const open = force ?? help.hidden;
    if (open) {
      centerMouse();
      if (document.pointerLockElement === view) document.exitPointerLock();
    }
    help.hidden = !open;
    $('help').setAttribute('aria-expanded', String(open));
    (open ? $('close-help') : $('help')).focus();
  }

  function flaps(direction) {
    const next = Math.min(FLAPS.length - 1, Math.max(0, flight.flap + direction));
    if (direction > 0 && next !== flight.flap && flight.ias > FLAPS[next].limit) {
      announce.show(`Slow below ${FLAPS[next].limit} kt for flaps ${FLAPS[next].label}`);
      return;
    }
    if (next !== flight.flap) audio.click();
    flight.flap = next;
  }

  function canConfigure() {
    return !standing && !flight.crash && !flight.waterborne && !flight.bellyLanding;
  }

  const actions = {
    KeyR: () => announce.show(flight.toggleReverse()),
    KeyF: event => flaps(event.shiftKey ? -1 : 1),
    KeyX: () => { flight.spoilers = !flight.spoilers; },
    KeyG: () => announce.show(flight.toggleGear()),
    KeyL: () => { flight.landingLights = !flight.landingLights; },
    KeyN: () => {
      flight.panelLights = !flight.panelLights;
      announce.show(`Panel light ${flight.panelLights ? 'on' : 'off'}`);
    },
  };
  const switches = {
    'gear-toggle': 'KeyG',
    'spoiler-toggle': 'KeyX',
    'landing-toggle': 'KeyL',
    'panel-toggle': 'KeyN',
    'reverse-toggle': 'KeyR',
  };
  for (const [id, code] of Object.entries(switches)) {
    $(id).onclick = () => {
      if (!canConfigure()) return;
      audio.click();
      actions[code]();
    };
  }
  $('flaps-less').onclick = () => { if (canConfigure()) flaps(-1); };
  $('flaps-more').onclick = () => { if (canConfigure()) flaps(1); };

  function centerMouse() {
    if (!mouseFlying) return;
    if (steeringPointer !== null && view.hasPointerCapture(steeringPointer)) {
      view.releasePointerCapture(steeringPointer);
    }
    steeringPointer = null;
    mouseFlying = false;
    mouseX = mouseY = 0;
    mouseRoll = mousePitch = 0;
    yoke.hidden = true;
    view.classList.remove('flying');
  }

  function deflection(pixels, range) {
    return Math.sign(pixels) * THREE.MathUtils.clamp((Math.abs(pixels) - 4) / range, 0, 1);
  }

  function moveYoke(dx = 0, dy = 0) {
    mouseFlying = true;
    mouseX = THREE.MathUtils.clamp(mouseX + dx, -159, 159);
    mouseY = THREE.MathUtils.clamp(mouseY + dy, -119, 119);
    mouseRoll = deflection(mouseX, 155);
    mousePitch = deflection(mouseY, 115);
    yokeDot.style.transform = `translate(${mouseRoll * 39}px, ${mousePitch * 39}px)`;
    yoke.hidden = false;
    view.classList.add('flying');
  }

  function canUseYoke() {
    return !paused && canConfigure() && help.hidden;
  }

  capture.disabled = typeof view.requestPointerLock !== 'function';
  function captureUnavailable() {
    announce.show('Browser declined mouse capture. Hold Shift and drag to keep steering at the edges.');
  }
  capture.onclick = async () => {
    if (document.pointerLockElement === view) {
      document.exitPointerLock();
      return;
    }
    try {
      await view.requestPointerLock();
    } catch {
      captureUnavailable();
    }
  };
  function updateMouseHint() {
    const locked = document.pointerLockElement === view;
    $('mouse-hint').textContent = standing ? (locked ? 'WASD to walk · Esc to release' : 'WASD to walk · Drag to look')
      : locked ? 'Move to look · Shift to fly · Esc to release' : 'Drag to look · Shift + mouse to fly';
  }
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === view;
    pointer = null;
    centerMouse();
    capture.setAttribute('aria-pressed', String(locked));
    capture.textContent = locked ? 'Mouse captured' : 'Capture mouse';
    updateMouseHint();
  });
  document.addEventListener('pointerlockerror', captureUnavailable);

  window.addEventListener('keydown', event => {
    if (event.key === 'Shift' && canUseYoke() && !event.repeat) {
      if (drag && view.hasPointerCapture(drag.id)) view.releasePointerCapture(drag.id);
      drag = null;
      moveYoke();
    }
    if (!flightKeys.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape' && help.hidden) return;
    event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyH') toggleHelp();
    else if (event.code === 'Escape') toggleHelp(false);
    else if (event.code === 'KeyV') setView(!standing);
    else if (event.code === 'KeyC') setView(false);
    else if (event.code === 'KeyP' && !flight.crash) pause(!paused);
    else if (canConfigure()) {
      if (actions[event.code] && event.code !== 'KeyF') audio.click();
      actions[event.code]?.(event);
    }
  });
  window.addEventListener('keyup', event => {
    keys.delete(event.code);
    if (!event.shiftKey) centerMouse();
  });
  window.addEventListener('blur', () => {
    keys.clear();
    drag = null;
    pointer = null;
    centerMouse();
  });
  document.addEventListener('visibilitychange', () => {
    keys.clear();
    pointer = null;
    centerMouse();
    previous = performance.now();
    accumulator = 0;
    audio.update(flight, paused);
  });
  $('help').onclick = () => toggleHelp();
  $('close-help').onclick = () => toggleHelp(false);
  $('pause').onclick = () => { if (!flight.crash) pause(!paused); };
  $('reset').onclick = reset;
  $('seat-toggle').onclick = () => setView(!standing);
  doorButton.onclick = () => {
    const door = nearbyDoor();
    if (!door) return;
    const beyondHinge = destination.z - door.z;
    if (door.open && beyondHinge > -0.23 && beyondHinge < door.width + 0.15
        && Math.abs(destination.x) < door.width / 2 + 0.12) {
      announce.show('Step clear of the doorway to close it.');
      return;
    }
    door.open = !door.open;
    audio.click();
    updateInterior(0);
  };
  $('sound').disabled = !audio.supported;
  $('sound').onclick = () => {
    audio.setEnabled(audio.context?.state !== 'running' || !audio.enabled);
    updateAudioLabel();
  };
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, event => {
      if (event.target instanceof Node && $('sound').contains(event.target)) return;
      if (audio.context?.state !== 'running') void audio.unlock();
    }, { capture: true });
  }

  view.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || document.pointerLockElement === view) return;
    if (event.shiftKey && event.pointerType === 'mouse' && canUseYoke()) {
      steeringPointer = event.pointerId;
      pointer = { x: event.clientX, y: event.clientY };
      if (!mouseFlying) moveYoke();
      view.setPointerCapture(event.pointerId);
      return;
    }
    view.focus({ preventScroll: true });
    view.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  window.addEventListener('pointermove', event => {
    const locked = document.pointerLockElement === view;
    const activeDrag = drag?.id === event.pointerId;
    const previousPointer = pointer;
    if (event.pointerType === 'mouse') pointer = { x: event.clientX, y: event.clientY };
    if (event.shiftKey && event.pointerType === 'mouse' && canUseYoke()) {
      if (!mouseFlying) moveYoke();
      else if (locked) moveYoke(event.movementX, event.movementY);
      else if (previousPointer) moveYoke(pointer.x - previousPointer.x, pointer.y - previousPointer.y);
    } else if (locked || activeDrag) {
      const dx = locked ? event.movementX : event.clientX - drag.x;
      const dy = locked ? event.movementY : event.clientY - drag.y;
      yaw -= dx * 0.004;
      pitch = THREE.MathUtils.clamp(pitch - dy * 0.004, -1.39, 1.39);
      if (activeDrag) {
        drag.x = event.clientX;
        drag.y = event.clientY;
      }
    }
  });
  view.addEventListener('lostpointercapture', event => {
    if (drag?.id === event.pointerId) drag = null;
    if (steeringPointer === event.pointerId) steeringPointer = null;
  });
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; });

  function axis(positive, negative, mouse = 0) {
    return THREE.MathUtils.clamp(Number(keys.has(positive)) - Number(keys.has(negative)) + mouse, -1, 1);
  }

  function sampleInput() {
    input.pitch = standing ? 0 : axis('ArrowDown', 'ArrowUp', mousePitch);
    input.roll = standing ? 0 : axis('ArrowRight', 'ArrowLeft', mouseRoll);
    input.yaw = standing ? 0 : axis('KeyE', 'KeyQ', flight.onGround ? mouseRoll : 0);
    input.throttle = standing ? 0 : Number(keys.has('Equal') || keys.has('NumpadAdd'))
      - Number(keys.has('Minus') || keys.has('NumpadSubtract'));
    input.brake = !standing && keys.has('KeyB');
  }

  function nearbyDoor() {
    if (!standing || Math.abs(destination.x) > 1.0) return null;
    return interior.doors.find(door => Math.abs(destination.z - door.z) < 1.50) ?? null;
  }

  function updateInterior(dt) {
    for (const door of interior.doors) {
      const target = door.open ? Math.PI / 2 : 0;
      door.angle += THREE.MathUtils.clamp(target - door.angle, -dt * 3.1, dt * 3.1);
      door.hinge.rotation.y = -door.angle;
    }
    const [flightDeck, passenger] = interior.doors;
    interior.rooms.visible = destination.z > flightDeck.z || flightDeck.angle > 0.03;
    const room = !standing ? 'Pilot seat' : destination.z < flightDeck.z ? 'Flight deck'
      : destination.z < passenger.z ? 'Galley' : 'Cabin aisle';
    if ($('view-status').textContent !== room) $('view-status').textContent = room;
    const door = nearbyDoor();
    doorButton.hidden = !door;
    if (door) {
      const label = `${door.open ? 'Close' : 'Open'} ${door.name.toLowerCase()}`;
      if (doorButton.textContent !== label) doorButton.textContent = label;
    }
  }

  function canWalk(x, z) {
    const distance = Math.abs(x);
    if (z < -0.65 || z > interior.end - 0.23) return false;
    for (const door of interior.doors) {
      if (Math.abs(z - door.z) < 0.22 && (door.angle < 1.38 || distance > door.width / 2 - 0.16)) return false;
      if (door.angle > 1.38 && Math.abs(x + door.width / 2) < 0.15
          && z > door.z - 0.15 && z < door.z + door.width + 0.13) return false;
    }
    if (z > interior.doors[1].z) {
      if (distance > 1.97) return false;
      if (distance < 0.42 || distance > 1.84) return true;
      return !interior.seatRows.some(row => z > row - 0.56 && z < row + 0.42);
    }
    if (z > interior.doors[0].z) return distance < 0.49;
    if (distance > 1.39) return false;
    if (distance < 0.33 && z < 0.94) return false; // center pedestal
    if (distance > 0.39 && distance < 1.05 && z > 0.42 && z < 1.34) return false; // seats
    return true;
  }

  function walk(dt) {
    const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    if (!forward && !side) return;
    const pace = 1.35 * dt / Math.hypot(forward, side);
    const x = destination.x + pace * (-Math.sin(yaw) * forward + Math.cos(yaw) * side);
    const z = destination.z + pace * (-Math.cos(yaw) * forward - Math.sin(yaw) * side);
    if (canWalk(x, destination.z)) destination.x = x;
    if (canWalk(destination.x, z)) destination.z = z;
  }

  const readouts = Object.fromEntries([
    'phase', 'flight-tip', 'ias', 'altitude', 'heading', 'vertical', 'power',
    'throttle', 'flaps', 'gear', 'spoiler', 'lights',
  ].map(id => [id, $(id)]));

  function updateAudioLabel() {
    const running = audio.enabled && audio.context?.state === 'running';
    const state = !audio.supported ? 'N/A' : !audio.enabled ? 'OFF' : running ? 'ON' : 'START';
    if ($('sound-state').textContent !== state) {
      $('sound-state').textContent = state;
      $('sound').setAttribute('aria-pressed', String(running));
    }
  }

  function flightStatus() {
    if (flight.crash) return ['Flight ended', 'Restart to return to the runway.', 'danger'];
    if (paused) return ['Paused', 'Press P to resume.'];
    if (flight.waterborne) return flight.groundSpeed > 1
      ? ['Ditching', 'The aircraft is slowing on the water.', 'warning']
      : ['Aircraft afloat', 'Restart when ready.', 'warning'];
    if (flight.bellyLanding) return ['Belly landing', 'The aircraft will slide to a stop. Restart when ready.', 'warning'];
    if (flight.surface === 'grass') return ['Off pavement', 'Reduce thrust, brake gently, and steer back to pavement.', 'warning'];
    if (flight.stalled) return ['Stall', 'Lower the nose and add thrust.', 'danger'];
    if (flight.overspeed) return ['Overspeed', 'Reduce thrust and check flap and gear limits.', 'warning'];
    if (flight.onGround) {
      if (flight.reverse || flight.braking) return ['Braking', 'Reduce reverse thrust as the aircraft slows.'];
      if (flight.ias > 50) {
        const guidance = flight.ias >= 145 && flight.throttle > 0.75
          ? 'Hold Shift and move the mouse down to rotate.' : 'Rotate at 145 kt.';
        return ['Runway roll', guidance];
      }
      if (flight.ias > 3) return ['Taxiing', 'Use Q / E to steer. Hold B to brake.'];
      return ['On runway', 'Hold + for takeoff thrust. At 145 kt, hold Shift and move the mouse down.'];
    }
    if (flight.velocity.y > 1) return ['Climbing', flight.gearDown ? 'Positive climb. Retract the gear.' : 'Check climb attitude and airspeed.'];
    return [flight.velocity.y < -1 ? 'Descending' : 'Airborne', 'Use the attitude display to monitor pitch and bank.'];
  }

  function updateReadouts() {
    const [phase, tip, tint = 'normal'] = flightStatus();
    if ($('phase-label').dataset.tint !== tint) $('phase-label').dataset.tint = tint;
    const reverse = flight.reverse || flight.reversePower > 0.02;
    const power = Math.round((reverse ? flight.reversePower : flight.power) * 100);
    const vSpeed = Math.round(flight.velocity.y * FEET * 60 / 10) * 10;
    const values = {
      phase,
      'flight-tip': standing && tint === 'normal' ? 'Sit in the pilot seat to fly.' : tip,
      ias: String(Math.round(flight.ias)).padStart(3, '0'),
      altitude: Math.round(flight.altitude).toLocaleString('en-US'),
      heading: `${String(flight.course || 360).padStart(3, '0')}°`,
      vertical: `${vSpeed > 0 ? '+' : ''}${vSpeed}`,
      power: `${power}%`,
      throttle: reverse ? 'REV' : `CMD ${Math.round(flight.throttle * 100)}%`,
      flaps: FLAPS[flight.flap].label,
      gear: flight.gearDown ? (flight.gear > 0.99 ? 'DOWN' : '▼') : (flight.gear < 0.01 ? 'UP' : '▲'),
      spoiler: flight.spoilers ? 'OUT' : 'IN',
      lights: flight.landingLights ? 'ON' : 'OFF',
    };
    for (const [id, value] of Object.entries(values)) {
      if (readouts[id].textContent !== value) readouts[id].textContent = value;
    }
    $('thrust-meter').value = power;
    for (const [id, pressed] of [
      ['spoiler-toggle', flight.spoilers], ['landing-toggle', flight.landingLights],
      ['panel-toggle', flight.panelLights], ['reverse-toggle', flight.reverse],
    ]) {
      const value = String(pressed);
      if ($(id).getAttribute('aria-pressed') !== value) $(id).setAttribute('aria-pressed', value);
    }
    const disabled = !canConfigure();
    $('flaps-less').disabled = disabled || flight.flap === 0;
    $('flaps-more').disabled = disabled || flight.flap === FLAPS.length - 1;
    for (const id of Object.keys(switches)) $(id).disabled = disabled;
  }

  function frame(now) {
    const dt = Math.max(0, Math.min(0.20, (now - previous) / 1000));
    previous = now;
    sampleInput();
    if (!paused && !flight.crash && !document.hidden) {
      accumulator += dt;
      while (accumulator >= STEP) {
        flight.step(STEP, input);
        accumulator -= STEP;
        simTime += STEP;
      }
      if (flight.incursion) {
        announce.show(flight.incursion);
        flight.incursion = '';
      }
      if (flight.waterborne || flight.bellyLanding) centerMouse();
      if (flight.crash) {
        pause(true);
        if (document.pointerLockElement === view) document.exitPointerLock();
        $('pause').disabled = true;
        showFailure('Flight ended', flight.crash, 'Restart flight', reset);
      }
    }
    if (standing) walk(dt);
    updateInterior(dt);
    eye.lerp(destination, 1 - Math.exp(-dt * 16));
    camera.position.copy(eye);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    aircraft.position.copy(flight.position);
    basis.makeBasis(flight.right, flight.up, backward.copy(flight.forward).negate());
    aircraft.quaternion.setFromRotationMatrix(basis);
    airport.update(flight, simTime);
    animate(flight, input);
    audio.update(flight, paused);
    if (now >= nextPaint) {
      paint(flight);
      updateAudioLabel();
      updateReadouts();
      nextPaint = now + 80;
    }
    if (!notice.hidden && now >= announce.staleAt) notice.hidden = true;
    renderer.render(scene, camera);
  }

  reset();
  renderer.setAnimationLoop(frame);
}

start();
