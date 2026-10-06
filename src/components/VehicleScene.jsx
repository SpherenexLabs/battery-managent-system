import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useEvState } from '../state/store.js';

// Where each station sits in the 3D yard. The real stations are placed by GPS;
// this is a fixed prototype layout so the vehicle has somewhere to drive to.
const STATION_SPOTS = {
  1: { x: -9, z: -9 },
  2: { x: 9, z: -9 },
  3: { x: 9, z: 9 },
  4: { x: -9, z: 9 },
};

const YARD_HALF = 13; // vehicle is kept inside this square
const DRIVE_SPEED = 3.2; // units per second at full throttle
const TURN_RATE = 1.5; // radians per second while turning
const ACCEL = 4; // how quickly the vehicle reaches full speed

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

export default function VehicleScene({ mode = 'drive', height = 320 }) {
  const state = useEvState();
  const mountRef = useRef(null);
  const liveRef = useRef(state);
  const resetRef = useRef(null);
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
    scene.fog = new THREE.Fog(0x0b1220, 26, 62);

    const camera = new THREE.PerspectiveCamera(50, (mount.clientWidth || 640) / (mount.clientHeight || height), 0.1, 200);
    camera.position.set(0, 9, 14);

    // Free-look camera: drag to orbit a full 360°, scroll to zoom, right-drag
    // to pan. The orbit target follows whatever the scene is about, so the
    // subject stays centred while the operator looks around it.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 4;
    controls.maxDistance = 44;
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
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x131c2e, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(60, 30, 0x1f3350, 0x18263c);
    grid.position.y = 0.01;
    scene.add(grid);

    const selectedId = liveRef.current.selectedStationId;
    const stations = {};
    Object.entries(STATION_SPOTS).forEach(([id, spot]) => {
      const station = makeStation(`S${id}`, Number(id) === selectedId);
      station.position.set(spot.x, 0, spot.z);
      scene.add(station);
      stations[id] = station;
    });

    const { car, wheels } = makeVehicle();
    scene.add(car);

    const energy = makeEnergyRings();
    scene.add(energy);

    // Vehicle kinematics, driven by the live direction command.
    const drive = { x: 0, z: 0, heading: 0, speed: 0 };
    const camTarget = new THREE.Vector3();
    controls.target.set(0, 1, 0);
    controls.update();
    const home = { position: camera.position.clone(), target: controls.target.clone() };
    const clock = new THREE.Clock();
    let raf;
    let lastTargetId = selectedId;

    function frame() {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      const live = liveRef.current;
      const charging = live.vehicleStatus === 'charging';
      const target = live.selectedStationId;

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

      if (charging && spot) {
        // Docked: ease onto the pad and hold still.
        drive.x += (spot.x - drive.x) * Math.min(1, dt * 2.5);
        drive.z += (spot.z - drive.z) * Math.min(1, dt * 2.5);
        drive.speed *= 0.85;
      } else {
        // Respond to the live command exactly as the controller would.
        const d = live.direction;
        const speedScale = live.driveMode === 'auto' ? Math.max(0, Math.min(100, live.speed ?? 0)) / 100 : 1;
        const wanted = d === 'F' ? DRIVE_SPEED * speedScale : d === 'B' ? -DRIVE_SPEED * speedScale : 0;
        drive.speed += (wanted - drive.speed) * Math.min(1, dt * ACCEL);
        if (d === 'L') drive.heading += TURN_RATE * speedScale * dt;
        if (d === 'R') drive.heading -= TURN_RATE * speedScale * dt;

        drive.x += Math.sin(drive.heading) * drive.speed * dt;
        drive.z += Math.cos(drive.heading) * drive.speed * dt;
        drive.x = Math.max(-YARD_HALF, Math.min(YARD_HALF, drive.x));
        drive.z = Math.max(-YARD_HALF, Math.min(YARD_HALF, drive.z));
      }

      car.position.set(drive.x, 0, drive.z);
      car.rotation.y = drive.heading;
      wheels.forEach((w) => {
        w.rotation.x -= drive.speed * dt * 2.6;
      });

      // Wireless charging: rings climb from the pad to the car.
      energy.visible = charging && !!spot;
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
      <div className="scene3d-hint">Drag to look around · scroll to zoom · right-drag to pan</div>
      <button type="button" className="scene3d-reset" onClick={() => resetRef.current?.()}>
        Reset view
      </button>
    </div>
  );
}
