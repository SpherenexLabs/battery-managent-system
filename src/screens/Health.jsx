import { computeAlerts, useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, Pill } from '../components/ui.jsx';
import { IconCheck, IconInfo, IconList, IconWarning } from '../components/icons.jsx';
import { formatClock } from '../utils/format.js';

const SEVERITY_TONE = { high: 'danger', medium: 'warn', low: 'neutral' };

export default function Health() {
  const state = useEvState();
  const dispatch = useEvDispatch();

  const alerts = computeAlerts(state);
  const activeCount = alerts.filter((a) => a.status === 'active').length;

  return (
    <div className="screen">
      <PageHeader title="Screen 6 — Battery Health & Alerts" subtitle="Battery condition analysis">
        <span className="badge badge-outline">
          <IconWarning /> Rule-based prototype warnings
        </span>
      </PageHeader>

      <div className="card health-summary-card">
        <div className="health-summary-status">
          <span className="health-summary-icon">
            <IconList />
          </span>
          <div>
            <span className="muted">Status</span>
            <strong className={activeCount > 0 ? 'text-warn' : 'text-ok'}>
              {activeCount > 0 ? 'Inspection recommended' : 'Nominal'}
            </strong>
          </div>
        </div>
        <div className="health-summary-events">
          <span className="muted">Observed events</span>
          <ul>
            {alerts.map((a) => (
              <li key={a.id}>{a.label}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Alert summary</h3>
        <div className="table-scroll">
          <table className="alert-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Severity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  <td>
                    <Pill tone={SEVERITY_TONE[a.severity]}>● {a.severity[0].toUpperCase() + a.severity.slice(1)}</Pill>
                  </td>
                  <td>
                    <span className={a.status === 'active' ? 'text-warn' : 'text-ok'}>
                      {a.status === 'active' ? '⏱ Active' : '✓ Resolved'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="health-grid-2">
        <div className="card">
          <h3 className="card-title accent">Why this warning?</h3>
          <div className="kv-row kv-note">
            <IconWarning className="kv-icon warn" />
            <span>Multiple abnormal events detected.</span>
          </div>
        </div>
        <div className="card">
          <h3 className="card-title accent">What it means</h3>
          <div className="kv-row kv-note">
            <IconInfo className="kv-icon" />
            <span>Early warning, not a confirmed failure diagnosis.</span>
          </div>
        </div>
      </div>

      {state.eventLogOpen && (
        <div className="card">
          <h3 className="card-title">Event log</h3>
          {state.eventLog.length === 0 ? (
            <p className="muted small">No events recorded yet.</p>
          ) : (
            <ul className="event-log">
              {state.eventLog.map((e) => (
                <li key={e.time}>
                  <span className="event-log-time">{formatClock(new Date(e.time))}</span>
                  {e.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="health-actions">
        <button type="button" className="btn btn-outline" onClick={() => dispatch({ type: 'TOGGLE_LOG' })}>
          <IconList /> {state.eventLogOpen ? 'Hide event log' : 'View event log'}
        </button>
        <button
          type="button"
          className="btn btn-accent"
          disabled={state.healthAcknowledged}
          onClick={() => dispatch({ type: 'ACK_HEALTH' })}
        >
          <IconCheck /> {state.healthAcknowledged ? 'Acknowledged' : 'Acknowledge'}
        </button>
      </div>

      <p className="last-update center">Validated failure prediction requires labelled history and model evaluation</p>
    </div>
  );
}
