import { useEffect, useMemo, useReducer, useRef } from 'react';
import { EvDispatchContext, EvStateContext, initialState, reducer, SCREEN_IDS } from './store.js';
import {
  setDirection,
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

  // Keep each station's green/red indicators aligned with its physical switch.
  // For the confirmed reservation only, its SlotN ultrasonic reading below
  // 10 cm also changes that station from green to red.
  const stationSwitchSignature = state.stationSwitches.map((value) => value ?? 'x').join(',');
  const stationSlotSignature = state.slots.map((value) => value ?? 'x').join(',');
  const reservedStationId = state.reservationStatus === 'confirmed' ? state.selectedStationId : null;
  useEffect(() => {
    if (stationSwitchSignature === 'x,x,x,x') return;
    const switches = stationSwitchSignature.split(',').map((value) => (value === 'x' ? null : Number(value)));
    const slots = stationSlotSignature.split(',').map((value) => (value === 'x' ? null : Number(value)));
    syncStationIndicators(switches, slots, reservedStationId).catch((error) => {
      console.error('Could not sync station engagement indicators:', error);
    });
  }, [stationSwitchSignature, stationSlotSignature, reservedStationId]);

  // Every drive command the reducer issues — manual joystick, auto-route step,
  // stop — is written to the controller here, so no screen writes it directly.
  useEffect(() => {
    if (state.command == null) return;
    setDirection(state.command.direction);
  }, [state.command]);

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
