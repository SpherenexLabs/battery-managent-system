import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  EvDispatchContext,
  EvStateContext,
  initialState,
  isChargingCoolingActive,
  reducer,
  SCREEN_IDS,
} from './store.js';
import {
  initializeStationPath,
  reserveStationPath,
  setFanRelay,
  setDirection,
  setHeat,
  setPumpRelay,
  setStationChargingRelay,
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
  const startupOutputsReset = useRef(false);
  const refreshPathReplayStarted = useRef(false);

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

  // Do not inherit stale cooling/heater outputs after a browser refresh. New
  // charging or manual thermal actions will explicitly turn them back on.
  useEffect(() => {
    if (!state.connectivity.online || startupOutputsReset.current) return;
    startupOutputsReset.current = true;
    Promise.all([setPumpRelay(false), setFanRelay(false), setHeat(0)]).catch((error) => {
      console.error('Could not reset startup thermal outputs:', error);
    });
  }, [state.connectivity.online]);

  // A Firebase value that survives a browser reload restores the reservation,
  // but writing the same Path_Name again would normally create no new command.
  // Replay it once per page load as 0 -> station number so the controller sees
  // a fresh edge and resumes the selected route.
  useEffect(() => {
    if (
      refreshPathReplayStarted.current ||
      !state.connectivity.online ||
      !state.stationDataLoaded ||
      !state.reservationRestoredFromFirebase ||
      state.reservationStatus !== 'confirmed' ||
      state.selectedStationId == null
    ) {
      return;
    }

    refreshPathReplayStarted.current = true;
    const stationId = state.selectedStationId;
    const selectedSlot = state.slots[stationId - 1];
    const alreadyAtStation =
      typeof selectedSlot === 'number' && selectedSlot > 0 && selectedSlot < 20;

    if (alreadyAtStation || state.charging.active || state.charging.relayRequested) {
      return;
    }

    async function replayPathAfterRefresh() {
      const controllerReady = state.executePathStatus?.trim().toLowerCase() === 'ready';
      if (!controllerReady) await initializeStationPath();
      const pathName = await reserveStationPath(stationId);
      dispatch({ type: 'RETRY_STATION_PATH', id: stationId, pathName });
    }

    replayPathAfterRefresh().catch((error) => {
      console.error(`Could not replay Station ${stationId} path after refresh:`, error);
    });
  }, [
    state.charging.active,
    state.charging.relayRequested,
    state.connectivity.online,
    state.executePathStatus,
    state.reservationRestoredFromFirebase,
    state.reservationStatus,
    state.selectedStationId,
    state.slots,
    state.stationDataLoaded,
  ]);

  // Keep every station's green/red indicators aligned with its physical switch
  // and SlotN ultrasonic reading. A valid reading below 20 cm turns it red.
  const stationSwitchSignature = state.stationSwitches.map((value) => value ?? 'x').join(',');
  const stationSlotSignature = state.slots.map((value) => value ?? 'x').join(',');
  const stationRelaySignature = state.stationRelays.map((value) => value ?? 'x').join(',');
  const reservedStationId = state.reservationStatus === 'confirmed' ? state.selectedStationId : null;
  // Request the station relay first. Charging becomes active only after the
  // /BMS/RelayN feedback confirms that this output is actually ON. The reducer
  // only creates this request while a valid ultrasonic reading is below 20 cm.
  // Moving to 20 cm or farther clears the request and turns every relay OFF.
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

  // Explicitly energise the charging relay selected by the physical ultrasonic
  // arrival. This is intentionally separate from indicator syncing so a stale
  // reservation cannot prevent the detected station relay from switching ON.
  useEffect(() => {
    if (!state.connectivity.online) return;
    setStationChargingRelay(chargingStationId, chargingStationId != null).catch((error) => {
      console.error(
        chargingStationId == null
          ? 'Could not reset station charging relays:'
          : `Could not exclusively turn Station ${chargingStationId} charging relay ON:`,
        error
      );
    });
  }, [chargingStationId, state.connectivity.online]);

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
    setFanRelay(state.fanRelay === 1).catch((error) => {
      console.error('Could not write automatic fan state:', error);
    });
  }, [
    state.charging.active,
    state.connectivity.online,
    state.fanRelay,
    state.manualFanOn,
    state.thermalSimulationActive,
    state.vehicleStatus,
  ]);

  // Vehicle movement keeps both cooling relays OFF. Charging turns both ON
  // after five seconds; manual and temperature-safety cooling turn them on
  // immediately. The pump follows the same automatic request as the fan.
  const chargingCoolingActive = isChargingCoolingActive(
    state.charging,
    state.clock.getTime()
  );
  const automaticCoolingRequested =
    (chargingCoolingActive || state.manualFanOn || state.temperatureFanActive);
  useEffect(() => {
    if (!state.connectivity.online) return;
    if (
      state.vehicleStatus === 'moving' &&
      !state.manualFanOn &&
      !state.temperatureFanActive
    ) {
      setPumpRelay(false).catch((error) => {
        console.error('Could not turn the coolant pump OFF while driving:', error);
      });
    } else if (automaticCoolingRequested && state.pumpRelay !== 1) {
      setPumpRelay(true).catch((error) => {
        console.error('Could not turn the coolant pump ON:', error);
      });
    } else if (!automaticCoolingRequested) {
      setPumpRelay(false).catch((error) => {
        console.error('Could not turn the coolant pump OFF:', error);
      });
    }
  }, [
    automaticCoolingRequested,
    state.connectivity.online,
    state.manualFanOn,
    state.pumpRelay,
    state.temperatureFanActive,
    state.vehicleStatus,
  ]);

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
