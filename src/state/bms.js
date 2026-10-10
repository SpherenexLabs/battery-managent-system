import { onValue, ref, remove, set, update } from 'firebase/database';
import { database } from '../firebase.js';

// Live telemetry node published by the vehicle controller.
export const BMS_PATH = 'BMS_5578';
export const STATIONS_PATH = 'BMS';

// Each station sends its own number to the controller as Path_Name.
export const STATION_PATH_NAME = Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4 });
const PATH_READY_TIMEOUT_MS = 30000;
const STATION_RED_DISTANCE_CM = 20;

// Saved auto-drive routes. Kept in a sibling node rather than inside the
// telemetry node so the controller's live stream carries only live values.
export const ROUTES_PATH = 'auto_routes';

export function subscribeBmsData(callback) {
  const bmsRef = ref(database, BMS_PATH);
  return onValue(bmsRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
}

export function subscribeStationData(callback) {
  const stationsRef = ref(database, STATIONS_PATH);
  return onValue(stationsRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
}

export function subscribeConnection(callback) {
  const connectedRef = ref(database, '.info/connected');
  return onValue(connectedRef, (snapshot) => {
    callback(snapshot.val() === true);
  });
}

// ---------------------------------------------------------------------------
// Drive commands
// ---------------------------------------------------------------------------

// F = forward, B = backward, L = left, R = right, S = stop.
export const DIRECTIONS = ['F', 'B', 'L', 'R', 'S'];

export function setDirection(direction) {
  const value = DIRECTIONS.includes(direction) ? direction : 'S';
  return set(ref(database, `${BMS_PATH}/direction`), value);
}

// Wait for the controller to acknowledge Execute_Path = 1. The firmware writes
// "Ready" back to the same field when it is ready to receive Path_Name.
function waitForExecutePathReady(timeoutMs = PATH_READY_TIMEOUT_MS) {
  const executePathRef = ref(database, `${BMS_PATH}/Execute_Path`);

  return new Promise((resolve, reject) => {
    let unsubscribe = null;
    let settled = false;
    const timeoutId = setTimeout(() => {
      finish(new Error('The controller did not report Ready. Please try again.'));
    }, timeoutMs);

    function finish(error = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
      if (error) reject(error);
      else resolve();
    }

    unsubscribe = onValue(
      executePathRef,
      (snapshot) => {
        const value = snapshot.val();
        if (typeof value === 'string' && value.trim().toLowerCase() === 'ready') {
          finish();
        }
      },
      (error) => finish(error)
    );

    // Protect against an implementation invoking the initial callback before
    // onValue has returned its unsubscribe function.
    if (settled && unsubscribe) unsubscribe();
  });
}

// The station screen exposes the controller handshake as two separate buttons.
// Initialize writes Execute_Path first; Reserve writes the selected Path_Name.
export async function initializeStationPath() {
  await set(ref(database, `${BMS_PATH}/Execute_Path`), 1);
  await waitForExecutePathReady();
}

export async function reserveStationPath(stationId) {
  const pathName = STATION_PATH_NAME[stationId];
  if (pathName == null) throw new Error(`Unknown station ${stationId}.`);
  await set(ref(database, `${BMS_PATH}/Path_Name`), pathName);
  return pathName;
}

// Retained for callers that need the complete automatic handshake.
export async function executeStationPath(stationId) {
  await initializeStationPath();
  return reserveStationPath(stationId);
}

export function cancelStationPath() {
  return update(ref(database, BMS_PATH), { Execute_Path: 0, Path_Name: 0 });
}

// Mirror each station's physical switch and ultrasonic state to its indicator
// outputs. Any valid reading below 20 cm turns that station red. The charging
// relay stays OFF until the reserved station is confirmed below 20 cm.
export function syncStationIndicators(
  switches,
  slots = [],
  reservedStationId = null,
  chargingStationId = null
) {
  const values = {};
  switches.forEach((value, index) => {
    const stationId = index + 1;
    const hasSwitchReading = value === 0 || value === 1;
    const slotValue = slots[index];
    const hasSlotReading = typeof slotValue === 'number';
    // The reserved station must remain controllable even if its optional
    // switch telemetry is unavailable, especially so its relay can turn off.
    if (hasSwitchReading || hasSlotReading || stationId === reservedStationId) {
      const ultrasonicClose =
        typeof slotValue === 'number' && slotValue > 0 && slotValue < STATION_RED_DISTANCE_CM;
      const switchEngaged = value === 1;
      const chargingHere = stationId === chargingStationId;
      const indicatorEngaged = switchEngaged || ultrasonicClose || chargingHere;

      values[`green${stationId}`] = indicatorEngaged ? 0 : 1;
      values[`red${stationId}`] = indicatorEngaged ? 1 : 0;
      // The physical switch only controls the ready/engaged indicator. It must
      // never energise charging before ultrasonic arrival is confirmed.
      values[`Relay${index + 1}`] = chargingHere ? 1 : 0;
    }
  });
  return Object.keys(values).length > 0 ? update(ref(database, STATIONS_PATH), values) : Promise.resolve();
}

// ---------------------------------------------------------------------------
// Thermal commands
// ---------------------------------------------------------------------------

// Artificial heating level, sent as a 0-100 percentage.
export function setHeat(percent) {
  return set(ref(database, `${BMS_PATH}/Heat`), Math.max(0, Math.min(100, Math.round(percent))));
}

// Demo thermal model writes the simulated battery temperature while the robot
// moves or cools. Keep one decimal place to avoid noisy Firebase updates.
export function setTemperature(celsius) {
  const value = Math.round(Number(celsius) * 10) / 10;
  if (!Number.isFinite(value)) return Promise.reject(new Error('Invalid temperature value.'));
  return Promise.all([
    set(ref(database, `${BMS_PATH}/Temp`), value),
    set(ref(database, `${STATIONS_PATH}/Temp`), value),
  ]);
}

// Relay1 drives the coolant pump, Relay2 the cooling fan. Thermal/manual
// control and an active charging session can request these outputs.
export function setPumpRelay(on) {
  return set(ref(database, `${BMS_PATH}/Relay1`), on ? 1 : 0);
}

export function setFanRelay(on) {
  const value = on ? 1 : 0;
  // The vehicle controller exposes Relay2, while the station/thermal
  // controller exposes the same physical fan as Relay. Keep both in sync.
  return Promise.all([
    set(ref(database, `${BMS_PATH}/Relay2`), value),
    set(ref(database, `${STATIONS_PATH}/Relay`), value),
  ]);
}

export function setCooling(on) {
  return Promise.all([setPumpRelay(on), setFanRelay(on)]);
}

// ---------------------------------------------------------------------------
// Station slot simulation
// ---------------------------------------------------------------------------

// Each prototype station exposes one ultrasonic slot sensor. A short reading
// means occupied; -1 represents a clear bay with no sensor echo.
export function setStationOccupied(stationId, occupied) {
  return set(ref(database, `${BMS_PATH}/Slot${stationId}`), occupied ? 4 : -1);
}

// ---------------------------------------------------------------------------
// Saved auto-drive routes (create / update / delete)
// ---------------------------------------------------------------------------

export function subscribeRoutes(callback) {
  const routesRef = ref(database, ROUTES_PATH);
  return onValue(routesRef, (snapshot) => {
    const value = snapshot.val() || {};
    const routes = Object.entries(value).map(([id, route]) => ({
      id,
      name: route?.name ?? id,
      steps: Array.isArray(route?.steps) ? route.steps : [],
      updatedAt: route?.updatedAt ?? null,
    }));
    routes.sort((a, b) => a.name.localeCompare(b.name));
    callback(routes);
  });
}

// Writing the whole route replaces it, so the same call creates a new route
// and updates an existing one — the id decides which.
export function saveRoute(route) {
  return set(ref(database, `${ROUTES_PATH}/${route.id}`), {
    name: route.name,
    steps: route.steps.map((step) => ({ direction: step.direction, seconds: step.seconds })),
    updatedAt: Date.now(),
  });
}

export function deleteRoute(routeId) {
  return remove(ref(database, `${ROUTES_PATH}/${routeId}`));
}
