import { useEvDispatch, useEvState } from '../state/store.js';
import { IconBattery, IconBell, IconBolt, IconHome, IconNav, IconStation, IconThermo } from './icons.jsx';
import { formatClock } from '../utils/format.js';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', Icon: IconHome },
  { id: 'stations', label: 'Stations', Icon: IconStation },
  { id: 'navigation', label: 'Vehicle Tracking', Icon: IconNav },
  { id: 'charging', label: 'Charging', Icon: IconBolt },
  { id: 'thermal', label: 'Thermal Control', Icon: IconThermo },
  { id: 'health', label: 'Health & Alerts', Icon: IconBell },
];

const VEHICLE_LABEL = {
  idle: 'Ready',
  moving: 'Moving',
  arrived: 'Arrived',
  charging: 'Charging',
};

export default function Sidebar() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const hasSoc = state.soc != null;
  const range = hasSoc ? Math.round(state.soc * 3.1) : null;
  const sod = hasSoc ? Math.round(100 - state.soc) : null;
  const vehicleLabel = state.charging.mode === 'complete' ? 'Vehicle Full' : VEHICLE_LABEL[state.vehicleStatus];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span>EV Battery Monitor</span>
        <IconBattery pct={state.soc ?? 0} />
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-link ${state.screen === id ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'GO_TO', screen: id })}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-row">
          <span>Vehicle Status</span>
          <span className="status-dot-wrap">
            <span className="status-dot" style={{ background: 'var(--accent)' }} />
            {vehicleLabel}
          </span>
        </div>
        <div className="sidebar-footer-metric">
          <span className="sidebar-footer-label">Battery (SOC)</span>
          <strong>{hasSoc ? `${Math.round(state.soc)}%` : '—'}</strong>
        </div>
        <div className="mini-progress-track">
          <div className="mini-progress-fill" style={{ width: `${state.soc ?? 0}%` }} />
        </div>
        <div className="sidebar-footer-metric">
          <span className="sidebar-footer-label">Battery Health (SOH)</span>
          <strong>{state.soh != null ? `${state.soh}%` : '—'}</strong>
        </div>
        <div className="sidebar-footer-metric">
          <span className="sidebar-footer-label">Range</span>
          <strong>{range != null ? `${range} km` : '—'}</strong>
        </div>
        <div className="sidebar-footer-metric">
          <span className="sidebar-footer-label">State of Discharge</span>
          <strong>{sod != null ? `${sod}%` : '—'}</strong>
        </div>
      </div>

      <div className="sidebar-footer sidebar-connectivity">
        <div className="sidebar-footer-row">
          <span>IoT Cloud Link</span>
          <span className="status-dot-wrap">
            <span
              className="status-dot"
              style={{ background: state.connectivity.online ? 'var(--ok)' : 'var(--danger)' }}
            />
            {state.connectivity.online ? 'Online' : 'Offline'}
          </span>
        </div>
        <span className="sidebar-footer-label">Synced {formatClock(new Date(state.connectivity.lastSync))}</span>
      </div>
    </aside>
  );
}
