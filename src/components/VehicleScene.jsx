import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useEvState } from '../state/store.js';

// The demonstration sheet is 120 x 160 cm. One Three.js unit represents
// 10 cm, so route movement is shown against the same physical proportions.
const CM_PER_UNIT = 10;
const SHEET_WIDTH_CM = 120;
const SHEET_LENGTH_CM = 160;
const SHEET_WIDTH = SHEET_WIDTH_CM / CM_PER_UNIT;
const SHEET_LENGTH = SHEET_LENGTH_CM / CM_PER_UNIT;
const X_LIMIT = SHEET_WIDTH / 2;
const Z_LIMIT = SHEET_LENGTH / 2;
const ROUTE_START = { x: 0, z: -SHEET_LENGTH / 2 };

// Fixed charging-pad positions on the demonstration sheet.
const STATION_SPOTS = {
  1: { x: -3.5, z: -5.4 },
  2: { x: 3.5, z: -5.4 },
  3: { x: 3.5, z: 5.4 },
  4: { x: -3.5, z: 5.4 },
};

const DRIVE_SPEED_CM_PER_SECOND = 32; // calibrate this to the physical vehicle if needed
const DRIVE_SPEED = DRIVE_SPEED_CM_PER_SECOND / CM_PER_UNIT;
const TURN_RATE = 1.5; // radians per second while turning
const MAX_TRAIL_POINTS = 12000;

const COLORS = {
  ok: 0x16a34a,
  warn: 0xea8c2e,
  danger: 0xdc2626,
  accent: 0x12897d,
  idle: 0x64748b,
};

function makeVehicle() {
  const car = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.55, 3.6),
    new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.55, roughness: 0.35 })
  );
  body.position.y = 0.62;
  body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.5, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.3, roughness: 0.25 })
  );
  cabin.position.set(0, 1.12, -0.15);
  cabin.castShadow = true;
  car.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 20);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
  const wheels = [];
  [
    [-0.95, 1.15],
    [0.95, 1.15],
    [-0.95, -1.15],
    [0.95, -1.15],
  ].forEach(([x, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.36, z);
    wheel.castShadow = true;
    car.add(wheel);
    wheels.push(wheel);
  });

  // Headlights point along +Z, which is the vehicle's forward axis.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
  [-0.6, 0.6].forEach((x) => {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), lampMat);
    lamp.position.set(x, 0.72, 1.82);
    car.add(lamp);
  });

  return { car, wheels, body };
}

function makeStation(label, isTarget) {
  const group = new THREE.Group();

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.1, 0.12, 40),
    new THREE.MeshStandardMaterial({
      color: isTarget ? COLORS.accent : 0x334155,
      metalness: 0.4,
      roughness: 0.6,
    })
  );
  pad.position.y = 0.06;
  pad.receiveShadow = true;
  group.add(pad);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.75, 0.07, 12, 48),
    new THREE.MeshBasicMaterial({ color: isTarget ? COLORS.accent : COLORS.idle, transparent: true, opacity: 0.8 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  group.add(ring);

  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 2.6, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.2, roughness: 0.7 })
  );
  post.position.set(0, 1.4, -2.4);
  post.castShadow = true;
  group.add(post);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.85, 0.3),
    new THREE.MeshStandardMaterial({ color: isTarget ? COLORS.accent : 0x475569 })
  );
  head.position.set(0, 2.75, -2.4);
  group.add(head);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.42),
    new THREE.MeshBasicMaterial({ color: isTarget ? 0x5eead4 : 0x1e293b })
  );
  screen.position.set(0, 2.78, -2.23);
  group.add(screen);

  group.userData = { ring, pad, head, screen, label };
  return group;
}

// Rings that rise off the pad while wireless charging is running.
function makeEnergyRings() {
  const group = new THREE.Group();
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.05, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.userData.phase = i / 4;
    group.add(ring);
    rings.push(ring);
  }
  group.userData.rings = rings;
  group.visible = false;
  return group;
}

function makeFloorMarker(color, radius = 0.38) {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.55, radius, 32),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.08;
  return marker;
}

function makeCarMarker() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 144;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#2563eb';
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(14, 6, 68, 132, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(23, 35, 50, 48, 10);
  ctx.fill();
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(27, 17, 42, 10);
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(20, 10, 13, 7);
  ctx.fillRect(63, 10, 13, 7);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 1.08),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
  );
  plane.rotation.x = -Math.PI / 2;
  const marker = new THREE.Group();
  marker.add(plane);
  marker.position.y = 0.16;
  return marker;
}

function calculateGuidancePath(drive, step, remaining) {
  if (!step || step.direction === 'S') return [];
  const points = [new THREE.Vector3(drive.x, 0.1, drive.z)];

  if (step.direction === 'F' || step.direction === 'B') {
    const sign = step.direction === 'B' ? -1 : 1;
    const distance = DRIVE_SPEED * Math.max(0, Number(remaining) || 0) * sign;
    const x = Math.max(-X_LIMIT, Math.min(X_LIMIT, drive.x + Math.sin(drive.heading) * distance));
    const z = Math.max(-Z_LIMIT, Math.min(Z_LIMIT, drive.z + Math.cos(drive.heading) * distance));
    points.push(new THREE.Vector3(x, 0.1, z));
    return points;
  }

  // A short curved guide beside the car communicates an in-place turn
  // without revealing any later route segment.
  const sign = step.direction === 'L' ? 1 : -1;
  const turn = Math.min(Math.PI * 1.5, TURN_RATE * Math.max(0, Number(remaining) || 0));
  for (let i = 1; i <= 14; i += 1) {
    const progress = i / 14;
    const radius = 0.75 * progress;
    const angle = drive.heading + sign * turn * progress;
    points.push(
      new THREE.Vector3(
        drive.x + Math.sin(angle) * radius,
        0.1,
        drive.z + Math.cos(angle) * radius
      )
    );
  }
  return points;
}

export default function VehicleScene({ mode = 'drive', height = 320 }) {
  const state = useEvState();
  const mountRef = useRef(null);
  const liveRef = useRef(state);
  const resetRef = useRef(null);
  const pointResetRef = useRef(null);
  const endReadoutRef = useRef(null);
  // Probed once, before the scene is built, so the fallback can render without
  // the effect having to push state back up.
  const [supported] = useState(() => {
    try {
      const probe = document.createElement('canvas');
      return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch {
      return false;
    }
  });

  // Keep the animation loop reading current state without rebuilding the scene.
  useEffect(() => {
    liveRef.current = state;
  }, [state]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !supported) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth || 640, mount.clientHeight || height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1220, 24, 55);

    const camera = new THREE.PerspectiveCamera(50, (mount.clientWidth || 640) / (mount.clientHeight || height), 0.1, 200);
    camera.position.set(0, 12, 16);

    // Free-look camera: drag to orbit a full 360°, scroll to zoom, right-drag
    // to pan. The orbit target follows whatever the scene is about, so the
    // subject stays centred while the operator looks around it.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 4;
    controls.maxDistance = 36;
    // Stop just above the horizon so the camera never ends up under the ground.
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.autoRotate = mode === 'charge';
    controls.autoRotateSpeed = 0.9;
    // The first drag hands the camera over to the operator for good.
    let userTookOver = false;
    const onControlStart = () => {
      userTookOver = true;
      controls.autoRotate = false;
    };
    controls.addEventListener('start', onControlStart);

    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x0b1220, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(SHEET_WIDTH, SHEET_LENGTH),
      new THREE.MeshStandardMaterial({ color: 0x131c2e, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Ten-centimetre grid, clipped to the rectangular sheet.
    const gridPoints = [];
    for (let x = -SHEET_WIDTH / 2; x <= SHEET_WIDTH / 2; x += 1) {
      gridPoints.push(x, 0.01, -SHEET_LENGTH / 2, x, 0.01, SHEET_LENGTH / 2);
    }
    for (let z = -SHEET_LENGTH / 2; z <= SHEET_LENGTH / 2; z += 1) {
      gridPoints.push(-SHEET_WIDTH / 2, 0.01, z, SHEET_WIDTH / 2, 0.01, z);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    const grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: 0x18263c })
    );
    scene.add(grid);

    const boundary = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(SHEET_WIDTH, 0.05, SHEET_LENGTH)),
      new THREE.LineBasicMaterial({ color: 0x2dd4bf })
    );
    boundary.position.y = 0.025;
    scene.add(boundary);

    const selectedId = liveRef.current.selectedStationId;
    const stations = {};
    Object.entries(STATION_SPOTS).forEach(([id, spot]) => {
      const station = makeStation(`S${id}`, Number(id) === selectedId);
      station.position.set(spot.x, 0, spot.z);
      station.visible = mode === 'charge';
      scene.add(station);
      stations[id] = station;
    });

    const { car, wheels } = makeVehicle();
    car.visible = mode === 'charge';
    scene.add(car);

    const carMarker = makeCarMarker();
    carMarker.visible = mode === 'drive';
    scene.add(carMarker);

    const startMarker = makeFloorMarker(0x22c55e);
    startMarker.position.set(ROUTE_START.x, 0.08, ROUTE_START.z);
    startMarker.visible = mode === 'drive';
    scene.add(startMarker);

    const endMarker = makeFloorMarker(0xef4444, 0.46);
    endMarker.visible = false;
    scene.add(endMarker);

    const guidanceGeometry = new THREE.BufferGeometry();
    const guidancePath = new THREE.Line(
      guidanceGeometry,
      new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 0.25, gapSize: 0.14, transparent: true, opacity: 0.9 })
    );
    guidancePath.visible = false;
    scene.add(guidancePath);

    // Draw the actual path produced by the timed direction commands.
    const trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3);
    const trailGeometry = new THREE.BufferGeometry();
    const trailAttribute = new THREE.BufferAttribute(trailPositions, 3);
    trailAttribute.setUsage(THREE.DynamicDrawUsage);
    trailGeometry.setAttribute('position', trailAttribute);
    trailGeometry.setDrawRange(0, 0);
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.9 })
    );
    trail.visible = mode === 'drive';
    scene.add(trail);

    const energy = makeEnergyRings();
    scene.add(energy);

    // Vehicle kinematics, driven by the live direction command.
    const drive = { x: ROUTE_START.x, z: ROUTE_START.z, heading: 0, speed: 0 };
    const camTarget = new THREE.Vector3();
    controls.target.set(0, 1, 0);
    controls.update();
    const home = { position: camera.position.clone(), target: controls.target.clone() };
    const clock = new THREE.Clock();
    let raf;
    let lastTargetId = selectedId;
    let trailCount = 0;
    let lastTrailX = drive.x;
    let lastTrailZ = drive.z;
    let routeWasActive = false;

    function updateGuidancePath(step, remaining) {
      const points = calculateGuidancePath(drive, step, remaining);
      guidanceGeometry.setFromPoints(points);
      guidancePath.computeLineDistances();
      guidancePath.visible = mode === 'drive' && points.length > 1;
    }

    function resetTrail() {
      trailCount = 1;
      trailPositions[0] = drive.x;
      trailPositions[1] = 0.12;
      trailPositions[2] = drive.z;
      lastTrailX = drive.x;
      lastTrailZ = drive.z;
      trailGeometry.setDrawRange(0, trailCount);
      trailAttribute.needsUpdate = true;
    }

    function extendTrail() {
      if (trailCount >= MAX_TRAIL_POINTS) return;
      const dx = drive.x - lastTrailX;
      const dz = drive.z - lastTrailZ;
      if (dx * dx + dz * dz < 0.0025) return;
      const offset = trailCount * 3;
      trailPositions[offset] = drive.x;
      trailPositions[offset + 1] = 0.12;
      trailPositions[offset + 2] = drive.z;
      trailCount += 1;
      lastTrailX = drive.x;
      lastTrailZ = drive.z;
      trailGeometry.setDrawRange(0, trailCount);
      trailAttribute.needsUpdate = true;
    }
    resetTrail();

    pointResetRef.current = () => {
      drive.x = ROUTE_START.x;
      drive.z = ROUTE_START.z;
      drive.heading = 0;
      drive.speed = 0;
      carMarker.position.set(drive.x, 0.16, drive.z);
      carMarker.rotation.y = drive.heading;
      startMarker.position.set(drive.x, 0.08, drive.z);
      endMarker.visible = false;
      resetTrail();
      if (endReadoutRef.current) endReadoutRef.current.textContent = 'Start: bottom centre (60 cm, 0 cm)';
    };

    function frame() {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      const live = liveRef.current;
      const charging = live.vehicleStatus === 'charging';
      const target = live.selectedStationId;
      const routeActive = !!live.playback;
      const routeJustStarted = routeActive && !routeWasActive;
      const routeJustEnded = !routeActive && routeWasActive;
      const activeRouteStep = live.playback?.steps?.[live.playback.stepIndex];

      if (routeJustStarted && mode === 'drive') {
        drive.x = ROUTE_START.x;
        drive.z = ROUTE_START.z;
        drive.heading = 0;
        drive.speed = 0;
        startMarker.position.set(ROUTE_START.x, 0.08, ROUTE_START.z);
        endMarker.visible = false;
        resetTrail();
        if (endReadoutRef.current) endReadoutRef.current.textContent = 'Running from (60 cm, 0 cm)';
      }
      routeWasActive = routeActive;

      // Re-highlight stations when the reserved one changes.
      if (target !== lastTargetId) {
        Object.entries(stations).forEach(([id, station]) => {
          const isTarget = Number(id) === target;
          station.userData.ring.material.color.setHex(isTarget ? COLORS.accent : COLORS.idle);
          station.userData.pad.material.color.setHex(isTarget ? COLORS.accent : 0x334155);
          station.userData.head.material.color.setHex(isTarget ? COLORS.accent : 0x475569);
          station.userData.screen.material.color.setHex(isTarget ? 0x5eead4 : 0x1e293b);
        });
        lastTargetId = target;
      }

      const spot = target ? STATION_SPOTS[target] : null;

      if (mode === 'charge' && charging && spot) {
        // Docked: ease onto the pad and hold still.
        drive.x += (spot.x - drive.x) * Math.min(1, dt * 2.5);
        drive.z += (spot.z - drive.z) * Math.min(1, dt * 2.5);
        drive.speed *= 0.85;
      } else if (mode === 'drive') {
        // Only the active mapped route moves the car marker. Left/right rotate its
        // internal heading; forward/backward move for the exact saved duration.
        const d = activeRouteStep?.direction || 'S';
        const wanted = d === 'F' ? DRIVE_SPEED : d === 'B' ? -DRIVE_SPEED : 0;
        drive.speed = wanted;
        if (d === 'L') drive.heading += TURN_RATE * dt;
        if (d === 'R') drive.heading -= TURN_RATE * dt;

        drive.x += Math.sin(drive.heading) * drive.speed * dt;
        drive.z += Math.cos(drive.heading) * drive.speed * dt;
        drive.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, drive.x));
        drive.z = Math.max(-Z_LIMIT, Math.min(Z_LIMIT, drive.z));
      }

      updateGuidancePath(activeRouteStep, live.playback?.remaining);
      if (mode === 'drive' && routeActive) extendTrail();

      if (mode === 'drive' && routeJustEnded) {
        endMarker.position.set(drive.x, 0.08, drive.z);
        endMarker.visible = true;
        const sheetX = (drive.x + SHEET_WIDTH / 2) * CM_PER_UNIT;
        const sheetY = (drive.z + SHEET_LENGTH / 2) * CM_PER_UNIT;
        if (endReadoutRef.current) {
          endReadoutRef.current.textContent = `End: (${sheetX.toFixed(1)} cm, ${sheetY.toFixed(1)} cm)`;
        }
      }

      carMarker.position.set(drive.x, 0.16, drive.z);
      carMarker.rotation.y = drive.heading;
      if (mode === 'charge') {
        car.position.set(drive.x, 0, drive.z);
        car.rotation.y = drive.heading;
        wheels.forEach((w) => {
          w.rotation.x -= drive.speed * dt * 2.6;
        });
      }

      // Wireless charging: rings climb from the pad to the car.
      energy.visible = mode === 'charge' && charging && !!spot;
      if (energy.visible) {
        energy.position.set(spot.x, 0.2, spot.z);
        const active = live.charging.active;
        energy.userData.rings.forEach((ring) => {
          ring.userData.phase = (ring.userData.phase + dt * (active ? 0.55 : 0.18)) % 1;
          const p = ring.userData.phase;
          ring.position.y = p * 2.1;
          const s = 0.55 + p * 0.75;
          ring.scale.set(s, s, s);
          ring.material.opacity = (1 - p) * (active ? 0.85 : 0.35);
        });
      }

      // Station rings pulse; the reserved one pulses brighter.
      Object.entries(stations).forEach(([id, station]) => {
        const isTarget = Number(id) === target;
        const pulse = 0.55 + 0.45 * Math.sin(clock.elapsedTime * (isTarget ? 3 : 1.2) + Number(id));
        station.userData.ring.material.opacity = isTarget ? 0.45 + 0.5 * pulse : 0.22;
      });

      // The orbit target tracks the subject — the docked pad while charging,
      // otherwise the vehicle — so looking around never loses it off-screen.
      if (mode === 'charge' && charging && spot) camTarget.set(spot.x, 1, spot.z);
      else camTarget.set(drive.x, 1, drive.z);

      // Move the camera with the target so the operator's chosen angle and
      // distance are preserved as the vehicle drives.
      const shift = camTarget.clone().sub(controls.target);
      controls.target.copy(camTarget);
      camera.position.add(shift);
      controls.update();

      renderer.render(scene, camera);
    }
    frame();

    const observer = new ResizeObserver(() => {
      const w = mount.clientWidth || 640;
      const h = mount.clientHeight || height;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    observer.observe(mount);

    // Puts the camera back where it started, relative to the current subject.
    resetRef.current = () => {
      controls.target.copy(camTarget);
      camera.position.copy(home.position).add(camTarget.clone().sub(home.target));
      controls.autoRotate = mode === 'charge' && !userTookOver;
      controls.update();
    };

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      resetRef.current = null;
      pointResetRef.current = null;
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // The scene is built once and animated from liveRef, so it must not rebuild
    // on every telemetry update.
  }, [mode, height, supported]);

  if (!supported) {
    return (
      <div className="scene3d-fallback" style={{ height }}>
        3D view unavailable — this browser or device has no WebGL support.
      </div>
    );
  }

  return (
    <div className="scene3d-wrap" style={{ height }}>
      <div className="scene3d" ref={mountRef} aria-label="3D vehicle and charging station animation" />
      <div className="scene3d-scale">120 × 160 cm sheet · grid 10 cm</div>
      {mode === 'drive' && (
        <div className="scene3d-point-status" ref={endReadoutRef}>
          Start: bottom centre (60 cm, 0 cm)
        </div>
      )}
      {mode === 'drive' && (
        <div className="scene3d-path-legend">
          <span><i className="guidance" /> Current guidance</span>
          <span><i className="actual" /> Actual</span>
        </div>
      )}
      {mode === 'drive' && state.playback && (
        <div className="scene3d-route-live">
          <strong>{state.playback.kind === 'test' ? 'Test route' : state.playback.label}</strong>
          <span>
            Step {state.playback.stepIndex + 1}/{state.playback.steps.length} ·{' '}
            {state.playback.steps[state.playback.stepIndex]?.direction} · {state.playback.remaining}s
          </span>
        </div>
      )}
      <div className="scene3d-hint">Drag to look around · scroll to zoom · right-drag to pan</div>
      <button type="button" className="scene3d-reset" onClick={() => resetRef.current?.()}>
        Reset view
      </button>
      {mode === 'drive' && (
        <button
          type="button"
          className="scene3d-reset scene3d-point-reset"
          disabled={!!state.playback}
          onClick={() => pointResetRef.current?.()}
        >
          Reset point
        </button>
      )}
    </div>
  );
}
