import { useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, InfoNote } from '../components/ui.jsx';
import { IconCheck, IconClock, IconShield, IconWarning } from '../components/icons.jsx';
import { THERMAL_LIMITS } from '../state/store.js';
import { setCooling, setFanRelay, setHeat, setPumpRelay } from '../state/bms.js';
import { formatClock } from '../utils/format.js';

export default function Thermal() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const { temperature, pumpRelay, fanRelay, heatPercent, cooling, thermalAcknowledged, connectivity } = state;
  const coolingOn = pumpRelay === 1 || fanRelay === 1;

  const overheated = temperature != null && temperature >= THERMAL_LIMITS.WARN_TEMP;
  const critical = temperature != null && temperature >= THERMAL_LIMITS.CRITICAL_TEMP;
  const manualMode = cooling.mode === 'manual';
  const heaterLocked = overheated;

  return (
    <div className="screen">
      <div className="thermal-topbar">
        <span className="badge badge-neutral">Live BMS data</span>
        <div className="thermal-topbar-right">
          <span className="badge badge-outline">
            <IconShield /> {manualMode ? 'Manual cooling control' : 'Automatic cooling control'}
          </span>
          <span className="badge badge-plain">
            <IconClock /> {formatClock(state.clock)}
          </span>
          <span className={`badge ${connectivity.online ? 'badge-online' : 'badge-danger'}`}>
            ● {connectivity.online ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      <PageHeader
        title="Artificial Battery Heating & Thermal Safety"
        subtitle="Live heating control with temperature feedback, plus automatic coolant pump and fan protection."
        showBadge={false}
      />

      <InfoNote tone={overheated ? 'warning' : undefined} title="Battery thermal status">
        {temperature == null
          ? 'Waiting for live temperature data from the BMS.'
          : overheated
            ? 'Battery is overheated. Please turn on thermal cooling.'
            : `Battery temperature is within the safe range (below ${THERMAL_LIMITS.WARN_TEMP}°C).`}
      </InfoNote>

      <div className="thermal-status-row">
        <div className="card thermal-status-card">
          <span className="muted">Temperature Status</span>
          <strong className={overheated ? 'text-danger' : 'text-ok'}>
            {temperature == null ? '—' : overheated ? (critical ? 'CRITICAL' : 'WARNING') : 'NORMAL'}
          </strong>
          <p className="muted small">{temperature != null ? `${temperature.toFixed(1)} °C` : 'No reading yet.'}</p>
        </div>
        <div className="card thermal-status-card">
          <span className="muted">Coolant Pump (Relay1)</span>
          <strong className={pumpRelay ? 'text-ok' : 'muted'}>{pumpRelay ? 'ON' : 'OFF'}</strong>
          <p className="muted small">{pumpRelay ? 'Coolant flow active.' : 'Coolant flow idle.'}</p>
        </div>
        <div className="card thermal-status-card">
          <span className="muted">Cooling Fan (Relay2)</span>
          <strong className={fanRelay ? 'text-ok' : 'muted'}>{fanRelay ? 'ON' : 'OFF'}</strong>
          <p className="muted small">{fanRelay ? 'Fan extracting heat.' : 'Fan idle.'}</p>
        </div>
        <div className="card thermal-status-card">
          <span className="muted">Charging Status</span>
          <strong className={critical ? 'text-danger' : overheated ? 'text-warn' : 'text-ok'}>
            {critical ? 'PAUSED' : overheated ? 'NORMAL ONLY' : 'ACTIVE'}
          </strong>
          <p className="muted small">
            {critical
              ? 'Charging is paused — critically overheated.'
              : overheated
                ? 'Fast charging disabled above the safety limit.'
                : 'Charging is unaffected.'}
          </p>
        </div>
        <div className="card thermal-status-card">
          <span className="muted">Heater & Driver</span>
          <strong className={heaterLocked ? 'text-danger' : heatPercent > 0 ? 'text-warn' : 'text-ok'}>
            {heaterLocked ? 'SAFETY LOCKED' : heatPercent > 0 ? 'HEATING' : 'STANDBY'}
          </strong>
          <p className="muted small">Heat output: {heatPercent > 0 && !heaterLocked ? 'ACTIVE' : 'OFF'} · {heatPercent}%</p>
        </div>
      </div>

      <div className="thermal-main-grid">
        <div className="thermal-col-main">
          <div className="card">
            <h3 className="card-title">Cooling Control (Liquid Cooling)</h3>

            <div className="heater-row">
              <div className="heater-field">
                <span className="muted">Cooling ON above</span>
                <span className="badge badge-warn">{THERMAL_LIMITS.COOLING_ON_TEMP}°C</span>
              </div>
              <div className="heater-field">
                <span className="muted">Cooling OFF at or below</span>
                <span className="pwm-box">{THERMAL_LIMITS.COOLING_OFF_TEMP}°C</span>
              </div>
              <div className={`safety-lock ${overheated ? 'active' : ''}`}>
                <IconShield />
                <div>
                  <strong>COOLING</strong>
                  <p>{coolingOn ? 'Pump and fan are ON' : 'Pump and fan are OFF'}</p>
                </div>
              </div>
            </div>

            <div className="heater-system-summary">
              <HeaterSystemItem label="Coolant pump (Relay1)" value={pumpRelay ? 'RUNNING' : 'IDLE'} active={!!pumpRelay} />
              <HeaterSystemItem label="Cooling fan (Relay2)" value={fanRelay ? 'RUNNING' : 'IDLE'} active={!!fanRelay} />
              <HeaterSystemItem label="Heater pad / coil" value={heatPercent > 0 ? `ENERGISED ${heatPercent}%` : 'STANDBY'} active={heatPercent > 0} />
              <HeaterSystemItem label="Temperature sensor" value={temperature != null ? `${temperature.toFixed(1)} °C LIVE` : 'WAITING'} active={temperature != null} />
            </div>

            <div className="thermal-test-actions">
              <button
                type="button"
                className={`btn ${!manualMode ? 'btn-accent' : 'btn-outline'}`}
                onClick={() => dispatch({ type: 'SET_COOLING_MODE', mode: 'automatic' })}
              >
                Automatic
              </button>
              <button
                type="button"
                className={`btn ${manualMode ? 'btn-accent' : 'btn-outline'}`}
                onClick={() => dispatch({ type: 'SET_COOLING_MODE', mode: 'manual' })}
              >
                Manual
              </button>
            </div>

            {!manualMode ? (
              <p className="muted small">
                Coolant pump and fan both switch ON automatically once the battery goes above{' '}
                {THERMAL_LIMITS.COOLING_ON_TEMP}°C, and OFF again once it cools back to{' '}
                {THERMAL_LIMITS.COOLING_OFF_TEMP}°C. They also engage whenever the heating level reaches{' '}
                {THERMAL_LIMITS.HEAT_SAFETY_THRESHOLD}%.
              </p>
            ) : (
              <>
                <div className="thermal-test-actions">
                  <button type="button" className="btn btn-accent" disabled={coolingOn} onClick={() => setCooling(true)}>
                    Turn cooling ON
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={!pumpRelay && !fanRelay}
                    onClick={() => setCooling(false)}
                  >
                    Turn cooling OFF
                  </button>
                </div>
                <div className="thermal-test-actions">
                  <button
                    type="button"
                    className={pumpRelay ? 'btn btn-accent' : 'btn btn-outline'}
                    onClick={() => setPumpRelay(!pumpRelay)}
                  >
                    Pump (Relay1): {pumpRelay ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    className={fanRelay ? 'btn btn-accent' : 'btn btn-outline'}
                    onClick={() => setFanRelay(!fanRelay)}
                  >
                    Fan (Relay2): {fanRelay ? 'ON' : 'OFF'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">Artificial Battery Heating (Heat %)</h3>

            <div className="heater-row">
              <div className="heater-field">
                <span className="muted">Heating Level</span>
                <span className="badge badge-warn">{heatPercent}%</span>
              </div>
              <div className="heater-field">
                <span className="muted">Safety Cutoff</span>
                <span className="pwm-box">{THERMAL_LIMITS.WARN_TEMP}°C</span>
              </div>
              <div className={`safety-lock ${heaterLocked ? 'active' : ''}`}>
                <IconShield />
                <div>
                  <strong>HEATER</strong>
                  <p>{heatPercent > 0 ? 'Heater is ON' : 'Heater is OFF'}</p>
                </div>
              </div>
            </div>

            <label className="pwm-slider-label">
              Requested heating level (%)
              <input
                type="range"
                min="0"
                max="100"
                value={heatPercent}
                disabled={heaterLocked}
                onChange={(e) => setHeat(Number(e.target.value))}
              />
            </label>

            <div className="thermal-test-actions">
              <button
                type="button"
                className="btn btn-accent"
                disabled={heaterLocked || heatPercent > 0}
                onClick={() => setHeat(40)}
              >
                Turn heater ON
              </button>
              <button type="button" className="btn btn-outline" disabled={heatPercent === 0} onClick={() => setHeat(0)}>
                Turn heater OFF
              </button>
            </div>

            {heaterLocked && (
              <InfoNote tone="warning">
                Heating locked OFF — battery temperature is at or above the {THERMAL_LIMITS.WARN_TEMP}°C safety limit.
              </InfoNote>
            )}
            <p className="muted small">
              Simulates battery temperature rise for thermal-safety demonstration. Automatically cuts off at the safety
              limit.
            </p>
          </div>
        </div>

        <ThermalDiagram pumpRelay={pumpRelay} fanRelay={fanRelay} heatPercent={heatPercent} temperature={temperature} />
      </div>

      {overheated && (
        <div className="card temp-warning-card">
          <div className="temp-warning-head">
            <IconWarning />
            <div>
              <strong>Battery Overheated</strong>
              <p>Battery is overheated. Please turn on thermal cooling.</p>
            </div>
          </div>
          <div className="temp-warning-actions-block">
            <span className="muted">Take action:</span>
            <ul>
              <li>Switch to Manual mode and turn the pump and fan ON if they have not engaged.</li>
              <li>Verify coolant flow, pump and fan operation.</li>
              <li>Reduce or pause charging until temperature returns to a safe range.</li>
            </ul>
          </div>
          <div className="temp-warning-buttons">
            <button
              type="button"
              className="btn btn-outline"
              disabled={thermalAcknowledged}
              onClick={() => dispatch({ type: 'ACK_THERMAL_ALERT' })}
            >
              <IconCheck /> {thermalAcknowledged ? 'Acknowledged' : 'Acknowledge Alert'}
            </button>
          </div>
        </div>
      )}

      <InfoNote>
        <strong>Note:</strong> Thresholds depend on battery and charger specifications.
      </InfoNote>
    </div>
  );
}

function HeaterSystemItem({ label, value, active }) {
  return (
    <div className="heater-system-item">
      <span>{label}</span>
      <strong className={active ? 'text-ok' : ''}>{value}</strong>
    </div>
  );
}

function ThermalDiagram({ pumpRelay, fanRelay, heatPercent, temperature }) {
  return (
    <div className="card thermal-diagram-card">
      <span className="diagram-label-top">Battery Thermal Loop</span>
      <svg viewBox="0 0 320 260" className="thermal-diagram">
        <rect x="90" y="80" width="120" height="90" rx="8" className="diagram-box" />
        <circle cx="150" cy="35" r="6" className="diagram-sensor" />
        <path d="M150,41 v10" className="diagram-wire" />
        <rect x="115" y="51" width="70" height="16" rx="4" className={`diagram-heater ${heatPercent > 0 ? 'hot' : ''}`} />
        <path d="M150,67 v13" className="diagram-wire" />
        <path d="M210,150 C250,150 250,110 285,110" className={`diagram-pipe out ${pumpRelay ? 'hot' : ''}`} markerEnd="url(#arrowTeal)" />
        <path d="M285,150 C250,150 250,190 210,190" className="diagram-pipe in" markerEnd="url(#arrowBlue)" />
        <circle cx="150" cy="205" r="16" className={`diagram-pump ${pumpRelay ? 'hot' : ''}`} />
        <path d="M150,189 v-19" className="diagram-pipe-link" />
        <defs>
          <marker id="arrowTeal" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
          </marker>
          <marker id="arrowBlue" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--info)" />
          </marker>
        </defs>
        <text x="150" y="22" textAnchor="middle" className="diagram-text">Temperature Sensor</text>
        <text x="150" y="46" textAnchor="middle" className="diagram-text muted-text">
          Heater {heatPercent > 0 ? `${heatPercent}%` : 'OFF'}
        </text>
        <text x="150" y="128" textAnchor="middle" className="diagram-text">Battery Pack</text>
        <text x="150" y="142" textAnchor="middle" className="diagram-text muted-text">
          {temperature != null ? `${temperature.toFixed(1)} °C` : '—'}
        </text>
        <text x="290" y="105" className="diagram-text accent-text">Coolant Out</text>
        <text x="290" y="117" className="diagram-text muted-text">(To radiator)</text>
        <text x="128" y="230" className="diagram-text">Pump + Fan</text>
        <text x="128" y="242" className="diagram-text muted-text">
          Pump {pumpRelay ? 'ON' : 'OFF'} · Fan {fanRelay ? 'ON' : 'OFF'}
        </text>
      </svg>
    </div>
  );
}
