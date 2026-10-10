import { useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader } from '../components/ui.jsx';
import { IconClock, IconShield } from '../components/icons.jsx';
import { THERMAL_LIMITS } from '../state/store.js';
import { setHeat, setPumpRelay } from '../state/bms.js';
import { formatClock } from '../utils/format.js';

export default function Thermal() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const { temperature, pumpRelay, fanRelay, heatPercent, connectivity, manualFanOn } = state;
  const coolingOn = pumpRelay === 1 || manualFanOn;

  const tempHigh = temperature != null && temperature >= THERMAL_LIMITS.WARN_TEMP;
  const critical = temperature != null && temperature >= THERMAL_LIMITS.CRITICAL_TEMP;

  return (
    <div className="screen">
      <div className="thermal-topbar">
        <span className="badge badge-neutral">Live BMS data</span>
        <div className="thermal-topbar-right">
          <span className="badge badge-outline">
            <IconShield /> Automatic + manual control
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
        title="Artificial Battery Heating & Thermal Control"
        subtitle="Use Heat % to raise temperature. After Execute_Path reports Ready, the fan cycles 5 seconds ON and 5 seconds OFF regardless of direction or temperature."
        showBadge={false}
      />

      <div className="thermal-status-row">
        <div className="card thermal-status-card">
          <span className="muted">Temperature Status</span>
          <strong className={tempHigh ? 'text-danger' : 'text-ok'}>
            {temperature == null ? '—' : tempHigh ? (critical ? 'CRITICAL' : 'HIGH') : 'NORMAL'}
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
          <span className="muted">Heater</span>
          <strong className={heatPercent > 0 ? 'text-warn' : 'text-ok'}>{heatPercent > 0 ? 'HEATING' : 'STANDBY'}</strong>
          <p className="muted small">Heat output: {heatPercent}%</p>
        </div>
      </div>

      <div className="thermal-main-grid">
        <div className="thermal-col-main">
          <div className="card">
            <h3 className="card-title">Cooling Control (Liquid Cooling)</h3>

            <div className="heater-system-summary">
              <HeaterSystemItem label="Coolant pump (Relay1)" value={pumpRelay ? 'RUNNING' : 'IDLE'} active={!!pumpRelay} />
              <HeaterSystemItem label="Cooling fan (Relay2)" value={fanRelay ? 'RUNNING' : 'IDLE'} active={!!fanRelay} />
              <HeaterSystemItem label="Heater pad / coil" value={heatPercent > 0 ? `ENERGISED ${heatPercent}%` : 'STANDBY'} active={heatPercent > 0} />
              <HeaterSystemItem label="Temperature sensor" value={temperature != null ? `${temperature.toFixed(1)} °C LIVE` : 'WAITING'} active={temperature != null} />
            </div>

            <div className="thermal-test-actions">
              <button
                type="button"
                className="btn btn-accent"
                disabled={pumpRelay === 1 && manualFanOn}
                onClick={() => {
                  setPumpRelay(true);
                  dispatch({ type: 'SET_MANUAL_FAN', on: true });
                }}
              >
                Turn cooling ON
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!coolingOn}
                onClick={() => {
                  setPumpRelay(false);
                  dispatch({ type: 'SET_MANUAL_FAN', on: false });
                }}
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
                className={manualFanOn ? 'btn btn-accent' : 'btn btn-outline'}
                onClick={() => dispatch({ type: 'SET_MANUAL_FAN', on: !manualFanOn })}
              >
                Manual Fan: {manualFanOn ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Artificial Battery Heating (Heat %)</h3>

            <div className="heater-row">
              <div className="heater-field">
                <span className="muted">Heating Level</span>
                <span className="badge badge-warn">{heatPercent}%</span>
              </div>
              <div className="safety-lock">
                <IconShield />
                <div>
                  <strong>HEATER</strong>
                  <p>{heatPercent > 0 ? 'Heater is ON' : 'Heater is OFF'}</p>
                </div>
              </div>
            </div>

            <label className="pwm-slider-label">
              Requested heating level (%)
              <input type="range" min="0" max="100" value={heatPercent} onChange={(e) => setHeat(Number(e.target.value))} />
            </label>

            <div className="thermal-test-actions">
              <button type="button" className="btn btn-accent" disabled={heatPercent > 0} onClick={() => setHeat(40)}>
                Turn heater ON
              </button>
              <button type="button" className="btn btn-outline" disabled={heatPercent === 0} onClick={() => setHeat(0)}>
                Turn heater OFF
              </button>
            </div>

            <p className="muted small">
              Heat % controls the temperature-rise rate. At 30 °C the heater turns OFF and the fan turns ON;
              temperature then falls by 0.5 °C per second. The fan turns OFF at 27 °C.
            </p>
          </div>
        </div>

        <ThermalDiagram pumpRelay={pumpRelay} fanRelay={fanRelay} heatPercent={heatPercent} temperature={temperature} />
      </div>
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
