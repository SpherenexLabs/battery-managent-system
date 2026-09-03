import { getChargingPower, useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, InfoNote, ProgressBar } from '../components/ui.jsx';
import { IconCar, IconCheck, IconTarget } from '../components/icons.jsx';
import { THERMAL_LIMITS } from '../state/store.js';
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
  const overheatWarn = state.temperature != null && state.temperature >= THERMAL_LIMITS.WARN_TEMP;
  const criticalPaused = state.temperature != null && state.temperature >= THERMAL_LIMITS.CRITICAL_TEMP;
  const coolingActive = state.pumpRelay === 1 || state.fanRelay === 1;
  const chargePct = state.soc ?? 0;
  const chargingPower = getChargingPower(state);
  const livePower = chargingPower.watts;
  const sessionSeconds =
    charging.active && charging.sessionStartedAt != null
      ? Math.max(0, Math.floor((state.clock.getTime() - charging.sessionStartedAt) / 1000))
      : 0;
  const energyDeliveredWh = Number.isFinite(charging.energyWh) ? charging.energyWh : 0;

  return (
    <div className="screen">
      <PageHeader title="Screen 4 — Wireless Charging" />

      <Scene3D
        title="Live 3D Charging View"
        hint="Energy rings run from the transmitter pad to the vehicle while the session is active."
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
            {coolingActive && (
              <span className="text-warn">
                <IconCheck className="kv-icon warn" /> Cooling Active (pump {state.pumpRelay ? 'ON' : 'OFF'} · fan {state.fanRelay ? 'ON' : 'OFF'})
              </span>
            )}
          </div>

          <div className="card charge-status-card">
            <h3 className="card-title">Charging Status</h3>
            <p className={`charge-status-text ${charging.mode}`}>{MODE_LABEL[charging.mode]}</p>

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
              <SessionStat label="Live BMS power" value={`${livePower.toFixed(1)} W`} />
              <SessionStat label="Energy delivered" value={`${energyDeliveredWh.toFixed(3)} Wh`} />
              <SessionStat label="BMS SOC" value={state.soc != null ? `${Math.round(state.soc)}% live` : 'Waiting'} />
              <SessionStat label="Vehicle voltage" value={state.voltage != null ? `${state.voltage.toFixed(2)} V` : '—'} />
              <SessionStat
                label="Station voltage"
                value={state.stationVoltage != null ? `${state.stationVoltage.toFixed(2)} V` : '—'}
              />
              <SessionStat label="Current" value={state.current != null ? `${state.current.toFixed(2)} A` : '—'} />
            </div>
          </div>

          {criticalPaused ? (
            <InfoNote tone="warning" title="Charging paused">
              Battery is critically overheated. Charging will resume automatically once the temperature drops back
              to a safe range.
            </InfoNote>
          ) : (
            overheatWarn && (
              <InfoNote tone="warning" title="Fast charging unavailable">
                Battery is overheated. Charging continues in normal mode; fast charging is disabled until the
                temperature drops below {THERMAL_LIMITS.WARN_TEMP}°C.
              </InfoNote>
            )
          )}

          <div className="charge-grid-2">
            <div className="card">
              <h3 className="card-title">Safety Checks</h3>
              <div className="safety-checks">
                <SafetyCheck ok label="Battery connected" />
                <SafetyCheck ok={tempSafe} label="Temperature safe" />
                <SafetyCheck ok={charging.arrivalConfirmed} label="Station confirmed" />
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
                    disabled={
                      m === 'complete' ||
                      criticalPaused ||
                      (m === 'fast' && (!charging.coilAligned || !tempSafe))
                    }
                    onClick={() => dispatch({ type: 'SET_CHARGING_MODE', mode: m })}
                  >
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              <p className="muted small">Fast mode only with compatible charging hardware.</p>
            </div>
          </div>
        </div>

        <div className="charge-side">
          <div className="charge-visual">
            <IconCar width="90" height="90" />
            <div className="charge-visual-status">
              <strong>{charging.active ? 'Charging in progress' : 'Charging on standby'}</strong>
              <span>{state.soc != null ? `${Math.round(state.soc)}% battery level` : 'Waiting for BMS SOC data'}</span>
            </div>
            <div className="charge-pad" aria-label={`Battery charge progress: ${Math.round(chargePct)}%`}>
              <div className={`charge-pad-fill ${charging.active ? 'active' : ''}`} style={{ width: `${chargePct}%` }} />
            </div>
            <div className="charge-visual-readout">
              <span>Live BMS power</span>
              <strong>{`${livePower.toFixed(1)} W`}</strong>
              <span>{charging.active ? `${formatDuration(sessionSeconds)} active` : 'Session not active'}</span>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Start Charging</h3>
            <button
              type="button"
              className="btn btn-disabled btn-block"
              disabled={charging.active || criticalPaused}
              onClick={() => dispatch({ type: 'TOGGLE_CHARGING_ACTIVE' })}
            >
              ▶ Start Charging
            </button>

            <h3 className="card-title spaced">Stop Charging</h3>
            <button
              type="button"
              className="btn btn-accent btn-block"
              disabled={!charging.active}
              onClick={() => dispatch({ type: 'TOGGLE_CHARGING_ACTIVE' })}
            >
              ■ Stop Charging
            </button>
            <p className="muted small center">{charging.active ? 'Session active' : 'Session idle'}</p>
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
