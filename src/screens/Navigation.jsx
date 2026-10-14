import { useMemo, useState } from 'react';
import { useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, InfoNote } from '../components/ui.jsx';
import { IconCar, IconCheck, IconStop, IconTarget } from '../components/icons.jsx';
import { cancelStationPath } from '../state/bms.js';
import { bearingDeg, compassLabel, distanceKm } from '../utils/geo.js';
import Scene3D from '../components/Scene3D.jsx';

export default function Navigation() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const [error, setError] = useState('');
  const targetStation = state.selectedStationId
    ? state.stations.find((station) => station.id === state.selectedStationId)
    : null;

  const liveDirection = useMemo(() => {
    if (!targetStation || state.vehicleLocation.lat == null || state.vehicleLocation.lng == null) return null;
    const { lat, lng } = state.vehicleLocation;
    return {
      km: distanceKm(lat, lng, targetStation.lat, targetStation.lng),
      compass: compassLabel(bearingDeg(lat, lng, targetStation.lat, targetStation.lng)),
    };
  }, [targetStation, state.vehicleLocation]);

  const slotDistance = targetStation?.slotValue > 0 ? targetStation.slotValue : null;
  const statusLabel =
    state.charging.mode === 'complete'
      ? 'Vehicle Full'
      : state.vehicleStatus === 'charging'
      ? `Charging at ${targetStation?.name || 'station'}`
      : state.vehicleStatus === 'arrived'
        ? `Arrived at ${targetStation?.name || 'station'}`
        : state.vehicleStatus === 'moving'
          ? `Auto-driving to ${targetStation?.name || 'station'}`
          : state.navStopped
            ? 'Vehicle stopped'
            : 'Vehicle idle';

  async function stopVehicle() {
    setError('');
    try {
      await cancelStationPath();
      dispatch({ type: 'STOP_VEHICLE' });
    } catch (requestError) {
      setError(requestError?.message || 'Could not stop the Firebase path.');
    }
  }

  return (
    <div className="screen screen-split">
      <div className="screen-main">
        <PageHeader
          title="Live Vehicle Tracking"
          subtitle="Read-only route tracking for the vehicle and its reserved charging station."
        />

        <div className="nav-stage">
          <div className="nav-stage-icon"><IconCar /></div>
          <div>
            <span className="muted small">Drive status</span>
            <strong>{statusLabel}</strong>
          </div>
          <div className="nav-stage-destination">
            <IconTarget />
            <span>{targetStation ? `${targetStation.name} · Path_Name ${state.pathName}` : 'No station reserved'}</span>
          </div>
        </div>

        <Scene3D
          title="Live Vehicle-to-Station Animation"
          hint="The selected Slot distance controls vehicle progress; the car finishes on the reserved charging pad."
          mode="drive"
          height={410}
        />

        {error && <InfoNote tone="warning" title="Firebase command failed">{error}</InfoNote>}
      </div>

      <aside className="screen-side">
        <h3 className="side-title">Status</h3>
        <p className="nav-status">{statusLabel}</p>

        <h3 className="side-title">Reserved destination</h3>
        <div className="kv-list">
          <Metric label="Display station" value={targetStation?.name || '—'} />
          <Metric label="Controller Path_Name" value={targetStation ? state.pathName : '—'} />
          <Metric label="Execute_Path" value={state.executePathStatus || state.executePath} />
          <Metric label="Slot distance" value={slotDistance == null ? 'Waiting' : `${slotDistance} cm`} />
          <Metric label="GPS distance" value={liveDirection ? `${liveDirection.km.toFixed(2)} km` : '—'} />
          <Metric label="Compass bearing" value={liveDirection?.compass || '—'} />
        </div>

        <h3 className="side-title">Station electrical feed</h3>
        <div className="kv-list">
          <Metric label="Voltage" value={targetStation?.voltage == null ? '—' : `${targetStation.voltage.toFixed(2)} V`} />
          <Metric label="Current" value={targetStation?.current == null ? '—' : `${targetStation.current.toFixed(2)} A`} />
          <Metric label="Switch" value={targetStation?.switchValue == null ? '—' : targetStation.switchEngaged ? '1 · ENGAGED' : '0 · READY'} />
          <Metric label="Charging relay" value={targetStation?.relayValue == null ? 'WAITING' : targetStation.relayValue ? '1 · ON' : '0 · OFF'} />
        </div>

        <h3 className="side-title">Journey</h3>
        <ul className="route-progress">
          <JourneyStep done={state.routeSteps.reservationConfirmed} label="Reservation sent" />
          <JourneyStep done={state.routeSteps.followingTrack || state.routeSteps.arrived} label="Following controller path" />
          <JourneyStep done={state.routeSteps.arrived} label="Vehicle reached station (ultrasonic distance < 20 cm)" />
          <JourneyStep done={state.charging.relayRequested} label="Station relay ON requested" />
          <JourneyStep done={state.charging.active} label="Relay confirmed — charging calculation active" />
        </ul>

        <button type="button" className="btn btn-danger btn-block" onClick={stopVehicle}>
          <IconStop /> Stop vehicle
        </button>
        <p className="muted small center">Clears Execute_Path and sends the stop command.</p>
      </aside>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="kv-row"><span>{label}</span><strong>{value}</strong></div>;
}

function JourneyStep({ done, label }) {
  return <li className={done ? 'done' : ''}>{done ? <IconCheck className="kv-icon ok" /> : <span className="step-circle" />}{label}</li>;
}
