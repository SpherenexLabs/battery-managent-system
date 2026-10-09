import { useState } from 'react';
import { useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, InfoNote, StatusDot } from '../components/ui.jsx';
import { IconBolt, IconCheck, IconPulse, IconStation, IconTarget } from '../components/icons.jsx';
import { executeStationPath, STATION_PATH_NAME } from '../state/bms.js';
import Scene3D from '../components/Scene3D.jsx';

const STATION_META = {
  available: { label: 'Ready', color: 'green' },
  occupied: { label: 'Occupied', color: 'red' },
  engaged: { label: 'Engaged', color: 'red' },
  reserved: { label: 'Vehicle en route', color: 'blue' },
  charging: { label: 'Charging', color: 'teal' },
};

export default function Stations() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  async function reserveAndGo(station) {
    if (busyId != null || station.status !== 'available') return;
    setBusyId(station.id);
    setError('');
    try {
      const pathName = await executeStationPath(station.id);
      dispatch({ type: 'RESERVE_STATION', id: station.id, pathName });
    } catch (requestError) {
      setError(requestError?.message || 'Firebase did not accept the path command.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="screen stations-screen">
      <PageHeader
        title="4 Live Charging Stations"
        subtitle="Reserve a station once; the controller acknowledges Execute Path before Firebase sends the selected station number."
      />

      {error && (
        <InfoNote tone="warning" title="Reservation command failed">
          {error}
        </InfoNote>
      )}

      <Scene3D
        title="Live Four-Station Map"
        hint="Green means ready. Red means the switch is engaged, or the reserved station is below 10 cm."
        mode="stations"
        height={390}
      />

      <div className="station-grid">
        {state.stations.map((station) => {
          const meta = STATION_META[station.status] || STATION_META.available;
          const isSelected = station.id === state.selectedStationId;
          const isBusy = busyId === station.id;
          const canReserve = station.status === 'available' && state.reservationStatus !== 'confirmed' && busyId == null;
          return (
            <article
              key={station.id}
              className={`station-card ${isSelected ? 'selected' : ''} ${station.indicatorEngaged ? 'station-engaged' : 'station-ready'}`}
            >
              {isSelected && (
                <span className="station-card-check" aria-label="Selected station">
                  <IconCheck />
                </span>
              )}

              <div className="station-card-head">
                <strong>{station.name}</strong>
                <StatusDot color={meta.color} label={meta.label} />
              </div>

              <div className="station-card-art">
                <IconStation width="48" height="48" />
                <span className={`station-switch-lamp ${station.indicatorEngaged ? 'engaged' : 'ready'}`}>
                  {station.ultrasonicEngaged
                    ? 'RED · ULTRA < 10 CM'
                    : station.switchValue == null
                      ? 'Switch —'
                      : station.switchEngaged
                        ? 'RED · ENGAGED'
                        : 'GREEN · READY'}
                </span>
              </div>

              <div className="station-slot-summary" aria-label={`${station.name} slot and path data`}>
                <span><strong>{station.slotValue >= 0 ? `${station.slotValue} cm` : '—'}</strong> vehicle distance</span>
                <span><strong>{station.availableSlots}</strong> available</span>
                <span><strong>{STATION_PATH_NAME[station.id]}</strong> controller path</span>
              </div>

              <div className="station-electrical" aria-label={`${station.name} electrical readings`}>
                <StationReadout icon={<IconPulse />} label="Current" value={formatReading(station.current, 'A')} active={station.current != null} />
                <StationReadout icon={<IconBolt />} label="Voltage" value={formatReading(station.voltage, 'V')} active={station.voltage != null} />
                <StationReadout icon={<IconBolt />} label="Power" value={formatReading(station.power, 'W', 1)} active={station.power != null} />
              </div>

              <StationGraph history={station.history} stationId={station.id} />

              <div className="station-live-details">
                <StationReadout
                  icon={<IconTarget />}
                  label="Physical switch"
                  value={station.switchValue == null ? 'NO DATA' : station.switchEngaged ? '1 · ENGAGED' : '0 · READY'}
                  active={station.switchValue != null}
                  danger={station.switchEngaged}
                />
                <StationReadout
                  icon={<span className="station-iot-dot" />}
                  label="Station feed"
                  value={state.stationDataLoaded && state.connectivity.online ? 'LIVE' : 'WAITING'}
                  active={state.stationDataLoaded && state.connectivity.online}
                />
              </div>

              <div className="station-actions">
                <button
                  type="button"
                  className="btn btn-accent"
                  disabled={!canReserve}
                  onClick={() => reserveAndGo(station)}
                >
                  {isBusy ? 'Waiting for Ready…' : isSelected ? 'Reserved' : 'Reserve & Go'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function formatReading(value, unit, digits = 2) {
  return value == null ? '—' : `${value.toFixed(digits)} ${unit}`;
}

function StationReadout({ icon, label, value, active, danger = false }) {
  return (
    <div className={`station-readout ${danger ? 'danger' : ''}`}>
      <span className={active ? 'station-readout-icon active' : 'station-readout-icon'}>{icon}</span>
      <span>{label}</span>
      <strong className={danger ? 'text-danger' : active ? 'text-ok' : ''}>{value}</strong>
    </div>
  );
}

function StationGraph({ history = [], stationId }) {
  const samples = history.slice(-40);
  const voltage = samples.map((sample) => sample.voltage).filter(Number.isFinite);
  const current = samples.map((sample) => sample.current).filter(Number.isFinite);
  const voltagePoints = chartPoints(samples.map((sample) => sample.voltage));
  const currentPoints = chartPoints(samples.map((sample) => sample.current));

  return (
    <div className="station-chart" aria-label={`Live voltage and current graph for Station ${stationId}`}>
      <div className="station-chart-head">
        <strong>Live electrical graph</strong>
        <span><i className="voltage-line" /> Voltage</span>
        <span><i className="current-line" /> Current</span>
      </div>
      {samples.length === 0 ? (
        <div className="station-chart-empty">Waiting for BMS station readings…</div>
      ) : (
        <svg viewBox="0 0 320 92" role="img" aria-label="Recent station voltage and current samples" preserveAspectRatio="none">
          {[18, 46, 74].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} className="chart-grid-line" />)}
          {voltagePoints && <polyline points={voltagePoints} className="chart-line chart-voltage" />}
          {currentPoints && <polyline points={currentPoints} className="chart-line chart-current" />}
        </svg>
      )}
      <div className="station-chart-range">
        <span>{voltage.length ? `${Math.min(...voltage).toFixed(1)}–${Math.max(...voltage).toFixed(1)} V` : 'Voltage —'}</span>
        <span>{current.length ? `${Math.min(...current).toFixed(1)}–${Math.max(...current).toFixed(1)} A` : 'Current —'}</span>
      </div>
    </div>
  );
}

function chartPoints(values) {
  const numeric = values.filter(Number.isFinite);
  if (numeric.length === 0) return null;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const span = Math.max(max - min, 0.1);
  return values
    .map((value, index) => {
      if (!Number.isFinite(value)) return null;
      const x = values.length === 1 ? 160 : (index / (values.length - 1)) * 320;
      const y = 82 - ((value - min) / span) * 72;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');
}
