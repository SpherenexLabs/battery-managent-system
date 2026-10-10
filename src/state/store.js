import { createContext, useContext } from 'react';
import { distanceKm } from '../utils/geo.js';

// Live battery temperature thresholds (°C). Temperature safety can hold the
// pump and fan ON together independently of the charging cooling delay.
const WARN_TEMP = 30; // automatic fan / high-temperature threshold
const CRITICAL_TEMP = 40; // critical-temperature alert
const LOW_SOC_THRESHOLD = 15; // % — "find a nearby charging station" alert

// SOC is derived from the vehicle pack voltage (Voltage1). Firebase publishes
// no direct SOC field. Range matches this pack's expected empty/full voltage.
const SOC_VOLTAGE_MIN = 9.5;
const SOC_VOLTAGE_MAX = 12.6;

// Predictive battery-failure-detection thresholds (rule-based prototype —
// tune against real fault data / battery datasheet before production use).
const HISTORY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const HISTORY_MAX_SAMPLES = 200;
const STATION_HISTORY_MAX_SAMPLES = 60;
const VOLTAGE_DROP_THRESHOLD = 1.0; // V, sudden drop between consecutive readings
const CURRENT_SWING_THRESHOLD = 2.0; // A, abnormal swing between consecutive readings
const TEMPERATURE_RISE_THRESHOLD = 3.0; // °C, rapid rise between consecutive readings
const SOC_JUMP_THRESHOLD = 10; // %, implausible jump between consecutive readings
const REPEATED_OVERHEAT_COUNT = 3; // occurrences within the history window
const SLOW_CHARGE_MIN_MINUTES = 5; // minutes of active charging before judging rate
const SLOW_CHARGE_MIN_GAIN = 1; // % SOC expected to gain within that window
const TRIP_START_SOC_MIN = 50;
const TRIP_START_SOC_MAX = 75;
const DRIVING_SOC_FLOOR = 25;
const DRIVING_SOC_DROP_PER_SECOND = 0.1;
const CHARGING_SOC_GAIN_PER_SECOND = 0.5;
const HEATER_BASE_RISE_C_PER_SECOND = 0.1;
const HEATER_ADDITIONAL_RISE_C_PER_SECOND = 0.5;
const FAN_COOLING_C_PER_SECOND = 0.5;
const FAN_OFF_TEMP_C = 27;
const AMBIENT_TEMP_C = 25;
const CHARGING_ACTIVE_TEMP_C = 36;
const CHARGING_HEAT_RISE_C_PER_SECOND = 0.4;
const CHARGING_MAX_TEMP_C = 45;
export const CHARGING_COOLING_DELAY_MS = 5000;

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
  const vehicleVoltage = Number(state.voltage);
  const vehicleCurrent = Number(state.current);
  const measuredPower = Math.abs(vehicleVoltage * vehicleCurrent);
  if (vehicleVoltage > 0 && Math.abs(vehicleCurrent) > 0.01 && measuredPower > 0) {
    return { watts: measuredPower, source: 'bms' };
  }

  const stationIndex = Number.isInteger(state.selectedStationId)
    ? state.selectedStationId - 1
    : -1;
  const stationVoltage = Number(state.stationVoltages?.[stationIndex]);
  const stationCurrent = Number(state.stationCurrents?.[stationIndex]);
  const stationPower = Math.abs(stationVoltage * stationCurrent);
  if (stationVoltage > 0 && Math.abs(stationCurrent) > 0.01 && stationPower > 0) {
    return { watts: stationPower, source: 'station' };
  }

  if (!state.charging?.active) return { watts: 0, source: 'idle' };

  // When the prototype publishes zero current, provide a transparent estimate
  // instead of freezing power and delivered energy at zero. The estimate uses
  // live voltage when available and tapers as SOC approaches 100%.
  const estimatedVoltage = vehicleVoltage > 0
    ? vehicleVoltage
    : stationVoltage > 0
      ? stationVoltage
      : 12;
  const baseCurrent = state.charging.mode === 'fast' ? 2.4 : 1.6;
  const soc = Number.isFinite(state.soc) ? state.soc : 0;
  const socTaper = soc > 80 ? Math.max(0.35, (100 - soc) / 20) : 1;
  const temperatureFactor = Number(state.temperature) >= CRITICAL_TEMP ? 0.8 : 1;
  const predictedPower = estimatedVoltage * baseCurrent * socTaper * temperatureFactor;
  return { watts: predictedPower, source: 'predicted' };
}

export function isChargingCoolingActive(charging, now = Date.now()) {
  return (
    charging?.active === true &&
    Number.isFinite(charging.sessionStartedAt) &&
    now - charging.sessionStartedAt >= CHARGING_COOLING_DELAY_MS
  );
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

function firstNumber(data, keys, fallback = null) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return fallback;
}

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
const OBJECT_DETECTION_DISTANCE_CM = 40;
const STATION_RED_DISTANCE_CM = 20;
const CHARGING_ARRIVAL_DISTANCE_CM = 20;
const SHEET_ROUTE_DISTANCE_CM = 160;

function isChargingArrivalDistance(value) {
  return typeof value === 'number' && value > 0 && value < CHARGING_ARRIVAL_DISTANCE_CM;
}

function chargingArrivalStationId(slots) {
  const index = slots.findIndex(isChargingArrivalDistance);
  return index >= 0 ? index + 1 : null;
}

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
    const switchValue = state.stationSwitches[i];
    const relayValue = state.stationRelays[i];
    const switchEngaged = switchValue === 1;
    const ultrasonicEngaged =
      typeof slotValue === 'number' &&
      slotValue > 0 &&
      slotValue < STATION_RED_DISTANCE_CM;
    const indicatorEngaged = switchEngaged || ultrasonicEngaged;
    const objectDetected = typeof slotValue === 'number' && slotValue > 0 && slotValue <= OBJECT_DETECTION_DISTANCE_CM;
    const filledSlots = state.stationOccupancy[i] ?? (switchEngaged || objectDetected ? 1 : 0);
    const totalSlots = state.stationCapacity[i] ?? base.totalSlots;
    const reservationHeld = base.id === state.selectedStationId && state.reservationStatus !== 'none';
    const availableSlots = Math.max(0, totalSlots - filledSlots - (reservationHeld ? 1 : 0));
    let status = switchEngaged ? 'engaged' : availableSlots > 0 ? 'available' : 'occupied';
    if (base.id === state.selectedStationId) {
      if (state.vehicleStatus === 'charging') status = 'charging';
      else if (state.charging.relayRequested) status = 'connecting';
      else if (state.reservationStatus !== 'none') status = 'reserved';
    }
    if (indicatorEngaged && status !== 'charging' && status !== 'connecting') status = 'engaged';
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
      switchValue,
      relayValue,
      switchEngaged,
      ultrasonicEngaged,
      indicatorEngaged,
      history: state.stationHistory[i],
      locationSource: reportedLocation != null ? 'iot' : hasVehicleLocation ? 'prototype' : 'default',
    };
  });
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
  stationSwitches: [null, null, null, null],
  stationRelays: [null, null, null, null],
  stationHistory: [[], [], [], []],
  stationDataLoaded: false,
  soc: null,
  soh: null,

  vehicleStatus: 'idle', // idle | moving | arrived | charging

  selectedStationId: null,
  reservationStatus: 'none', // none | pending | confirmed
  executePath: 0,
  executePathStatus: null,
  pathName: 0,

  navProgress: 0,
  navStopped: false,
  routeSteps: { reservationConfirmed: false, followingTrack: false, arrived: false },

  charging: {
    active: false,
    mode: 'paused', // fast | normal | paused | complete
    arrivalConfirmed: false,
    coilAligned: false,
    relayRequested: false,
    sessionStartedAt: null,
    sessionStartSoc: null,
    energyWh: 0,
  },

  batterySimulation: {
    active: false,
  },
  thermalSimulationActive: false,
  temperatureFanActive: false,
  manualFanOn: false,
  movementFanCycleActive: false,
  movementFanCycleSecond: 0,

  history: {
    samples: [], // { t, voltage, current, temperature, soc }
    overheatEvents: [], // timestamps the battery crossed into the warning zone
  },

  vehicleLocation: { lat: null, lng: null, error: null, updatedAt: null },

  healthAcknowledged: false,
  eventLogOpen: false,
  eventLog: [],

  connectivity: { online: false, lastSync: null },
  bmsDataLoaded: false,
  reservationRestoredFromFirebase: false,

  alertTimestamps: {}, // alert id -> ms epoch it first became active
};

initialState.stations = computeStations(initialState);

function reducerInner(state, action) {
  switch (action.type) {
    case 'GO_TO':
      return { ...state, screen: action.screen };

    case 'TICK': {
      const clock = new Date();
      const selectedRelayOn =
        state.selectedStationId != null && state.stationRelays[state.selectedStationId - 1] === 1;
      let soc = state.soc;
      let charging = state.charging;
      let eventLog = state.eventLog;
      let temperature = state.temperature;
      let heatPercent = state.heatPercent;
      let temperatureFanActive = state.temperatureFanActive === true;
      const manualFanOn = state.manualFanOn === true;
      const chargingCoolingOn = isChargingCoolingActive(state.charging, clock.getTime());
      let thermalSimulationActive =
        state.thermalSimulationActive ||
        charging.active ||
        heatPercent > 0 ||
        temperatureFanActive ||
        manualFanOn;

      if (state.batterySimulation.active && state.vehicleStatus === 'moving' && soc != null) {
        soc = round1(Math.max(DRIVING_SOC_FLOOR, soc - DRIVING_SOC_DROP_PER_SECOND));
      }

      if (thermalSimulationActive && temperature != null) {
        if (charging.active) {
          // Fast charging generates heat. Once the five-second cooling delay
          // ends, the pump and fan reduce the displayed temperature each tick.
          temperature = chargingCoolingOn || temperatureFanActive || manualFanOn
            ? round1(Math.max(AMBIENT_TEMP_C, temperature - FAN_COOLING_C_PER_SECOND))
            : round1(Math.min(CHARGING_MAX_TEMP_C, temperature + CHARGING_HEAT_RISE_C_PER_SECOND));
        } else if (temperatureFanActive || manualFanOn || chargingCoolingOn) {
          temperature = round1(Math.max(AMBIENT_TEMP_C, temperature - FAN_COOLING_C_PER_SECOND));
          if (temperatureFanActive && temperature <= FAN_OFF_TEMP_C) {
            temperatureFanActive = false;
            eventLog = pushLog(eventLog, `Automatic fan turned OFF at ${temperature.toFixed(1)}°C.`);
          }
        } else if (heatPercent > 0) {
          const heaterRise =
            HEATER_BASE_RISE_C_PER_SECOND +
            (heatPercent / 100) * HEATER_ADDITIONAL_RISE_C_PER_SECOND;
          temperature = round1(Math.min(WARN_TEMP, temperature + heaterRise));
          if (temperature >= WARN_TEMP) {
            temperatureFanActive = true;
            heatPercent = 0;
            eventLog = pushLog(eventLog, `Automatic fan turned ON at ${temperature.toFixed(1)}°C.`);
          }
        } else if (heatPercent <= 0) {
          // Fan has finished cooling and the heater is OFF. The final cooled
          // value has already been mirrored to Firebase, so return to live data.
          thermalSimulationActive = false;
        }
      }

      // Driving never enables cooling. Charging enables both cooling relays
      // after five seconds; manual or temperature safety cooling is immediate.
      let fanRelay = manualFanOn || temperatureFanActive || chargingCoolingOn ? 1 : 0;

      if (chargingCoolingOn && charging.mode === 'fast') {
        charging = { ...charging, mode: 'normal' };
        eventLog = pushLog(
          eventLog,
          'Fast-charge startup complete — switched to Normal mode and enabled pump + fan cooling.'
        );
      }

      if (charging.active && selectedRelayOn) {
        const power = getChargingPower({ ...state, charging, soc, temperature });
        const previousEnergyWh = Number.isFinite(charging.energyWh) ? charging.energyWh : 0;
        charging = { ...charging, energyWh: previousEnergyWh + power.watts / 3600 };
        if (state.batterySimulation.active && soc != null) {
          soc = round1(Math.min(100, soc + CHARGING_SOC_GAIN_PER_SECOND));
        }
      }

      if (charging.active && soc != null && soc >= 100 && charging.mode !== 'complete') {
        charging = {
          ...charging,
          mode: 'complete',
          active: false,
          relayRequested: false,
          sessionStartedAt: null,
          sessionStartSoc: null,
        };
        fanRelay = manualFanOn || temperatureFanActive ? 1 : 0;
        eventLog = pushLog(eventLog, 'Battery fully charged (100% SOC) — charging session complete.');
      }

      return withAlertTimestamps({
        ...state,
        clock,
        soc,
        temperature,
        fanRelay,
        heatPercent,
        thermalSimulationActive,
        temperatureFanActive,
        movementFanCycleActive: false,
        movementFanCycleSecond: 0,
        charging,
        eventLog,
      });
    }

    case 'BMS_UPDATE': {
      const d = action.data || {};
      const now = Date.now();
      const voltage = typeof d.Voltage1 === 'number' ? round1(d.Voltage1) : state.voltage;
      const current = typeof d.Current === 'number' ? round1(d.Current) : state.current;
      const measuredTemperature = typeof d.Temp === 'number' ? round1(d.Temp) : state.temperature;
      const manualFanOn = state.manualFanOn === true;
      const chargingControlsCooling = state.charging.active === true;
      // A persisted Firebase temperature must not re-arm cooling after refresh.
      // Temperature cooling is armed only by this session's Heat control.
      const temperatureFanActive = state.temperatureFanActive === true;
      const thermalSimulationActive =
        state.thermalSimulationActive || temperatureFanActive || manualFanOn;
      const temperature =
        state.thermalSimulationActive && state.temperature != null ? state.temperature : measuredTemperature;
      const automaticPumpRequested =
        temperatureFanActive || manualFanOn || isChargingCoolingActive(state.charging, now);
      const measuredPumpRelay =
        typeof d.Relay1 === 'number' ? (d.Relay1 > 0 ? 1 : 0) : state.pumpRelay;
      const pumpRelay = automaticPumpRequested ? measuredPumpRelay : 0;
      const fanRelay =
        temperatureFanActive || manualFanOn ? 1 : chargingControlsCooling ? state.fanRelay : 0;
      const heatPercent = state.thermalSimulationActive ? state.heatPercent : 0;
      const direction = typeof d.direction === 'string' && DIRECTION_LABEL[d.direction] ? d.direction : state.direction;
      const socSignal = typeof d.SOC === 'number' ? (d.SOC > 0 ? 1 : 0) : state.socSignal;
      const sodSignal = typeof d.SOD === 'number' ? (d.SOD > 0 ? 1 : 0) : state.sodSignal;
      const socCount = typeof d.Count === 'number' ? d.Count : state.socCount;
      const executePath = typeof d.Execute_Path === 'number' ? (d.Execute_Path > 0 ? 1 : 0) : state.executePath;
      const executePathStatus =
        typeof d.Execute_Path === 'string' && d.Execute_Path.trim()
          ? d.Execute_Path.trim()
          : typeof d.Execute_Path === 'number'
            ? null
            : state.executePathStatus;
      const pathName = typeof d.Path_Name === 'number' ? Math.round(d.Path_Name) : state.pathName;
      // Restore the selected reservation after a browser refresh from the
      // controller's live Path_Name. Path values map directly to stations 1–4.
      const pathStationId = pathName >= 1 && pathName <= 4 ? pathName : null;
      const reservationRestoredFromFirebase =
        state.reservationRestoredFromFirebase ||
        (!state.bmsDataLoaded &&
          state.reservationStatus === 'none' &&
          state.selectedStationId == null &&
          pathStationId != null);
      let selectedStationId = state.selectedStationId ?? pathStationId;
      let reservationStatus =
        state.reservationStatus === 'none' && selectedStationId != null
          ? 'confirmed'
          : state.reservationStatus;
      const slots = [0, 1, 2, 3].map((i) => {
        // /BMS is the station controller's authoritative ultrasonic feed.
        // Once it has loaded, do not let stale SlotN fields in /BMS_5578
        // overwrite the close-range value and switch charging back off.
        if (state.stationDataLoaded) return state.slots[i];
        const v = d[`Slot${i + 1}`];
        return typeof v === 'number' ? v : state.slots[i];
      });
      // Physical ultrasonic arrival is authoritative. If it disagrees with a
      // stale reservation/Path_Name, charge the station where the vehicle is.
      const ultrasonicStationId = chargingArrivalStationId(slots);
      const stationChangedByUltrasonic =
        ultrasonicStationId != null && ultrasonicStationId !== selectedStationId;
      if (ultrasonicStationId != null) {
        selectedStationId = ultrasonicStationId;
        reservationStatus = 'confirmed';
      }
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
        if (state.stationDataLoaded) return state.stationCurrents[i];
        const value = i === 0 ? d.Current : d[`Station${i + 1}Current`];
        return typeof value === 'number' ? round1(value) : state.stationCurrents[i];
      });
      const stationVoltages = [0, 1, 2, 3].map((i) => {
        if (state.stationDataLoaded) return state.stationVoltages[i];
        const value = i === 0 ? d.Voltage2 : d[`Station${i + 1}Voltage`];
        return typeof value === 'number' ? round1(value) : state.stationVoltages[i];
      });

      // SlotN is the controller's live vehicle-to-station distance in cm.
      // Only the selected station's valid ultrasonic echo below 20 cm confirms
      // arrival and requests its charging relay. Zero is invalid/no echo.
      const selectedSlot = selectedStationId ? slots[selectedStationId - 1] : null;
      const hasSelectedDistance = typeof selectedSlot === 'number' && selectedSlot > 0;
      const selectedChargingDistanceReached = isChargingArrivalDistance(selectedSlot);
      const distanceProgress = hasSelectedDistance
        ? clamp(((SHEET_ROUTE_DISTANCE_CM - selectedSlot) / SHEET_ROUTE_DISTANCE_CM) * 100, 0, 100)
        : state.navProgress;
      const arrivalDetected = selectedChargingDistanceReached;
      const arrivedFromDistance =
        state.vehicleStatus === 'moving' && arrivalDetected;
      // Execute_Path returning to zero only ends the command pulse; it does not
      // prove physical arrival. The reserved ultrasonic sensor is authoritative.
      let vehicleStatus = arrivedFromDistance ? 'arrived' : state.vehicleStatus;
      if (
        vehicleStatus === 'idle' &&
        reservationStatus === 'confirmed' &&
        selectedStationId != null &&
        !arrivalDetected
      ) {
        vehicleStatus = 'moving';
      }
      let navProgress = vehicleStatus === 'arrived' ? 100 : distanceProgress;
      let routeSteps =
        vehicleStatus === 'arrived'
          ? { ...state.routeSteps, followingTrack: false, arrived: true }
          : state.routeSteps;
      let screen = state.screen;

      const measuredSoc = voltage == null ? state.soc : socFromVoltage(voltage);
      const soc = state.batterySimulation.active && state.soc != null ? state.soc : measuredSoc;
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

      let charging = stationChangedByUltrasonic
        ? {
            ...state.charging,
            active: false,
            mode: 'paused',
            arrivalConfirmed: false,
            coilAligned: false,
            relayRequested: false,
            sessionStartedAt: null,
            sessionStartSoc: null,
            energyWh: 0,
          }
        : state.charging;
      const chargingArrivalLost =
        (charging.relayRequested || charging.active || charging.coilAligned) &&
        !arrivalDetected;
      if (chargingArrivalLost) {
        charging = {
          ...charging,
          active: false,
          mode: 'paused',
          arrivalConfirmed: false,
          coilAligned: false,
          relayRequested: false,
          sessionStartedAt: null,
          sessionStartSoc: null,
        };
        vehicleStatus = reservationStatus === 'confirmed' ? 'moving' : 'idle';
        routeSteps = { ...routeSteps, followingTrack: true, arrived: false };
        eventLog = pushLog(
          eventLog,
          `Station ${selectedStationId} ultrasonic distance left the charging range — charging relay OFF.`
        );
      }
      const selectedRelayOn =
        selectedStationId != null && state.stationRelays[selectedStationId - 1] === 1;
      const shouldAutoStartCharging =
        reservationStatus === 'confirmed' &&
        selectedStationId != null &&
        arrivalDetected &&
        !charging.coilAligned &&
        charging.mode !== 'complete';

      if (shouldAutoStartCharging) {
        vehicleStatus = selectedRelayOn ? 'charging' : 'arrived';
        navProgress = 100;
        routeSteps = { ...state.routeSteps, followingTrack: false, arrived: true };
        screen = 'charging';
        charging = {
          ...charging,
          arrivalConfirmed: true,
          coilAligned: true,
          relayRequested: true,
          active: selectedRelayOn,
          mode: selectedRelayOn ? 'fast' : 'paused',
          sessionStartedAt: selectedRelayOn ? now : null,
          sessionStartSoc: selectedRelayOn ? soc : null,
          energyWh: 0,
        };
        eventLog = pushLog(
          eventLog,
          selectedRelayOn
            ? `Vehicle reached Station ${selectedStationId} (${selectedSlot} cm) — relay is ON and wireless charging started.`
            : `Vehicle reached Station ${selectedStationId} (${selectedSlot} cm) — relay ON was requested.`
        );
      }

      const stopMovementFan = arrivedFromDistance || shouldAutoStartCharging;

      if (charging.active && soc != null && soc >= 100 && charging.mode !== 'complete') {
        charging = {
          ...charging,
          mode: 'complete',
          active: false,
          relayRequested: false,
          sessionStartedAt: null,
          sessionStartSoc: null,
        };
        eventLog = pushLog(eventLog, 'Battery fully charged (100% SOC) — charging session complete.');
      }

      const samples = [...state.history.samples, { t: now, voltage, current, temperature, soc, soh, chargeCycles: socCount }].slice(
        -HISTORY_MAX_SAMPLES
      );
      let overheatEvents = trimByWindow(state.history.overheatEvents, now);
      if (isWarn && !wasWarn) overheatEvents = [...overheatEvents, now];
      const stationRelays = chargingArrivalLost && selectedStationId != null
        ? state.stationRelays.map((relay, index) =>
            index === selectedStationId - 1 ? 0 : relay
          )
        : state.stationRelays;

      return withAlertTimestamps({
        ...state,
        ...(shouldAutoStartCharging ? withCommand(state, 'S') : {}),
        screen,
        voltage,
        current,
        temperature,
        pumpRelay,
        fanRelay: stopMovementFan && !temperatureFanActive ? 0 : fanRelay,
        heatPercent,
        thermalSimulationActive,
        temperatureFanActive,
        movementFanCycleActive: false,
        movementFanCycleSecond: 0,
        direction,
        socSignal,
        sodSignal,
        socCount,
        executePath,
        executePathStatus,
        pathName,
        selectedStationId,
        reservationStatus,
        slots,
        stationOccupancy,
        stationCapacity,
        stationLocations,
        stationNames,
        stationCurrents,
        stationVoltages,
        stationRelays,
        soc,
        soh,
        vehicleStatus,
        navProgress,
        routeSteps,
        charging,
        eventLog,
        history: { samples, overheatEvents },
        connectivity: { online: true, lastSync: now },
        bmsDataLoaded: true,
        reservationRestoredFromFirebase,
      });
    }

    case 'STATION_BMS_UPDATE': {
      const d = action.data || {};
      const now = Date.now();
      const stationCurrents = [1, 2, 3, 4].map((stationId, index) => {
        const value = firstNumber(
          d,
          stationId === 1
            ? ['Current', 'Current1', 'Station1Current']
            : [`Current${stationId}`, `Station${stationId}Current`],
          state.stationCurrents[index]
        );
        return value == null ? null : round1(value);
      });
      const stationVoltages = [1, 2, 3, 4].map((stationId, index) => {
        const value = firstNumber(
          d,
          stationId === 1
            ? ['Voltage', 'Voltage1', 'Station1Voltage']
            : [`Voltage${stationId}`, `Station${stationId}Voltage`],
          state.stationVoltages[index]
        );
        return value == null ? null : round1(value);
      });
      const stationSwitches = [1, 2, 3, 4].map((stationId, index) => {
        const value = firstNumber(
          d,
          stationId === 1
            ? ['Switch1', 'Switch', 'switch1', 'switch']
            : [`Switch${stationId}`, `switch${stationId}`],
          state.stationSwitches[index]
        );
        return value == null ? null : value > 0 ? 1 : 0;
      });
      let stationRelays = [1, 2, 3, 4].map((stationId, index) => {
        const value = firstNumber(
          d,
          [`Relay${stationId}`, `relay${stationId}`, `Station${stationId}Relay`],
          state.stationRelays[index]
        );
        return value == null ? null : value > 0 ? 1 : 0;
      });
      const slots = [1, 2, 3, 4].map((stationId, index) =>
        firstNumber(d, [`Slot${stationId}`, `slot${stationId}`], state.slots[index])
      );
      const stationTemperature = firstNumber(d, ['Temp', 'Temperature'], state.temperature);
      const measuredTemperature = stationTemperature == null ? null : round1(stationTemperature);
      const temperatureFanActive = state.temperatureFanActive === true;
      const thermalSimulationActive =
        state.thermalSimulationActive || temperatureFanActive || state.manualFanOn;
      const temperature =
        state.thermalSimulationActive && state.temperature != null ? state.temperature : measuredTemperature;
      const stationHistory = [0, 1, 2, 3].map((index) => {
        const current = stationCurrents[index];
        const voltage = stationVoltages[index];
        if (current == null && voltage == null) return state.stationHistory[index];
        const previous = state.stationHistory[index];
        const last = previous[previous.length - 1];
        if (last && last.current === current && last.voltage === voltage && now - last.t < 1000) return previous;
        return [...previous, { t: now, current, voltage }].slice(-STATION_HISTORY_MAX_SAMPLES);
      });

      const ultrasonicStationId = chargingArrivalStationId(slots);
      const selectedStationId = ultrasonicStationId ?? state.selectedStationId;
      const reservationStatus =
        ultrasonicStationId != null ? 'confirmed' : state.reservationStatus;
      const stationChangedByUltrasonic =
        ultrasonicStationId != null && ultrasonicStationId !== state.selectedStationId;
      const selectedRelayValue =
        selectedStationId != null ? stationRelays[selectedStationId - 1] : null;
      const selectedSlot = selectedStationId != null ? slots[selectedStationId - 1] : null;
      const selectedChargingDistanceReached = isChargingArrivalDistance(selectedSlot);
      let charging = stationChangedByUltrasonic
        ? {
            ...state.charging,
            active: false,
            mode: 'paused',
            arrivalConfirmed: false,
            coilAligned: false,
            relayRequested: false,
            sessionStartedAt: null,
            sessionStartSoc: null,
            energyWh: 0,
          }
        : state.charging;
      let vehicleStatus = state.vehicleStatus;
      let screen = state.screen;
      let eventLog = state.eventLog;
      let routeSteps = state.routeSteps;
      let navProgress = state.navProgress;
      const chargingArrivalLost =
        (charging.relayRequested || charging.active || charging.coilAligned) &&
        !selectedChargingDistanceReached;
      if (chargingArrivalLost) {
        stationRelays = stationRelays.map((relay, index) =>
          index === selectedStationId - 1 ? 0 : relay
        );
        charging = {
          ...charging,
          active: false,
          mode: 'paused',
          arrivalConfirmed: false,
          coilAligned: false,
          relayRequested: false,
          sessionStartedAt: null,
          sessionStartSoc: null,
        };
        vehicleStatus = reservationStatus === 'confirmed' ? 'moving' : 'idle';
        routeSteps = { ...routeSteps, followingTrack: true, arrived: false };
        navProgress = 0;
        eventLog = pushLog(
          eventLog,
          `Station ${selectedStationId} ultrasonic distance left the charging range — charging relay OFF.`
        );
      }
      const shouldRequestRelay =
        reservationStatus === 'confirmed' &&
        selectedStationId != null &&
        selectedChargingDistanceReached &&
        !charging.relayRequested &&
        !charging.active &&
        !charging.coilAligned &&
        charging.mode !== 'complete';

      if (shouldRequestRelay) {
        const relayAlreadyOn = selectedRelayValue === 1;
        charging = {
          ...charging,
          arrivalConfirmed: true,
          coilAligned: true,
          relayRequested: true,
          active: relayAlreadyOn,
          mode: relayAlreadyOn ? 'fast' : 'paused',
          sessionStartedAt: relayAlreadyOn ? now : null,
          sessionStartSoc: relayAlreadyOn ? state.soc : null,
          energyWh: 0,
        };
        vehicleStatus = relayAlreadyOn ? 'charging' : 'arrived';
        screen = 'charging';
        routeSteps = { ...state.routeSteps, followingTrack: false, arrived: true };
        navProgress = 100;
        eventLog = pushLog(
          eventLog,
          relayAlreadyOn
            ? `Station ${selectedStationId} detected the robot at ${selectedSlot} cm — relay is ON and charging started.`
            : `Station ${selectedStationId} detected the robot at ${selectedSlot} cm — vehicle stopped and relay ON was requested.`
        );
      }

      const relayConfirmed =
        charging.relayRequested &&
        !charging.active &&
        charging.mode !== 'complete' &&
        selectedRelayValue === 1;
      const relayDropped =
        !chargingArrivalLost && charging.active && selectedRelayValue === 0;

      if (relayConfirmed) {
        charging = {
          ...charging,
          active: true,
          mode: 'fast',
          sessionStartedAt: now,
          sessionStartSoc: state.soc,
        };
        vehicleStatus = 'charging';
        screen = 'charging';
        eventLog = pushLog(
          eventLog,
          `Station ${selectedStationId} relay confirmed ON — charging calculation started.`
        );
      } else if (relayDropped) {
        charging = {
          ...charging,
          active: false,
          // Keep the request latched and let EvContext reassert RelayN. The
          // operator's Stop action and the 100% completion path explicitly
          // clear relayRequested when the relay really should turn OFF.
          relayRequested: true,
          mode: 'paused',
          sessionStartedAt: null,
          sessionStartSoc: null,
        };
        vehicleStatus = 'arrived';
        eventLog = pushLog(
          eventLog,
          `Station ${selectedStationId} relay feedback dropped — charging paused and relay ON is being retried.`
        );
      }

      return {
        ...state,
        ...(shouldRequestRelay ? withCommand(state, 'S') : {}),
        stationCurrents,
        stationVoltages,
        stationSwitches,
        stationRelays,
        slots,
        stationHistory,
        stationDataLoaded: true,
        selectedStationId,
        reservationStatus,
        temperature,
        temperatureFanActive,
        thermalSimulationActive,
        fanRelay: temperatureFanActive ? 1 : shouldRequestRelay ? 0 : state.fanRelay,
        movementFanCycleActive: false,
        movementFanCycleSecond: 0,
        charging,
        vehicleStatus,
        screen,
        routeSteps,
        navProgress,
        eventLog,
      };
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
      const elapsedSeconds = action.elapsedSeconds ?? 1;
      if (!steps || steps.length === 0) return { ...state, playback: null, ...withCommand(state, 'S') };

      // Still inside the current step — just count it down.
      if (remaining > elapsedSeconds) {
        const playback = {
          ...state.playback,
          remaining: Math.round((remaining - elapsedSeconds) * 10) / 10,
        };
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
        fanRelay: state.temperatureFanActive || state.manualFanOn ? 1 : 0,
        movementFanCycleActive: false,
        movementFanCycleSecond: 0,
        executePath: 0,
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

    case 'RESERVE_STATION': {
      const station = computeStations(state).find((s) => s.id === action.id);
      if (!station || station.status !== 'available') return state;
      const tripStartSoc = round1(clamp(state.soc ?? TRIP_START_SOC_MAX, TRIP_START_SOC_MIN, TRIP_START_SOC_MAX));
      return {
        ...state,
        soc: tripStartSoc,
        batterySimulation: { active: true },
        selectedStationId: action.id,
        reservationStatus: 'confirmed',
        reservationRestoredFromFirebase: false,
        executePath: 1,
        pathName: action.pathName,
        routeSteps: { reservationConfirmed: true, followingTrack: true, arrived: false },
        vehicleStatus: 'moving',
        pumpRelay: 0,
        fanRelay: 0,
        manualFanOn: false,
        temperatureFanActive: false,
        movementFanCycleActive: false,
        movementFanCycleSecond: 0,
        driveMode: 'auto',
        navProgress: 0,
        navStopped: false,
        screen: 'stations',
        playback: null,
        eventLog: pushLog(
          state.eventLog,
          `Reservation confirmed for Station ${station.id} — controller path ${action.pathName} started.`
        ),
      };
    }

    case 'RETRY_STATION_PATH':
      if (
        state.reservationStatus !== 'confirmed' ||
        state.selectedStationId !== action.id
      ) {
        return state;
      }
      return {
        ...state,
        pathName: action.pathName ?? action.id,
        reservationRestoredFromFirebase: false,
        vehicleStatus: 'moving',
        navProgress: 0,
        navStopped: false,
        routeSteps: { reservationConfirmed: true, followingTrack: true, arrived: false },
        eventLog: pushLog(
          state.eventLog,
          `Controller path ${action.pathName ?? action.id} was sent again for Station ${action.id}.`
        ),
      };

    case 'CANCEL_STATION_RESERVATION':
      return {
        ...state,
        ...withCommand(state, 'S'),
        selectedStationId: null,
        reservationStatus: 'none',
        reservationRestoredFromFirebase: false,
        pathName: 0,
        vehicleStatus: 'idle',
        navProgress: 0,
        navStopped: true,
        routeSteps: { reservationConfirmed: false, followingTrack: false, arrived: false },
        stationRelays: [0, 0, 0, 0],
        charging: {
          ...state.charging,
          active: false,
          mode: 'paused',
          arrivalConfirmed: false,
          coilAligned: false,
          relayRequested: false,
          sessionStartedAt: null,
          sessionStartSoc: null,
        },
        eventLog: pushLog(state.eventLog, 'Station reservation cancelled and controller path cleared.'),
      };

    case 'CONFIRM_RESERVATION': {
      const station = computeStations(state).find((s) => s.id === state.selectedStationId);
      // A selected station is marked "reserved" while its reservation is
      // pending, so it remains valid to confirm as long as its bay is open.
      if (!station || station.filledSlots >= station.totalSlots) return state;
      // The vehicle only drives saved auto routes, so confirming a reservation
      // requires one — and confirming is what starts it playing.
      const route = state.routes.find((r) => r.id === state.selectedRouteId);
      if (!route || route.steps.length === 0) return state;
      const tripStartSoc = round1(clamp(state.soc ?? TRIP_START_SOC_MAX, TRIP_START_SOC_MIN, TRIP_START_SOC_MAX));
      return {
        ...state,
        soc: tripStartSoc,
        batterySimulation: { active: true },
        reservationStatus: 'confirmed',
        routeSteps: { reservationConfirmed: true, followingTrack: true, arrived: false },
        vehicleStatus: 'moving',
        pumpRelay: 0,
        fanRelay: 0,
        manualFanOn: false,
        temperatureFanActive: false,
        movementFanCycleActive: false,
        movementFanCycleSecond: 0,
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
      const selectedSlot =
        state.selectedStationId != null ? state.slots[state.selectedStationId - 1] : null;
      if (!state.charging.relayRequested && !isChargingArrivalDistance(selectedSlot)) return state;
      const relayOn =
        state.selectedStationId != null && state.stationRelays[state.selectedStationId - 1] === 1;
      return {
        ...state,
        vehicleStatus: relayOn ? 'charging' : 'arrived',
        screen: 'charging',
        charging: {
          ...state.charging,
          coilAligned: true,
          relayRequested: true,
          active: relayOn,
          mode: relayOn ? 'fast' : 'paused',
          sessionStartedAt: relayOn ? Date.now() : null,
          sessionStartSoc: relayOn ? state.soc : null,
          energyWh: 0,
        },
        eventLog: pushLog(
          state.eventLog,
          relayOn
            ? `Station ${state.selectedStationId} relay is ON — wireless charging started.`
            : `Station ${state.selectedStationId} relay ON requested — waiting for confirmation.`
        ),
      };
    }

    case 'SET_MANUAL_FAN': {
      const manualFanOn = action.on === true;
      const temperatureFanActive = state.temperatureFanActive === true;
      const chargingCoolingOn = isChargingCoolingActive(state.charging, state.clock.getTime());
      const fanRelay = manualFanOn || temperatureFanActive || chargingCoolingOn ? 1 : 0;
      return {
        ...state,
        manualFanOn,
        fanRelay,
        thermalSimulationActive:
          manualFanOn || temperatureFanActive || state.heatPercent > 0,
        eventLog: pushLog(state.eventLog, `Manual cooling fan turned ${manualFanOn ? 'ON' : 'OFF'}.`),
      };
    }

    case 'SET_HEAT_LEVEL': {
      const heatPercent = clamp(Math.round(Number(action.percent) || 0), 0, 100);
      return {
        ...state,
        temperature: state.temperature ?? AMBIENT_TEMP_C,
        heatPercent,
        thermalSimulationActive:
          heatPercent > 0 || state.temperatureFanActive || state.manualFanOn,
      };
    }

    case 'SET_CHARGING_MODE': {
      if (action.mode === 'fast' && !state.charging.coilAligned) return state;
      if (action.mode === 'complete') return state;
      const selectedSlot =
        state.selectedStationId != null ? state.slots[state.selectedStationId - 1] : null;
      if (
        action.mode !== 'paused' &&
        !state.charging.relayRequested &&
        !state.charging.active &&
        !isChargingArrivalDistance(selectedSlot)
      ) {
        return state;
      }
      const relayOn =
        state.selectedStationId != null && state.stationRelays[state.selectedStationId - 1] === 1;
      const wantsCharging = action.mode !== 'paused';
      const active = wantsCharging && relayOn;
      return {
        ...state,
        charging: {
          ...state.charging,
          relayRequested: wantsCharging,
          mode: active ? action.mode : 'paused',
          active,
          sessionStartedAt: active ? (state.charging.sessionStartedAt ?? Date.now()) : null,
          sessionStartSoc: active ? (state.charging.sessionStartSoc ?? state.soc) : null,
        },
      };
    }

    case 'TOGGLE_CHARGING_ACTIVE': {
      if (state.charging.mode === 'complete') return state;
      if (!state.charging.arrivalConfirmed) return state;
      const stopping = state.charging.active || state.charging.relayRequested;
      const selectedSlot =
        state.selectedStationId != null ? state.slots[state.selectedStationId - 1] : null;
      if (!stopping && !isChargingArrivalDistance(selectedSlot)) return state;
      const relayOn =
        state.selectedStationId != null && state.stationRelays[state.selectedStationId - 1] === 1;
      const active = !stopping && relayOn;
      return {
        ...state,
        charging: {
          ...state.charging,
          relayRequested: !stopping,
          active,
          mode: active ? 'fast' : 'paused',
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
  let next = reducerInner(state, action);
  if (next === state) return state;

  // A reservation restored after a browser refresh does not pass through the
  // normal RESERVE_STATION action, so its battery simulation flag starts OFF.
  // As soon as the station relay confirms charging, enable SOC and temperature
  // progression for every entry path. Seed 36 C only once; later cooling ticks
  // must be allowed to reduce it.
  const chargingJustStarted = next.charging.active && !state.charging.active;
  if (
    next.charging.active &&
    (!next.batterySimulation.active ||
      !next.thermalSimulationActive ||
      !Number.isFinite(next.temperature) ||
      chargingJustStarted)
  ) {
    const chargingSoc = Number.isFinite(next.soc) ? clamp(next.soc, 0, 100) : 0;
    const chargingTemperature = chargingJustStarted && Number.isFinite(next.temperature)
      ? Math.max(next.temperature, CHARGING_ACTIVE_TEMP_C)
      : Number.isFinite(next.temperature)
        ? next.temperature
        : CHARGING_ACTIVE_TEMP_C;
    next = {
      ...next,
      soc: chargingSoc,
      temperature: chargingTemperature,
      batterySimulation: { active: true },
      thermalSimulationActive: true,
      charging: {
        ...next.charging,
        sessionStartSoc: next.charging.sessionStartSoc ?? chargingSoc,
      },
    };
  }

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
