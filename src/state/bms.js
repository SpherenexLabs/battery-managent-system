import { onValue, ref, remove, set, update } from 'firebase/database';
import { database } from '../firebase.js';

// Live telemetry node published by the vehicle controller.
export const BMS_PATH = 'BMS_5578';
export const STATIONS_PATH = 'BMS';

// Path_Name uses the same number as the station selected in the UI.
export const STATION_PATH_NAME = Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4 });
const PATH_READY_TIMEOUT_MS = 30000;
const PATH_COMMAND_DURATION_MS = 5000;
const RESERVED_STATION_RED_DISTANCE_CM = 10;
let pathResetTimer = null;

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

// Start the controller's built-in path routine using its two-step handshake:
// Execute_Path = 1 -> wait for Execute_Path = "Ready" -> Path_Name = station.
export async function executeStationPath(stationId) {
  const pathName = STATION_PATH_NAME[stationId];
  if (pathName == null) throw new Error(`Unknown station ${stationId}.`);
  if (pathResetTimer != null) clearTimeout(pathResetTimer);
  try {
    await set(ref(database, `${BMS_PATH}/Execute_Path`), 1);
    await waitForExecutePathReady();
    await set(ref(database, `${BMS_PATH}/Path_Name`), pathName);
  } catch (error) {
    await update(ref(database, BMS_PATH), { Execute_Path: 0, Path_Name: 0 }).catch(() => {});
    throw error;
  }
  pathResetTimer = setTimeout(() => {
    pathResetTimer = null;
    update(ref(database, BMS_PATH), { Execute_Path: 0, Path_Name: 0 }).catch((error) => {
      console.error('Could not reset the five-second path command:', error);
    });
  }, PATH_COMMAND_DURATION_MS);
  return pathName;
}

export function cancelStationPath() {
  if (pathResetTimer != null) {
    clearTimeout(pathResetTimer);
    pathResetTimer = null;
  }
  return update(ref(database, BMS_PATH), { Execute_Path: 0, Path_Name: 0 });
}

// Mirror each station's physical switch to its two indicator outputs and relay.
// A confirmed reservation also turns only its station red when that station's
// ultrasonic distance drops below 10 cm. The relay continues to follow only
// the physical switch, so this proximity indication does not change hardware.
export function syncStationIndicators(switches, slots = [], reservedStationId = null) {
  const values = {};
  switches.forEach((value, index) => {
    if (value === 0 || value === 1) {
      const stationId = index + 1;
      const slotValue = slots[index];
      const reservedAndClose =
        stationId === reservedStationId &&
        typeof slotValue === 'number' &&
        slotValue >= 0 &&
        slotValue < RESERVED_STATION_RED_DISTANCE_CM;
      const indicatorEngaged = value === 1 || reservedAndClose;

      values[`green${stationId}`] = indicatorEngaged ? 0 : 1;
      values[`red${stationId}`] = indicatorEngaged ? 1 : 0;
      values[`Relay${index + 1}`] = value;
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

// Relay1 drives the coolant pump, Relay2 the cooling fan. Both go to 1 while
// the battery is above its temperature limit and back to 0 once it is safe.
export function setPumpRelay(on) {
  return set(ref(database, `${BMS_PATH}/Relay1`), on ? 1 : 0);
}

export function setFanRelay(on) {
  return set(ref(database, `${BMS_PATH}/Relay2`), on ? 1 : 0);
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
  return set(ref(database, `${BMS_PATH}/Slot${stationId}`), occupied ? 20 : -1);
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
