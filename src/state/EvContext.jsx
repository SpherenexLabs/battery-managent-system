import { useEffect, useMemo, useReducer, useRef } from 'react';
import { EvDispatchContext, EvStateContext, initialState, reducer, SCREEN_IDS } from './store.js';
import {
  setFanRelay,
  setDirection,
  setHeat,
  setPumpRelay,
  setTemperature,
  subscribeBmsData,
  subscribeConnection,
  subscribeStationData,
  syncStationIndicators,
} from './bms.js';

function getInitialState() {
  const hash = window.location.hash.slice(1);
  return SCREEN_IDS.includes(hash) ? { ...initialState, screen: hash } : initialState;
}

export function EvProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);
  const arrivalTimers = useRef([]);
  const chargingCoolingWasActive = useRef(false);

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    return () => clearInterval(id);
  }, []);

  // Live BMS telemetry from Firebase Realtime Database
  useEffect(() => {
    const unsubData = subscribeBmsData((data) => dispatch({ type: 'BMS_UPDATE', data }));
    const unsubStations = subscribeStationData((data) => dispatch({ type: 'STATION_BMS_UPDATE', data }));
    const unsubConn = subscribeConnection((online) => dispatch({ type: 'BMS_CONNECTION', online }));
    return () => {
      unsubData();
      unsubStations();
      unsubConn();
    };
  }, []);

  // Keep every station's green/red indicators aligned with its physical switch
  // and SlotN ultrasonic reading. A valid reading below 20 cm turns it red.
  const stationSwitchSignature = state.stationSwitches.map((value) => value ?? 'x').join(',');
  const stationSlotSignature = state.slots.map((value) => value ?? 'x').join(',');
  const stationRelaySignature = state.stationRelays.map((value) => value ?? 'x').join(',');
  const reservedStationId = state.reservationStatus === 'confirmed' ? state.selectedStationId : null;
  // Request the station relay first. Charging becomes active only after the
  // /BMS/RelayN feedback confirms that this output is actually ON. The reducer
  // only creates this request after a valid ultrasonic reading below 20 cm; once
  // created, keep it latched despite later sensor fluctuations.
  const chargingStationId =
    state.charging.relayRequested ? state.selectedStationId : null;
  useEffect(() => {
    if (stationSwitchSignature === 'x,x,x,x' && reservedStationId == null) return;
    const switches = stationSwitchSignature.split(',').map((value) => (value === 'x' ? null : Number(value)));
    const slots = stationSlotSignature.split(',').map((value) => (value === 'x' ? null : Number(value)));
    syncStationIndicators(switches, slots, reservedStationId, chargingStationId).catch((error) => {
      console.error('Could not sync station engagement indicators:', error);
    });
  }, [stationSwitchSignature, stationSlotSignature, stationRelaySignature, reservedStationId, chargingStationId]);

  // Recover from Firebase callback ordering where RelayN feedback can reach
  // React just before the reducer's relay-confirmation transition. If charging
  // is still requested, RelayN = 1 must always move the session from
  // Paused/Arrived to active charging.
  const selectedStationRelay =
    state.selectedStationId != null ? state.stationRelays[state.selectedStationId - 1] : null;
  useEffect(() => {
    if (
      !state.charging.relayRequested ||
      state.charging.active ||
      selectedStationRelay !== 1
    ) {
      return;
    }
    dispatch({ type: 'START_CHARGING_SESSION' });
  }, [
    selectedStationRelay,
    state.charging.active,
    state.charging.relayRequested,
  ]);

  // Every drive command the reducer issues — manual joystick, auto-route step,
  // stop — is written to the controller here, so no screen writes it directly.
  useEffect(() => {
    if (state.command == null) return;
    setDirection(state.command.direction);
  }, [state.command]);

  // The reducer owns the journey thermal model so hardware telemetry cannot
  // overwrite it. Mirror each simulated temperature/fan change to Firebase.
  useEffect(() => {
    if (!state.thermalSimulationActive || !state.connectivity.online || state.temperature == null) return;
    setTemperature(state.temperature).catch((error) => {
      console.error('Could not write simulated movement temperature:', error);
    });
  }, [state.connectivity.online, state.temperature, state.thermalSimulationActive]);

  useEffect(() => {
    if (!state.connectivity.online) return;
    if (
      !state.thermalSimulationActive &&
      !state.manualFanOn &&
      !state.movementFanCycleActive &&
      !state.charging.active &&
      state.fanRelay !== 0
    ) return;
    setFanRelay(state.charging.active || state.fanRelay === 1).catch((error) => {
      console.error('Could not write automatic fan state:', error);
    });
  }, [
    state.charging.active,
    state.connectivity.online,
    state.fanRelay,
    state.manualFanOn,
    state.movementFanCycleActive,
    state.thermalSimulationActive,
  ]);

  // Relay-confirmed charging always runs the liquid-cooling pump. Only turn it
  // back OFF when a charging session that was previously active ends.
  useEffect(() => {
    if (!state.connectivity.online) return;
    const wasActive = chargingCoolingWasActive.current;
    if (state.charging.active && state.pumpRelay !== 1) {
      setPumpRelay(true).catch((error) => {
        console.error('Could not turn the charging coolant pump ON:', error);
      });
    } else if (!state.charging.active && wasActive) {
      setPumpRelay(false).catch((error) => {
        console.error('Could not turn the charging coolant pump OFF:', error);
      });
    }
    chargingCoolingWasActive.current = state.charging.active;
  }, [state.charging.active, state.connectivity.online, state.pumpRelay]);

  useEffect(() => {
    if (!state.thermalSimulationActive || !state.connectivity.online) return;
    setHeat(state.heatPercent).catch((error) => {
      console.error('Could not write automatic heater cut-off:', error);
    });
  }, [state.connectivity.online, state.heatPercent, state.thermalSimulationActive]);

  // Vehicle's live position, for distance/direction to charging stations
  useEffect(() => {
    if (!navigator.geolocation) {
      dispatch({ type: 'SET_VEHICLE_LOCATION_ERROR', error: 'Geolocation not supported by this browser.' });
      return undefined;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => dispatch({ type: 'SET_VEHICLE_LOCATION', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => dispatch({ type: 'SET_VEHICLE_LOCATION_ERROR', error: err.message }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (SCREEN_IDS.includes(hash)) dispatch({ type: 'GO_TO', screen: hash });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (window.location.hash.slice(1) !== state.screen) {
      window.history.replaceState(null, '', `#${state.screen}`);
    }
  }, [state.screen]);

  useEffect(() => {
    if (state.vehicleStatus !== 'arrived') return undefined;
    arrivalTimers.current.forEach(clearTimeout);
    // Arrival is detected automatically, but the operator confirms charging
    // before the wireless transmitter is engaged.
    arrivalTimers.current = [setTimeout(() => dispatch({ type: 'CONFIRM_ARRIVAL' }), 900)];
    return () => arrivalTimers.current.forEach(clearTimeout);
  }, [state.vehicleStatus]);

  const value = useMemo(() => state, [state]);

  return (
    <EvStateContext.Provider value={value}>
      <EvDispatchContext.Provider value={dispatch}>{children}</EvDispatchContext.Provider>
    </EvStateContext.Provider>
  );
}
