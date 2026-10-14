import {
  CHARGING_COOLING_DELAY_MS,
  getChargingPower,
  isChargingCoolingActive,
  THERMAL_LIMITS,
  useEvDispatch,
  useEvState,
} from '../state/store.js';
import { InfoNote, PageHeader, ProgressBar } from '../components/ui.jsx';
import { IconCar, IconCheck, IconTarget } from '../components/icons.jsx';
import Scene3D from '../components/Scene3D.jsx';

const MODE_LABEL = {
  fast: 'Fast charging',
  normal: 'Normal charging',
  paused: 'Charging paused',
  complete: 'Fully charged',
};

const MODES = ['fast', 'normal', 'paused', 'complete'];

export default function Charging() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const { charging } = state;
  const tempSafe = state.temperature == null || state.temperature < THERMAL_LIMITS.WARN_TEMP;
  const coolingActive = state.pumpRelay === 1 || state.fanRelay === 1;
  const chargePct = state.soc ?? 0;
  const chargingPower = getChargingPower(state);
  const livePower = chargingPower.watts;
  const displayedVoltage = chargingPower.voltage ?? state.voltage;
  const displayedCurrent = chargingPower.current ?? state.current;
  const powerLabel =
    chargingPower.source === 'predicted'
      ? 'Predicted charging power'
      : chargingPower.source === 'station'
        ? 'Live station power'
        : 'Live BMS power';
  const energyLabel =
    chargingPower.source === 'predicted' ? 'Energy delivered (estimated)' : 'Energy delivered';
  const sessionSeconds =
    charging.active && charging.sessionStartedAt != null
      ? Math.max(0, Math.floor((state.clock.getTime() - charging.sessionStartedAt) / 1000))
      : 0;
  const chargingCoolingActive = isChargingCoolingActive(charging, state.clock.getTime());
  const coolingDelaySeconds = Math.max(
    0,
    Math.ceil(CHARGING_COOLING_DELAY_MS / 1000 - sessionSeconds)
  );
  const energyDeliveredWh = Number.isFinite(charging.energyWh) ? charging.energyWh : 0;
  const vehicleFull = charging.mode === 'complete' || (state.soc != null && state.soc >= 100);
  const selectedRelayValue =
    state.selectedStationId != null ? state.stationRelays[state.selectedStationId - 1] : null;
  const relayOn = selectedRelayValue === 1;
  const waitingForRelay = charging.relayRequested && !relayOn;

  return (
    <div className="screen">
      <PageHeader title="Screen 4 — Wireless Charging" />

      {vehicleFull && (
        <InfoNote title="Vehicle Full — 100% Charged">
          Charging stopped automatically. The vehicle battery is full and ready to use.
        </InfoNote>
      )}

      <Scene3D
        title="Live Wireless Charging Animation"
        hint="The docked vehicle and charging-energy animation update from the live session state."
        mode="charge"
      />

      <div className="charge-layout">
        <div className="charge-main">
          <div className="charge-summary">
            <span>
              Station <strong>{state.selectedStationId ?? '—'}</strong>
            </span>
            <span className={charging.arrivalConfirmed ? 'text-ok' : 'muted'}>
              <IconCheck className={charging.arrivalConfirmed ? 'kv-icon ok' : 'kv-icon muted'} /> Arrival{' '}
              {charging.arrivalConfirmed ? 'Confirmed' : 'Pending'}
            </span>
            <span className={charging.coilAligned ? 'text-ok' : 'muted'}>
              <IconTarget className={charging.coilAligned ? 'kv-icon ok' : 'kv-icon muted'} /> Coil Alignment{' '}
              {charging.coilAligned ? 'Confirmed' : 'Pending'}
            </span>
            <span className={relayOn ? 'text-ok' : waitingForRelay ? 'text-warn' : 'muted'}>
              <IconCheck className={relayOn ? 'kv-icon ok' : waitingForRelay ? 'kv-icon warn' : 'kv-icon muted'} />
              Station Relay {relayOn ? 'ON' : waitingForRelay ? 'TURNING ON…' : 'OFF'}
            </span>
            {coolingActive && (
              <span className="text-warn">
                <IconCheck className="kv-icon warn" /> Cooling Active (pump {state.pumpRelay ? 'ON' : 'OFF'} · fan {state.fanRelay ? 'ON' : 'OFF'})
              </span>
            )}
            {charging.active && !chargingCoolingActive && !coolingActive && (
              <span className="muted">Pump and fan start in {coolingDelaySeconds}s</span>
            )}
          </div>

          <div className="card charge-status-card">
            <h3 className="card-title">Charging Status</h3>
            <p className={`charge-status-text ${charging.mode}`}>
              {vehicleFull ? 'Vehicle Full' : waitingForRelay ? 'Waiting for station relay' : MODE_LABEL[charging.mode]}
            </p>

            <div className="charge-metrics">
              <div>
                <span className="muted">SOC</span>
                <strong className="charge-metric-value">{state.soc != null ? `${Math.round(state.soc)}%` : '—'}</strong>
              </div>
              <div>
                <span className="muted">State of Discharge</span>
                <strong className="charge-metric-value">{state.soc != null ? `${Math.round(100 - state.soc)}%` : '—'}</strong>
              </div>
              <div>
                <span className="muted">Temperature</span>
                <strong className="charge-metric-value">{state.temperature != null ? `${state.temperature.toFixed(1)} °C` : '—'}</strong>
              </div>
            </div>

            <ProgressBar value={state.soc ?? 0} tone="accent" />
            <div className="progress-scale">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
            <div className="charge-session-stats">
              <SessionStat label="Session time" value={formatDuration(sessionSeconds)} />
              <SessionStat label={powerLabel} value={`${livePower.toFixed(1)} W`} />
              <SessionStat label={energyLabel} value={`${energyDeliveredWh.toFixed(3)} Wh`} />
              <SessionStat label="BMS SOC" value={state.soc != null ? `${Math.round(state.soc)}% live` : 'Waiting'} />
              <SessionStat label="Charging voltage" value={displayedVoltage != null ? `${displayedVoltage.toFixed(2)} V` : '—'} />
              <SessionStat label="Charging current" value={displayedCurrent != null ? `${displayedCurrent.toFixed(2)} A` : '—'} />
            </div>
          </div>

          <div className="charge-grid-2">
            <div className="card">
              <h3 className="card-title">Safety Checks</h3>
              <div className="safety-checks">
                <SafetyCheck ok label="Battery connected" />
                <SafetyCheck ok={tempSafe} label="Temperature safe" />
                <SafetyCheck ok={charging.arrivalConfirmed} label="Station confirmed" />
                <SafetyCheck ok={relayOn} label="Station relay ON" />
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Modes</h3>
              <div className="mode-tabs">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`mode-tab ${charging.mode === m ? 'active' : ''}`}
                    disabled={m === 'complete' || (m === 'fast' && !charging.coilAligned)}
                    onClick={() => dispatch({ type: 'SET_CHARGING_MODE', mode: m })}
                  >
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              <p className="muted small">
                Charging starts in Fast mode, then switches to Normal after 5 seconds when pump and fan cooling starts.
              </p>
            </div>
          </div>
        </div>

        <div className="charge-side">
          <div className="charge-visual">
            <IconCar width="90" height="90" />
            <div className="charge-visual-status">
              <strong>
                {vehicleFull
                  ? 'Vehicle Full'
                  : waitingForRelay
                    ? 'Vehicle reached — turning relay ON'
                    : charging.active
                      ? 'Relay ON — charging in progress'
                      : 'Charging on standby'}
              </strong>
              <span>{state.soc != null ? `${Math.round(state.soc)}% battery level` : 'Waiting for BMS SOC data'}</span>
            </div>
            <div className="charge-pad" aria-label={`Battery charge progress: ${Math.round(chargePct)}%`}>
              <div className={`charge-pad-fill ${charging.active ? 'active' : ''}`} style={{ width: `${chargePct}%` }} />
            </div>
            <div className="charge-visual-readout">
              <span>{powerLabel}</span>
              <strong>{`${livePower.toFixed(1)} W`}</strong>
              <span>
                {charging.active
                  ? `${formatDuration(sessionSeconds)} active`
                  : waitingForRelay
                    ? 'Waiting for relay confirmation'
                    : 'Session not active'}
              </span>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Start Charging</h3>
            <button
              type="button"
              className="btn btn-disabled btn-block"
              disabled={charging.active || charging.relayRequested || vehicleFull || !charging.arrivalConfirmed}
              onClick={() => dispatch({ type: 'TOGGLE_CHARGING_ACTIVE' })}
            >
              ▶ Start Charging
            </button>

            <h3 className="card-title spaced">Stop Charging</h3>
            <button
              type="button"
              className="btn btn-accent btn-block"
              disabled={!charging.active && !charging.relayRequested}
              onClick={() => dispatch({ type: 'TOGGLE_CHARGING_ACTIVE' })}
            >
              ■ Stop Charging
            </button>
            <p className="muted small center">
              {vehicleFull
                ? 'Battery fully charged'
                : charging.active
                  ? 'Relay confirmed — charging calculation active'
                  : waitingForRelay
                    ? 'Waiting for Relay confirmation from Firebase'
                    : 'Session idle'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionStat({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function SafetyCheck({ ok, label }) {
  return (
    <div className="safety-check">
      <IconCheck className={ok ? 'kv-icon ok' : 'kv-icon muted'} />
      {label}
    </div>
  );
}
