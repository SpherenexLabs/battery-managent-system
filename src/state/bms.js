import { onValue, ref, remove, set } from 'firebase/database';
import { database } from '../firebase.js';

// Live telemetry node published by the vehicle controller.
export const BMS_PATH = 'bms_5578';

// Saved auto-drive routes. Kept in a sibling node rather than inside the
// telemetry node so the controller's live stream carries only live values.
export const ROUTES_PATH = 'auto_routes';

export function subscribeBmsData(callback) {
  const bmsRef = ref(database, BMS_PATH);
  return onValue(bmsRef, (snapshot) => {
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
