import { useEffect, useMemo, useReducer, useRef } from 'react';
import { EvDispatchContext, EvStateContext, initialState, reducer, SCREEN_IDS } from './store.js';
import { setDirection, subscribeBmsData, subscribeConnection, subscribeRoutes } from './bms.js';

const PLAYBACK_TICK_MS = 100;

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
    const unsubConn = subscribeConnection((online) => dispatch({ type: 'BMS_CONNECTION', online }));
    return () => {
      unsubData();
      unsubConn();
    };
  }, []);

  // Saved auto-drive routes, mirrored from Firebase so both the Stations
  // screen (choosing one to reserve with) and Drive Control can see them.
  useEffect(() => {
    return subscribeRoutes((routes) => dispatch({ type: 'ROUTES_LOADED', routes }));
  }, []);

  // Every drive command the reducer issues — manual joystick, auto-route step,
  // stop — is written to the controller here, so no screen writes it directly.
  useEffect(() => {
    if (state.command == null) return;
    setDirection(state.command.direction);
  }, [state.command]);

  // Auto-route playback clock. 100 ms ticks support route steps in 0.1-second increments;
  // the interval is rebuilt only when playback starts or stops, not per tick.
  const playbackActive = state.playback != null;
  useEffect(() => {
    if (!playbackActive) return undefined;
    const id = setInterval(
      () => dispatch({ type: 'PLAYBACK_TICK', elapsedSeconds: PLAYBACK_TICK_MS / 1000 }),
      PLAYBACK_TICK_MS
    );
    return () => clearInterval(id);
  }, [playbackActive]);

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
