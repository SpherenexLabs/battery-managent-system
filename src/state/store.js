import { createContext, useContext } from 'react';
import { distanceKm } from '../utils/geo.js';

// Live battery temperature thresholds (°C)
// Alert-only thresholds: nothing is locked or switched automatically — the
// heater, pump and fan are always under the operator's manual control.
const WARN_TEMP = 20; // high-temperature alert
const CRITICAL_TEMP = 30; // critical-temperature alert
const LOW_SOC_THRESHOLD = 15; // % — "find a nearby charging station" alert

// SOC is derived from the vehicle pack voltage (Voltage1). Firebase publishes
// no direct SOC field. Range matches this pack's expected empty/full voltage.
const SOC_VOLTAGE_MIN = 9.5;
const SOC_VOLTAGE_MAX = 12.6;

// Predictive battery-failure-detection thresholds (rule-based prototype —
// tune against real fault data / battery datasheet before production use).
const HISTORY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const HISTORY_MAX_SAMPLES = 200;
const VOLTAGE_DROP_THRESHOLD = 1.0; // V, sudden drop between consecutive readings
const CURRENT_SWING_THRESHOLD = 2.0; // A, abnormal swing between consecutive readings
const TEMPERATURE_RISE_THRESHOLD = 3.0; // °C, rapid rise between consecutive readings
const SOC_JUMP_THRESHOLD = 10; // %, implausible jump between consecutive readings
const REPEATED_OVERHEAT_COUNT = 3; // occurrences within the history window
const SLOW_CHARGE_MIN_MINUTES = 5; // minutes of active charging before judging rate
const SLOW_CHARGE_MIN_GAIN = 1; // % SOC expected to gain within that window

export const THERMAL_LIMITS = {
  WARN_TEMP,
  CRITICAL_TEMP,
  LOW_SOC_THRESHOLD,
};

// Drive commands understood by the controller.
export const DIRECTION_LABEL = {
  F: 'Forward',
  B: 'Backward',
  R: 'Left',
  L: 'Right',
  S: 'Stopped',
};

export function getChargingPower(state) {
  const measuredPower =
    state.voltage != null && state.current != null ? Math.abs(state.voltage * state.current) : 0;
  return { watts: measuredPower, source: 'bms' };
}

export const SCREEN_IDS = ['overview', 'stations', 'navigation', 'charging', 'thermal', 'health'];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Issues a drive command. The bumped sequence number gives every command a
// fresh identity, so re-sending the same direction still reaches the device.
const withCommand = (state, direction) => ({
  command: { direction, seq: state.commandSeq + 1 },
  commandSeq: state.commandSeq + 1,
});

export const stepsTotalSeconds = (steps) => steps.reduce((sum, s) => sum + s.seconds, 0);
export const routeTotalSeconds = (route) => stepsTotalSeconds(route.steps);

// How far through a step list the vehicle is, as a percentage of total run time.
function stepsProgress(steps, stepIndex, remaining) {
  const total = stepsTotalSeconds(steps);
  if (total === 0) return 0;
  const elapsed =
    steps.slice(0, stepIndex).reduce((sum, s) => sum + s.seconds, 0) +
    (steps[stepIndex].seconds - remaining);
  return clamp((elapsed / total) * 100, 0, 100);
}

// Playback carries its own copy of the steps rather than a route id, so steps
// the operator is still editing can be test-driven with exactly the same engine
// as a saved route, and editing a route mid-run cannot derail it.
function startPlayback(steps, { kind, routeId = null, label }) {
  return {
    kind,
    routeId,
    label,
    steps: steps.map((step) => ({ ...step })),
    stepIndex: 0,
    remaining: steps[0].seconds,
  };
}

const round1 = (v) => Math.round(v * 10) / 10;
const pushLog = (log, text) => [{ time: Date.now(), text }, ...log].slice(0, 30);
const trimByWindow = (list, now) => list.filter((t) => now - t <= HISTORY_WINDOW_MS);

function socFromVoltage(voltage) {
  const pct = ((voltage - SOC_VOLTAGE_MIN) / (SOC_VOLTAGE_MAX - SOC_VOLTAGE_MIN)) * 100;
  return round1(clamp(pct, 0, 100));
}

function sohEstimate(temperature, voltage) {
  let soh = 100;
  if (temperature > 45) soh -= Math.min(30, (temperature - 45) * 1.5);
  if (voltage < SOC_VOLTAGE_MIN) soh -= 10;
  return Math.round(clamp(soh, 40, 100));
}

// Placeholder coordinates for the 4 charging stations — replace with real
// site coordinates once known. Used only for live distance/direction from
// the vehicle's current (browser geolocation) position.
const STATION_COORDS = {
  1: { lat: 13.0827, lng: 80.2707 },
  2: { lat: 13.0891, lng: 80.2747 },
  3: { lat: 13.0774, lng: 80.2793 },
  4: { lat: 13.0756, lng: 80.265 },
};

const STATIONS_BASE = [
  { id: 1, name: 'Station 1', totalSlots: 1, ...STATION_COORDS[1] },
  { id: 2, name: 'Station 2', totalSlots: 1, ...STATION_COORDS[2] },
  { id: 3, name: 'Station 3', totalSlots: 1, ...STATION_COORDS[3] },
  { id: 4, name: 'Station 4', totalSlots: 1, ...STATION_COORDS[4] },
];

// Used only while the prototype has not published real station GPS positions.
// Each offset is approximately within 0.5-1.5 km of the vehicle location.
const PROTOTYPE_NEARBY_OFFSETS = [
  { lat: 0.005, lng: 0.003 },
  { lat: -0.004, lng: 0.008 },
  { lat: 0.009, lng: -0.004 },
  { lat: -0.007, lng: -0.006 },
];

const NEARBY_STATION_LABELS = ['North Point', 'East Gate', 'West Park', 'South Plaza'];

function nearbyStationName(index, location) {
  const lat = `${Math.abs(location.lat).toFixed(3)}${location.lat >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(location.lng).toFixed(3)}${location.lng >= 0 ? 'E' : 'W'}`;
  return `${NEARBY_STATION_LABELS[index]} Charge Hub - ${lat}, ${lng}`;
}

// Slot sensors report a distance reading in cm (-1 = no echo / out of range).
// A reading closer than this means a vehicle is physically present in the slot.
const OCCUPIED_DISTANCE_CM = 40;

function computeStations(state) {
  return STATIONS_BASE.map((base, i) => {
    const reportedLocation = state.stationLocations[i];
    const hasVehicleLocation = state.vehicleLocation.lat != null && state.vehicleLocation.lng != null;
    const location =
      reportedLocation != null
        ? reportedLocation
        : hasVehicleLocation
          ? {
              lat: state.vehicleLocation.lat + PROTOTYPE_NEARBY_OFFSETS[i].lat,
              lng: state.vehicleLocation.lng + PROTOTYPE_NEARBY_OFFSETS[i].lng,
            }
          : { lat: base.lat, lng: base.lng };
    const slotValue = state.slots[i];
    const filledSlots = state.stationOccupancy[i] ?? (slotValue !== -1 && slotValue >= 0 && slotValue <= OCCUPIED_DISTANCE_CM ? 1 : 0);
    const totalSlots = state.stationCapacity[i] ?? base.totalSlots;
    const reservationHeld = base.id === state.selectedStationId && state.reservationStatus !== 'none';
    const availableSlots = Math.max(0, totalSlots - filledSlots - (reservationHeld ? 1 : 0));
    let status = availableSlots > 0 ? 'available' : 'occupied';
    if (base.id === state.selectedStationId) {
      if (state.vehicleStatus === 'charging') status = 'charging';
      else if (state.reservationStatus !== 'none') status = 'reserved';
    }
    const distance = hasVehicleLocation
      ? distanceKm(state.vehicleLocation.lat, state.vehicleLocation.lng, location.lat, location.lng)
      : null;
    const name = state.stationNames[i] ?? (hasVehicleLocation ? nearbyStationName(i, location) : base.name);
    const current = state.stationCurrents[i];
    const voltage = state.stationVoltages[i];
    const power = current != null && voltage != null ? round1(Math.abs(current * voltage)) : null;
    return {
      ...base,
      ...location,
      name,
      status,
      slotValue,
      filledSlots,
      totalSlots,
      availableSlots,
      distance,
      current,
      voltage,
      power,
      locationSource: reportedLocation != null ? 'iot' : hasVehicleLocation ? 'prototype' : 'default',
    };
  }).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
}

export function computeAlerts(state) {
  const alerts = [];
  const now = Date.now();

  if (state.soc != null && state.soc <= LOW_SOC_THRESHOLD) {
    alerts.push({
      id: 'low-battery',
      label: 'Battery running low. Please find the nearby charging station to continue your peaceful journey.',
      severity: 'high',
      status: 'active',
    });
  }

  if (state.temperature != null && state.temperature >= CRITICAL_TEMP) {
    alerts.push({
      id: 'critical-temp',
      label: `Battery temperature is critical (${state.temperature.toFixed(1)}°C).`,
      severity: 'high',
      status: 'active',
    });
  } else if (state.temperature != null && state.temperature >= WARN_TEMP) {
    alerts.push({
      id: 'overheat',
      label: `Battery temperature is high (${state.temperature.toFixed(1)}°C).`,
      severity: 'high',
      status: 'active',
    });
  }

  const overheatCount = trimByWindow(state.history.overheatEvents, now).length;
  if (overheatCount >= REPEATED_OVERHEAT_COUNT) {
    alerts.push({
      id: 'repeated-overheat',
      label: `Battery degradation warning — ${overheatCount} overheating events in the last 15 minutes. Maintenance required.`,
      severity: 'high',
      status: 'active',
    });
  }

  const samples = state.history.samples;
  const last = samples[samples.length - 1];
  const prev = samples[samples.length - 2];
  if (last && prev) {
    if (prev.voltage != null && last.voltage != null && prev.voltage - last.voltage >= VOLTAGE_DROP_THRESHOLD) {
      alerts.push({
        id: 'voltage-drop',
        label: 'Charging instability detected — sudden voltage drop observed. Battery health abnormal.',
        severity: 'high',
        status: 'active',
      });
    }
    if (prev.current != null && last.current != null && Math.abs(last.current - prev.current) >= CURRENT_SWING_THRESHOLD) {
      alerts.push({
        id: 'current-swing',
        label: 'Abnormal current variation detected — charging instability detected.',
        severity: 'medium',
        status: 'active',
      });
    }
    if (prev.temperature != null && last.temperature != null && last.temperature - prev.temperature >= TEMPERATURE_RISE_THRESHOLD) {
      alerts.push({
        id: 'rapid-temperature-rise',
        label: `Rapid temperature rise — ${round1(last.temperature - prev.temperature)}°C between live readings.`,
        severity: 'high',
        status: 'active',
      });
    }
    if (prev.soc != null && last.soc != null && Math.abs(last.soc - prev.soc) >= SOC_JUMP_THRESHOLD) {
      alerts.push({
        id: 'soc-instability',
        label: 'Battery percentage instability detected — battery health abnormal.',
        severity: 'medium',
        status: 'active',
      });
    }
  }

  const { active, sessionStartedAt, sessionStartSoc } = state.charging;
  if (active && sessionStartedAt != null && sessionStartSoc != null && state.soc != null) {
    const elapsedMin = (now - sessionStartedAt) / 60000;
    const gained = state.soc - sessionStartSoc;
    if (elapsedMin >= SLOW_CHARGE_MIN_MINUTES && gained < SLOW_CHARGE_MIN_GAIN) {
      alerts.push({
        id: 'slow-charge',
        label: 'Charging inefficiency detected — battery percentage rising slower than expected. Maintenance required.',
        severity: 'medium',
        status: 'active',
      });
    }
  }

  if (!state.connectivity.online) {
    alerts.push({ id: 'offline', label: 'BMS connection lost — showing last known values.', severity: 'medium', status: 'active' });
  }

  if (alerts.length === 0) {
    alerts.push({ id: 'nominal', label: 'No active battery alerts.', severity: 'low', status: 'resolved' });
  }
  return alerts;
}

// Records the real moment each alert first became active, so the UI can show
// a genuine "since" time instead of a fabricated one. Runs inside the
// reducer (alongside the equally time-stamped event log) rather than in a
// component, since only the reducer sees every state transition as it happens.
function withAlertTimestamps(nextState) {
  const activeIds = computeAlerts(nextState)
    .filter((a) => a.status === 'active')
    .map((a) => a.id);
  const prev = nextState.alertTimestamps;
  const now = Date.now();
  const alertTimestamps = {};
  let changed = activeIds.length !== Object.keys(prev).length;
  activeIds.forEach((id) => {
    alertTimestamps[id] = prev[id] ?? now;
    if (prev[id] == null) changed = true;
  });
  return changed ? { ...nextState, alertTimestamps } : nextState;
}

export const initialState = {
  screen: 'overview',
  clock: new Date(),

  // Live BMS telemetry (null until the first Firebase read arrives)
  voltage: null, // Voltage1 — vehicle pack voltage
  current: null,
  temperature: null,
  pumpRelay: 0, // Relay1 — coolant pump
  fanRelay: 0, // Relay2 — cooling fan
  heatPercent: 0, // Heat — artificial heating level, 0-100 %
  direction: 'S', // F = forward, B = backward, L = left, R = right, S = stop
  driveMode: 'manual', // manual | auto
  slots: [-1, -1, -1, -1],

  // Saved auto-drive routes, mirrored from Firebase. The vehicle only ever
  // drives one of these, so a reservation cannot be confirmed without one.
  routes: [],
  routesLoaded: false,
  selectedRouteId: null, // the route chosen to drive to the reserved station
  playback: null, // { routeId, stepIndex, remaining }

  // Last drive command this app issued. A new object (bumped `seq`) each time,
  // so the Firebase writer fires even when the same direction repeats.
  command: null,
  commandSeq: 0,
  // Direct BMS state-machine telemetry. SOC/SOD are binary status signals;
  // Count is displayed as the controller's live SOC count.
  socSignal: 0,
  sodSignal: 0,
  socCount: null,
  // Optional aggregate station telemetry. If unavailable, each SlotN sensor
  // represents the single charging bay at Station N.
  stationOccupancy: [null, null, null, null],
  stationCapacity: [null, null, null, null],
  stationLocations: [null, null, null, null],
  stationNames: [null, null, null, null],
  // Per-station wireless-transmitter telemetry. Station 1 is the physical
  // prototype bay and reads the controller's Current / Voltage2 fields;
  // stations 2-4 only report if StationNCurrent / StationNVoltage are published.
  stationCurrents: [null, null, null, null],
  stationVoltages: [null, null, null, null],
  soc: null,
  soh: null,

  vehicleStatus: 'idle', // idle | moving | arrived | charging

  selectedStationId: null,
  reservationStatus: 'none', // none | pending | confirmed

  navProgress: 0,
  navStopped: false,
  routeSteps: { reservationConfirmed: false, followingTrack: false, arrived: false },

  charging: {
    active: false,
    mode: 'paused', // fast | normal | paused | complete
    arrivalConfirmed: false,
    coilAligned: false,
    sessionStartedAt: null,
    sessionStartSoc: null,
    energyWh: 0,
  },

  history: {
    samples: [], // { t, voltage, current, temperature, soc }
    overheatEvents: [], // timestamps the battery crossed into the warning zone
  },

  vehicleLocation: { lat: null, lng: null, error: null, updatedAt: null },

  healthAcknowledged: false,
  eventLogOpen: false,
  eventLog: [],

  connectivity: { online: false, lastSync: null },

  alertTimestamps: {}, // alert id -> ms epoch it first became active
};

initialState.stations = computeStations(initialState);

function reducerInner(state, action) {
  switch (action.type) {
    case 'GO_TO':
      return { ...state, screen: action.screen };

    case 'TICK': {
      const clock = new Date();
      if (!state.charging.active) return withAlertTimestamps({ ...state, clock });
      const power = getChargingPower(state);
      const previousEnergyWh = Number.isFinite(state.charging.energyWh) ? state.charging.energyWh : 0;
      return withAlertTimestamps({
        ...state,
        clock,
        charging: { ...state.charging, energyWh: previousEnergyWh + power.watts / 3600 },
      });
    }

    case 'BMS_UPDATE': {
      const d = action.data || {};
      const now = Date.now();
      const voltage = typeof d.Voltage1 === 'number' ? round1(d.Voltage1) : state.voltage;
      const current = typeof d.Current === 'number' ? round1(d.Current) : state.current;
      const temperature = typeof d.Temp === 'number' ? round1(d.Temp) : state.temperature;
      const pumpRelay = typeof d.Relay1 === 'number' ? (d.Relay1 > 0 ? 1 : 0) : state.pumpRelay;
      const fanRelay = typeof d.Relay2 === 'number' ? (d.Relay2 > 0 ? 1 : 0) : state.fanRelay;
      const heatPercent = typeof d.Heat === 'number' ? clamp(Math.round(d.Heat), 0, 100) : state.heatPercent;
      const direction = typeof d.direction === 'string' && DIRECTION_LABEL[d.direction] ? d.direction : state.direction;
      const socSignal = typeof d.SOC === 'number' ? (d.SOC > 0 ? 1 : 0) : state.socSignal;
      const sodSignal = typeof d.SOD === 'number' ? (d.SOD > 0 ? 1 : 0) : state.sodSignal;
      const socCount = typeof d.Count === 'number' ? d.Count : state.socCount;
      const slots = [0, 1, 2, 3].map((i) => {
        const v = d[`Slot${i + 1}`];
        return typeof v === 'number' ? v : state.slots[i];
      });
      const stationOccupancy = [0, 1, 2, 3].map((i) => {
        const value = d[`Station${i + 1}Filled`];
        return typeof value === 'number' && value >= 0 ? Math.round(value) : state.stationOccupancy[i];
      });
      const stationCapacity = [0, 1, 2, 3].map((i) => {
        const value = d[`Station${i + 1}Total`];
        return typeof value === 'number' && value > 0 ? Math.round(value) : state.stationCapacity[i];
      });
      const stationLocations = [0, 1, 2, 3].map((i) => {
        const lat = d[`Station${i + 1}Lat`];
        const lng = d[`Station${i + 1}Lng`];
        return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : state.stationLocations[i];
      });
      const stationNames = [0, 1, 2, 3].map((i) => {
        const value = d[`Station${i + 1}Name`];
        return typeof value === 'string' && value.trim() ? value.trim() : state.stationNames[i];
      });
      // Station 1 is the physical prototype bay: its readings are the
      // controller's own "Current" and "Voltage2" (the station-side voltage).
      // Stations 2-4 only report if StationNCurrent / StationNVoltage exist.
      const stationCurrents = [0, 1, 2, 3].map((i) => {
        const value = i === 0 ? d.Current : d[`Station${i + 1}Current`];
        return typeof value === 'number' ? round1(value) : state.stationCurrents[i];
      });
      const stationVoltages = [0, 1, 2, 3].map((i) => {
        const value = i === 0 ? d.Voltage2 : d[`Station${i + 1}Voltage`];
        return typeof value === 'number' ? round1(value) : state.stationVoltages[i];
      });

      const soc = voltage == null ? state.soc : socFromVoltage(voltage);
      const soh = temperature == null || voltage == null ? state.soh : sohEstimate(temperature, voltage);

      let eventLog = state.eventLog;

      const wasLow = state.soc != null && state.soc <= LOW_SOC_THRESHOLD;
      const isLow = soc != null && soc <= LOW_SOC_THRESHOLD;
      if (isLow && !wasLow) {
        eventLog = pushLog(eventLog, `Battery running low (${Math.round(soc)}% SOC) — find a nearby charging station.`);
      }

      const wasWarn = state.temperature != null && state.temperature >= WARN_TEMP;
      const isWarn = temperature != null && temperature >= WARN_TEMP;
      const wasCritical = state.temperature != null && state.temperature >= CRITICAL_TEMP;
      const isCritical = temperature != null && temperature >= CRITICAL_TEMP;

      if (isWarn && !wasWarn) {
        eventLog = pushLog(eventLog, `Battery temperature high (${temperature.toFixed(1)}°C).`);
      }
      if (!isWarn && wasWarn) {
        eventLog = pushLog(eventLog, `Battery temperature back to safe range (${temperature.toFixed(1)}°C).`);
      }
      if (isCritical && !wasCritical) {
        eventLog = pushLog(eventLog, `Battery temperature critical (${temperature.toFixed(1)}°C).`);
      }

      if (pumpRelay !== state.pumpRelay) {
        eventLog = pushLog(eventLog, `Coolant pump (Relay1) turned ${pumpRelay ? 'ON' : 'OFF'}.`);
      }
      if (fanRelay !== state.fanRelay) {
        eventLog = pushLog(eventLog, `Cooling fan (Relay2) turned ${fanRelay ? 'ON' : 'OFF'}.`);
      }

      let charging = state.charging;
      if (charging.active && soc != null && soc >= 100 && charging.mode !== 'complete') {
        charging = { ...charging, mode: 'complete', active: false, sessionStartedAt: null, sessionStartSoc: null };
        eventLog = pushLog(eventLog, 'Battery fully charged (100% SOC) — charging session complete.');
      }

      const samples = [...state.history.samples, { t: now, voltage, current, temperature, soc, soh, chargeCycles: socCount }].slice(
        -HISTORY_MAX_SAMPLES
      );
      let overheatEvents = trimByWindow(state.history.overheatEvents, now);
      if (isWarn && !wasWarn) overheatEvents = [...overheatEvents, now];

      return withAlertTimestamps({
        ...state,
        voltage,
        current,
        temperature,
        pumpRelay,
        fanRelay,
        heatPercent,
        direction,
        socSignal,
        sodSignal,
        socCount,
        slots,
        stationOccupancy,
        stationCapacity,
        stationLocations,
        stationNames,
        stationCurrents,
        stationVoltages,
        soc,
        soh,
        charging,
        eventLog,
        history: { samples, overheatEvents },
        connectivity: { online: true, lastSync: now },
      });
    }

    case 'BMS_CONNECTION': {
      if (state.connectivity.online === action.online) return state;
      return withAlertTimestamps({
        ...state,
        connectivity: { online: action.online, lastSync: action.online ? Date.now() : state.connectivity.lastSync },
        eventLog: pushLog(state.eventLog, action.online ? 'BMS connection established.' : 'BMS connection lost.'),
      });
    }

    case 'SET_VEHICLE_LOCATION':
      return {
        ...state,
        vehicleLocation: { ...state.vehicleLocation, lat: action.lat, lng: action.lng, error: null, updatedAt: Date.now() },
      };

    case 'SET_VEHICLE_LOCATION_ERROR':
      return { ...state, vehicleLocation: { ...state.vehicleLocation, error: action.error } };

    case 'SET_DRIVE_MODE': {
      if (state.driveMode === action.mode) return state;
      const base = {
        ...state,
        driveMode: action.mode,
        eventLog: pushLog(state.eventLog, `Drive mode switched to ${action.mode === 'auto' ? 'Auto' : 'Manual'}.`),
      };
      // Leaving Auto must not abandon the vehicle mid-route.
      if (action.mode === 'manual' && state.playback) {
        return {
          ...base,
          playback: null,
          ...withCommand(state, 'S'),
          eventLog: pushLog(base.eventLog, 'Auto route cancelled — switched to manual.'),
        };
      }
      return base;
    }

    case 'SEND_DIRECTION':
      return {
        ...state,
        ...withCommand(state, action.direction),
        eventLog: action.log
          ? pushLog(state.eventLog, `${action.log}: ${DIRECTION_LABEL[action.direction]} (${action.direction}).`)
          : state.eventLog,
      };

    case 'ROUTES_LOADED': {
      const routes = action.routes;
      // Drop a selection whose route has since been deleted elsewhere.
      const selectedRouteId = routes.some((r) => r.id === state.selectedRouteId) ? state.selectedRouteId : null;
      return { ...state, routes, routesLoaded: true, selectedRouteId };
    }

    case 'SELECT_ROUTE':
      return { ...state, selectedRouteId: action.routeId };

    case 'PLAY_ROUTE': {
      const route = state.routes.find((r) => r.id === action.routeId);
      if (!route || route.steps.length === 0) return state;
      return {
        ...state,
        driveMode: 'auto',
        playback: startPlayback(route.steps, { kind: 'route', routeId: route.id, label: route.name }),
        ...withCommand(state, route.steps[0].direction),
        eventLog: pushLog(state.eventLog, `Auto route "${route.name}" started.`),
      };
    }

    // Real-time trial of steps that have not been saved yet. Drives the
    // hardware exactly as a saved route would, but never counts as arrival.
    case 'TEST_STEPS': {
      const steps = (action.steps || []).filter((step) => step && step.direction && step.seconds > 0);
      if (steps.length === 0) return state;
      const label = action.label || 'steps';
      return {
        ...state,
        driveMode: 'auto',
        playback: startPlayback(steps, { kind: 'test', label }),
        ...withCommand(state, steps[0].direction),
        eventLog: pushLog(
          state.eventLog,
          `Testing ${label} — ${steps.length} step${steps.length === 1 ? '' : 's'}, ${stepsTotalSeconds(steps)}s.`
        ),
      };
    }

    case 'PLAYBACK_TICK': {
      if (!state.playback) return state;
      const { steps, stepIndex, remaining, kind, label } = state.playback;
      if (!steps || steps.length === 0) return { ...state, playback: null, ...withCommand(state, 'S') };

      // Still inside the current step — just count it down.
      if (remaining > 1) {
        const playback = { ...state.playback, remaining: remaining - 1 };
        const navProgress =
          kind === 'route' ? stepsProgress(steps, stepIndex, playback.remaining) : state.navProgress;
        return { ...state, playback, navProgress };
      }

      const nextStep = steps[stepIndex + 1];

      // Finished. For a saved route this is what marks arrival; a test run is
      // only a trial, so it must never advance the reservation flow.
      if (!nextStep) {
        const arriving = kind === 'route' && state.vehicleStatus === 'moving';
        return {
          ...state,
          playback: null,
          navProgress: kind === 'route' ? 100 : state.navProgress,
          ...withCommand(state, 'S'),
          vehicleStatus: arriving ? 'arrived' : state.vehicleStatus,
          routeSteps: arriving ? { ...state.routeSteps, followingTrack: false, arrived: true } : state.routeSteps,
          eventLog: pushLog(
            state.eventLog,
            arriving
              ? `Auto route "${label}" finished — vehicle arrived at Station ${state.selectedStationId}.`
              : kind === 'test'
                ? `Test of ${label} finished — vehicle stopped.`
                : `Auto route "${label}" finished.`
          ),
        };
      }

      const playback = { ...state.playback, stepIndex: stepIndex + 1, remaining: nextStep.seconds };
      return {
        ...state,
        playback,
        navProgress:
          kind === 'route' ? stepsProgress(steps, playback.stepIndex, playback.remaining) : state.navProgress,
        ...withCommand(state, nextStep.direction),
      };
    }

    case 'STOP_PLAYBACK': {
      if (!state.playback) return state;
      const { kind, label } = state.playback;
      const suffix = action.reason ? ` — ${action.reason}` : '';
      return {
        ...state,
        playback: null,
        ...withCommand(state, 'S'),
        routeSteps: kind === 'route' ? { ...state.routeSteps, followingTrack: false } : state.routeSteps,
        eventLog: pushLog(
          state.eventLog,
          `${kind === 'test' ? 'Test of' : 'Auto route'} "${label}" stopped${suffix}.`
        ),
      };
    }

    case 'STOP_VEHICLE':
      return {
        ...state,
        vehicleStatus: state.vehicleStatus === 'moving' ? 'idle' : state.vehicleStatus,
        navStopped: true,
        playback: null,
        routeSteps: { ...state.routeSteps, followingTrack: false },
        ...withCommand(state, 'S'),
        eventLog: pushLog(
          state.eventLog,
          state.vehicleStatus === 'moving'
            ? `Vehicle manually stopped en route to Station ${state.selectedStationId}.`
            : 'Vehicle stop command sent.'
        ),
      };

    case 'SELECT_STATION': {
      const station = computeStations(state).find((s) => s.id === action.id);
      if (!station || station.status !== 'available') return state;
      if (state.reservationStatus === 'confirmed') return state;
      return { ...state, selectedStationId: action.id, reservationStatus: 'pending' };
    }

    case 'CONFIRM_RESERVATION': {
      const station = computeStations(state).find((s) => s.id === state.selectedStationId);
      // A selected station is marked "reserved" while its reservation is
      // pending, so it remains valid to confirm as long as its bay is open.
      if (!station || station.filledSlots >= station.totalSlots) return state;
      // The vehicle only drives saved auto routes, so confirming a reservation
      // requires one — and confirming is what starts it playing.
      const route = state.routes.find((r) => r.id === state.selectedRouteId);
      if (!route || route.steps.length === 0) return state;
      return {
        ...state,
        reservationStatus: 'confirmed',
        routeSteps: { reservationConfirmed: true, followingTrack: true, arrived: false },
        vehicleStatus: 'moving',
        driveMode: 'auto',
        navProgress: 0,
        navStopped: false,
        screen: 'navigation',
        playback: startPlayback(route.steps, { kind: 'route', routeId: route.id, label: route.name }),
        ...withCommand(state, route.steps[0].direction),
        eventLog: pushLog(
          state.eventLog,
          `Reservation confirmed for Station ${station.id} — playing auto route "${route.name}".`
        ),
      };
    }

    case 'CONFIRM_ARRIVAL':
      if (state.vehicleStatus !== 'arrived') return state;
      return {
        ...state,
        charging: { ...state.charging, arrivalConfirmed: true },
        eventLog: pushLog(state.eventLog, `Vehicle arrived at Station ${state.selectedStationId}.`),
      };

    case 'START_CHARGING_SESSION': {
      if (!state.charging.arrivalConfirmed) return state;
      return {
        ...state,
        vehicleStatus: 'charging',
        screen: 'charging',
        charging: {
          ...state.charging,
          coilAligned: true,
          active: true,
          mode: 'normal',
          sessionStartedAt: Date.now(),
          sessionStartSoc: state.soc,
          energyWh: 0,
        },
        eventLog: pushLog(state.eventLog, `Coil aligned — wireless charging started at Station ${state.selectedStationId}.`),
      };
    }

    case 'SET_CHARGING_MODE': {
      if (action.mode === 'fast' && !state.charging.coilAligned) return state;
      if (action.mode === 'complete') return state;
      const active = action.mode !== 'paused';
      return {
        ...state,
        charging: {
          ...state.charging,
          mode: action.mode,
          active,
          sessionStartedAt: active ? (state.charging.sessionStartedAt ?? Date.now()) : null,
          sessionStartSoc: active ? (state.charging.sessionStartSoc ?? state.soc) : null,
        },
      };
    }

    case 'TOGGLE_CHARGING_ACTIVE': {
      const active = !state.charging.active;
      return {
        ...state,
        charging: {
          ...state.charging,
          active,
          mode: active ? (state.charging.mode === 'paused' ? 'normal' : state.charging.mode) : 'paused',
          sessionStartedAt: active ? (state.charging.sessionStartedAt ?? Date.now()) : null,
          sessionStartSoc: active ? (state.charging.sessionStartSoc ?? state.soc) : null,
        },
      };
    }

    case 'ACK_HEALTH':
      return {
        ...state,
        healthAcknowledged: true,
        eventLog: pushLog(state.eventLog, 'Health advisory acknowledged by operator.'),
      };

    case 'TOGGLE_LOG':
      return { ...state, eventLogOpen: !state.eventLogOpen };

    default:
      return state;
  }
}

export function reducer(state, action) {
  const next = reducerInner(state, action);
  if (next === state) return state;
  return { ...next, stations: computeStations(next) };
}

export const EvStateContext = createContext(null);
export const EvDispatchContext = createContext(null);

export function useEvState() {
  const ctx = useContext(EvStateContext);
  if (!ctx) throw new Error('useEvState must be used within EvProvider');
  return ctx;
}

export function useEvDispatch() {
  const ctx = useContext(EvDispatchContext);
  if (!ctx) throw new Error('useEvDispatch must be used within EvProvider');
  return ctx;
}
