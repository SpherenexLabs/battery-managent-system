import { useEffect, useMemo, useRef, useState } from 'react';
import { computeAlerts, DIRECTION_LABEL, useEvDispatch, useEvState } from '../state/store.js';
import { THERMAL_LIMITS } from '../state/store.js';
import { PageHeader, InfoNote, Sparkline, StatusDot } from '../components/ui.jsx';
import {
  IconBattery,
  IconBolt,
  IconCar,
  IconCheck,
  IconFan,
  IconPulse,
  IconRefresh,
  IconStation,
  IconThermo,
  IconWarning,
} from '../components/icons.jsx';
import { setCooling } from '../state/bms.js';
import { formatClock } from '../utils/format.js';

const STATION_META = {
  available: { label: 'Available', color: 'green' },
  occupied: { label: 'Occupied', color: 'red' },
  reserved: { label: 'Reserved', color: 'blue' },
  charging: { label: 'Charging', color: 'teal' },
};

const VEHICLE_LABEL = { idle: 'Idle', moving: 'Moving', arrived: 'Arrived', charging: 'Charging' };

const THERMAL_ALERT_IDS = new Set([
  'overheat',
  'critical-temp',
  'rapid-temperature-rise',
  'repeated-overheat',
  'frequent-cooling',
  'heater-pwm-high',
]);

const ALERT_TITLES = {
  overheat: 'Battery Temp is High',
  'critical-temp': 'Battery Temp is Critical',
  'rapid-temperature-rise': 'Battery Temp is High',
  'repeated-overheat': 'Battery Temp is High',
  'frequent-cooling': 'Cooling Running Frequently',
  'heater-pwm-high': 'Heating Level Too High',
  'low-battery': 'Low Battery',
  'voltage-drop': 'Voltage Instability',
  'current-swing': 'Current Instability',
  'soc-instability': 'SOC Instability',
  'slow-charge': 'Slow Charging',
  offline: 'BMS Offline',
};

function alertTitle(alert) {
  return ALERT_TITLES[alert.id] || (alert.severity === 'high' ? 'Action Required' : 'Attention Recommended');
}

function healthCondition(soh) {
  if (soh == null) return { text: 'Waiting for data', tone: 'muted' };
  if (soh >= 90) return { text: 'Good Health', tone: 'ok' };
  if (soh >= 75) return { text: 'Fair Health', tone: 'ok' };
  if (soh >= 60) return { text: 'Service Soon', tone: 'warn' };
  return { text: 'Attention Required', tone: 'danger' };
}

function chargeStateLabel(state) {
  if (state.socSignal === 1) return { text: 'Charging', tone: 'ok' };
  if (state.sodSignal === 1) return { text: 'Discharging', tone: 'muted' };
  return { text: 'Idle', tone: 'muted' };
}

export default function Overview() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const lowBattery = state.soc != null && state.soc <= THERMAL_LIMITS.LOW_SOC_THRESHOLD;
  const overheated = state.temperature != null && state.temperature >= THERMAL_LIMITS.WARN_TEMP;
  const activeAlerts = computeAlerts(state).filter((alert) => alert.status === 'active');
  const [popupAlert, setPopupAlert] = useState(null);
  const displayedAlertIds = useRef(new Set());
  const popupTimerRef = useRef(null);

  useEffect(() => {
    const activeIds = new Set(activeAlerts.map((alert) => alert.id));
    displayedAlertIds.current.forEach((id) => {
      if (!activeIds.has(id)) displayedAlertIds.current.delete(id);
    });

    const newAlert = activeAlerts.find((alert) => !displayedAlertIds.current.has(alert.id));
    if (!newAlert) return undefined;

    displayedAlertIds.current.add(newAlert.id);
    setPopupAlert(newAlert);
    if (popupTimerRef.current != null) window.clearTimeout(popupTimerRef.current);
    popupTimerRef.current = window.setTimeout(() => {
      setPopupAlert(null);
      popupTimerRef.current = null;
    }, 6000);
    return undefined;
  }, [activeAlerts]);

  useEffect(() => () => {
    if (popupTimerRef.current != null) window.clearTimeout(popupTimerRef.current);
  }, []);

  const trend = useMemo(() => {
    const samples = state.history.samples;
    return {
      current: samples.map((s) => s.current),
      temperature: samples.map((s) => s.temperature),
      soc: samples.map((s) => s.soc),
      soh: samples.map((s) => s.soh),
      chargeCycles: samples.map((s) => s.chargeCycles),
    };
  }, [state.history.samples]);

  const soh = healthCondition(state.soh);
  const chargeState = chargeStateLabel(state);
  const nearestStations = state.stations.slice(0, 3);

  return (
    <div className="screen">
      {popupAlert && (
        <div className="alert-popup" role="alert" aria-live="assertive">
          <IconWarning />
          <div>
            <strong>Battery Alert</strong>
            <p>{popupAlert.label}</p>
          </div>
        </div>
      )}
      <PageHeader title="EV Battery Monitoring" subtitle="Live battery condition, safety status, and charging readiness" />

      <div className="metric-row">
        <MetricCard
          label="SOC"
          value={state.soc != null ? `${Math.round(state.soc)}%` : '—'}
          sub={chargeState.text}
          subTone={chargeState.tone}
          tone="ok"
          icon={<IconBattery pct={state.soc ?? 0} />}
        />
        <MetricCard
          label="SOH"
          value={state.soh != null ? `${state.soh}%` : '—'}
          sub={soh.text}
          subTone={soh.tone}
          tone="pink"
          icon={<IconPulse />}
        />
        <MetricCard
          label="Charge Cycles"
          value={state.socCount != null ? String(state.socCount) : '—'}
          sub="Total cycles"
          tone="info"
          icon={<IconRefresh />}
        />
        <MetricCard
          label="Vehicle Voltage"
          value={state.voltage != null ? `${state.voltage.toFixed(2)} V` : '—'}
          sub="Voltage1"
          tone="warn"
          icon={<IconBolt />}
        />
        <MetricCard
          label="Station Voltage"
          value={state.stationVoltage != null ? `${state.stationVoltage.toFixed(2)} V` : '—'}
          sub="Voltage2"
          tone="info"
          icon={<IconStation />}
        />
        <MetricCard
          label="Current"
          value={state.current != null ? `${state.current.toFixed(2)} A` : '—'}
          tone="info"
          icon={<IconPulse />}
        />
        <MetricCard
          label="Temperature"
          value={state.temperature != null ? `${state.temperature.toFixed(1)} °C` : '—'}
          tone={overheated ? 'danger' : 'accent'}
          icon={<IconThermo />}
        />
      </div>

      <section className="alerts-panel card" aria-label="Live battery alerts">
        <div className="alerts-panel-header">
          <IconWarning className={activeAlerts.length ? 'text-warn' : 'muted'} />
          <h2>Alerts{activeAlerts.length ? ` (${activeAlerts.length})` : ''}</h2>
        </div>

        {activeAlerts.length === 0 ? (
          <div className="overview-alert nominal">
            <IconCheck />
            <span>No active battery alerts. All monitored conditions are within the configured limits.</span>
          </div>
        ) : (
          <div className="alert-item-list">
            {activeAlerts.map((alert) => {
              const isThermal = THERMAL_ALERT_IDS.has(alert.id);
              const manualMode = state.cooling.mode === 'manual';
              const startedAt = state.alertTimestamps[alert.id];
              return (
                <div key={alert.id} className={`alert-item ${alert.severity}`}>
                  <div className="alert-item-head">
                    <IconWarning />
                    <div>
                      <strong>{alertTitle(alert)}</strong>
                      <p>{alert.label}</p>
                    </div>
                    {startedAt && <span className="alert-item-time">{formatClock(new Date(startedAt))}</span>}
                  </div>

                  {isThermal && (
                    <div className="alert-item-controls">
                      <div className="mode-toggle">
                        <span className="muted small">Mode</span>
                        <label>
                          <input
                            type="radio"
                            checked={!manualMode}
                            onChange={() => dispatch({ type: 'SET_COOLING_MODE', mode: 'automatic' })}
                          />
                          Automatic
                        </label>
                        <label>
                          <input
                            type="radio"
                            checked={manualMode}
                            onChange={() => dispatch({ type: 'SET_COOLING_MODE', mode: 'manual' })}
                          />
                          Manual
                        </label>
                      </div>
                      <div className="alert-item-buttons">
                        <button
                          type="button"
                          className="btn btn-accent"
                          disabled={!manualMode || (!!state.pumpRelay && !!state.fanRelay)}
                          onClick={() => setCooling(true)}
                        >
                          Turn ON Cooling
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          disabled={!manualMode || (!state.pumpRelay && !state.fanRelay)}
                          onClick={() => setCooling(false)}
                        >
                          Turn OFF Cooling
                        </button>
                      </div>
                    </div>
                  )}

                  {alert.id === 'low-battery' && (
                    <div className="alert-item-stations">
                      <span className="muted small">Nearest charging stations</span>
                      <div className="alert-station-list">
                        {nearestStations.map((station) => {
                          const meta = STATION_META[station.status];
                          return (
                            <button
                              key={station.id}
                              type="button"
                              className="alert-station-row"
                              onClick={() => dispatch({ type: 'GO_TO', screen: 'stations' })}
                            >
                              <IconStation />
                              <div className="alert-station-info">
                                <strong>{station.name}</strong>
                                <StatusDot color={meta.color} label={`${station.availableSlots}/${station.totalSlots} slots free`} />
                              </div>
                              <span className="alert-station-distance">
                                {station.distance != null ? `${station.distance.toFixed(1)} km` : '—'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="btn btn-accent btn-block"
                        onClick={() => dispatch({ type: 'GO_TO', screen: 'stations' })}
                      >
                        Find a charging station →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button type="button" className="alerts-panel-link" onClick={() => dispatch({ type: 'GO_TO', screen: 'health' })}>
          View All Alerts →
        </button>
      </section>

      <div className="trend-row">
        <TrendCard
          label="Current (A)"
          value={state.current != null ? state.current.toFixed(1) : '—'}
          color="var(--info)"
          data={trend.current}
        />
        <TrendCard
          label="Temperature (°C)"
          value={state.temperature != null ? state.temperature.toFixed(1) : '—'}
          color="var(--danger)"
          data={trend.temperature}
        />
        <TrendCard label="SOC (%)" value={state.soc != null ? Math.round(state.soc) : '—'} color="var(--ok)" data={trend.soc} />
        <TrendCard label="SOH (%)" value={state.soh ?? '—'} color="var(--pink)" data={trend.soh} />
        <TrendCard label="Charge Cycles" value={state.socCount ?? '—'} color="var(--warn)" data={trend.chargeCycles} />
      </div>

      <div className="status-strip">
        <div className="status-strip-item">
          <IconCar />
          <div>
            <span className="status-strip-label">Vehicle</span>
            <strong>{VEHICLE_LABEL[state.vehicleStatus]}</strong>
          </div>
        </div>
        <div className="status-strip-item">
          <IconThermo />
          <div>
            <span className="status-strip-label">Charge state</span>
            <strong>{state.socSignal === 1 ? 'CHARGING' : state.sodSignal === 1 ? 'DISCHARGING' : 'IDLE'}</strong>
          </div>
        </div>
        <div className="status-strip-item">
          <IconFan />
          <div>
            <span className="status-strip-label">Coolant pump</span>
            <strong>{state.pumpRelay ? 'ON' : 'OFF'}</strong>
          </div>
        </div>
        <div className="status-strip-item">
          <IconFan />
          <div>
            <span className="status-strip-label">Cooling fan</span>
            <strong>{state.fanRelay ? 'ON' : 'OFF'}</strong>
          </div>
        </div>
        <div className="status-strip-item">
          <IconCar />
          <div>
            <span className="status-strip-label">Drive direction</span>
            <strong>{`${DIRECTION_LABEL[state.direction] || state.direction} (${state.direction})`}</strong>
          </div>
        </div>
      </div>

      <div className="vehicle-hero">
        <div className="vehicle-hero-road" />
        <div className="vehicle-hero-car">
          <IconCar width="72" height="72" />
        </div>
      </div>

      {lowBattery && (
        <InfoNote tone="warning" title="Low battery">
          <div className="low-battery-row">
            <span>Battery running low. Please find the nearby charging station to continue your peaceful journey.</span>
            <button type="button" className="btn btn-accent" onClick={() => dispatch({ type: 'GO_TO', screen: 'stations' })}>
              Choose charging station →
            </button>
          </div>
        </InfoNote>
      )}

      {overheated && (
        <InfoNote tone="warning" title="Battery overheated">
          <div className="low-battery-row">
            <span>Battery is overheated. Please turn on thermal cooling.</span>
            <button type="button" className="btn btn-accent" onClick={() => dispatch({ type: 'GO_TO', screen: 'thermal' })}>
              Open thermal control →
            </button>
          </div>
        </InfoNote>
      )}

      <div className="station-strip">
        {state.stations.map((s) => {
          const meta = STATION_META[s.status];
          return (
            <button
              key={s.id}
              type="button"
              className="station-chip"
              onClick={() => dispatch({ type: 'GO_TO', screen: 'stations' })}
            >
              <span className="station-chip-id">S{s.id}</span>
              <span>
                <strong>{s.name}</strong>
                <StatusDot color={meta.color} label={`${s.availableSlots}/${s.totalSlots} slots free`} />
              </span>
            </button>
          );
        })}
      </div>

      <p className="last-update">
        {state.connectivity.online
          ? `Last update: ${state.connectivity.lastSync ? formatClock(new Date(state.connectivity.lastSync)) : 'just now'}`
          : 'BMS offline — showing last known values.'}
      </p>
    </div>
  );
}

function MetricCard({ label, value, sub, subTone, tone = 'accent', icon }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon tone-${tone}`}>{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        {sub && <span className={`metric-sub ${subTone ? `text-${subTone}` : ''}`}>{sub}</span>}
      </div>
    </div>
  );
}

function TrendCard({ label, value, color, data }) {
  return (
    <div className="trend-card">
      <div className="trend-card-head">
        <span>{label}</span>
        <strong style={{ color }}>{value}</strong>
      </div>
      <Sparkline data={data} color={color} />
    </div>
  );
}
