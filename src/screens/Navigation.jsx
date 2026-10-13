import { useMemo, useState } from 'react';
import { DIRECTION_LABEL, routeTotalSeconds, useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, InfoNote } from '../components/ui.jsx';
import { IconBolt, IconCar, IconCheck, IconList, IconStop, IconTarget } from '../components/icons.jsx';
import { deleteRoute, saveRoute } from '../state/bms.js';
import { bearingDeg, compassLabel, distanceKm } from '../utils/geo.js';
import Scene3D from '../components/Scene3D.jsx';

// Joystick layout: forward on top, left / stop / right in the middle,
// backward underneath. Each cell sends its own single-letter command.
const PAD_LAYOUT = [
  [null, 'F', null],
  ['L', 'S', 'R'],
  [null, 'B', null],
];

const PAD_GLYPH = { F: '▲', B: '▼', L: '◀', R: '▶', S: '■' };

const STEP_DIRECTIONS = ['F', 'B', 'L', 'R', 'S'];

const MIN_STEP_SECONDS = 1;
const MAX_STEP_SECONDS = 600;

const emptyDraft = () => ({ id: null, name: '', steps: [{ direction: 'F', seconds: 5 }] });

export default function Navigation() {
  const state = useEvState();
  const dispatch = useEvDispatch();

  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);

  const { routes, routesLoaded, playback } = state;
  const manual = state.driveMode === 'manual';

  const sendDirection = (direction, log) => dispatch({ type: 'SEND_DIRECTION', direction, log });

  // Sends steps to the vehicle right now, without saving them, so a timing can
  // be checked against the real hardware before it is committed to a route.
  function testSteps(steps, label) {
    const usable = steps.filter((step) => step.direction && step.seconds > 0);
    if (usable.length === 0) {
      setError('Nothing to test — add a step with a direction and a duration first.');
      return;
    }
    setError(null);
    dispatch({ type: 'TEST_STEPS', steps: usable, label });
  }

  function playRoute(route) {
    if (route.steps.length === 0) {
      setError('This route has no steps yet.');
      return;
    }
    setError(null);
    dispatch({ type: 'PLAY_ROUTE', routeId: route.id });
  }

  function submitDraft() {
    const name = draft.name.trim();
    if (!name) {
      setError('Give the route a name before saving.');
      return;
    }
    if (draft.steps.length === 0) {
      setError('Add at least one step before saving.');
      return;
    }
    const duplicate = routes.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== draft.id);
    if (duplicate) {
      setError(`A route named "${name}" already exists.`);
      return;
    }
    setError(null);
    // A new route gets a fresh id; editing keeps the existing one, so the same
    // write both creates and updates.
    const id = draft.id ?? `route_${Date.now()}`;
    saveRoute({ id, name, steps: draft.steps })
      .then(() => setDraft(null))
      .catch((e) => setError(e.message));
  }

  function removeRoute(route) {
    if (playback?.routeId === route.id) dispatch({ type: 'STOP_PLAYBACK', reason: 'route deleted' });
    if (draft?.id === route.id) setDraft(null);
    deleteRoute(route.id).catch((e) => setError(e.message));
  }

  const activeStep = playback ? playback.steps[playback.stepIndex] : null;

  const targetId = state.selectedStationId;
  const targetStation = targetId ? state.stations.find((s) => s.id === targetId) : null;
  const liveDirection = useMemo(() => {
    if (!targetStation || state.vehicleLocation.lat == null || state.vehicleLocation.lng == null) return null;
    const { lat, lng } = state.vehicleLocation;
    return {
      km: distanceKm(lat, lng, targetStation.lat, targetStation.lng),
      compass: compassLabel(bearingDeg(lat, lng, targetStation.lat, targetStation.lng)),
    };
  }, [targetStation, state.vehicleLocation]);

  const statusLabel =
    state.charging.mode === 'complete'
      ? 'Charging completed'
      : state.vehicleStatus === 'charging'
        ? 'Charging started'
        : state.vehicleStatus === 'arrived'
          ? `Arrived at ${targetStation ? targetStation.name : 'the station'}`
          : playback
            ? playback.kind === 'test'
              ? `Testing ${playback.label}`
              : `Auto route "${playback.label}" running`
            : state.navStopped
              ? 'Stopped on route'
              : state.direction !== 'S'
                ? `Driving ${DIRECTION_LABEL[state.direction].toLowerCase()}`
                : state.reservationStatus === 'pending'
                  ? `${targetStation ? targetStation.name : 'Station'} selected`
                  : 'Vehicle idle';

  return (
    <div className="screen screen-split">
      <div className="screen-main">
        <PageHeader
          title="Vehicle Drive Control"
          subtitle="Manual joystick control, or a saved auto route that replays your own timed directions."
        />

        <div className="nav-stage">
          <div className="nav-stage-icon">
            <IconCar />
          </div>
          <div>
            <span className="muted small">Drive status</span>
            <strong>{statusLabel}</strong>
          </div>
          <div className="nav-stage-destination">
            <IconTarget />
            <span>
              Live command: {DIRECTION_LABEL[state.direction]} ({state.direction})
            </span>
          </div>
        </div>

        <Scene3D
          title="Live 3D View"
          hint="The vehicle responds to the same command the controller receives — drive it and watch it move."
          mode="drive"
        />

        <div className="drive-mode-switch" role="group" aria-label="Drive mode">
          <button
            type="button"
            className={`drive-mode-btn ${manual ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_DRIVE_MODE', mode: 'manual' })}
          >
            Manual
          </button>
          <button
            type="button"
            className={`drive-mode-btn ${!manual ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_DRIVE_MODE', mode: 'auto' })}
          >
            Auto
          </button>
        </div>

        {error && (
          <InfoNote tone="warning" title="Could not complete that action">
            {error}
          </InfoNote>
        )}

        {manual ? (
          <ManualPad direction={state.direction} onCommand={(d) => sendDirection(d, 'Manual command')} />
        ) : (
          <AutoPanel
            routes={routes}
            routesLoaded={routesLoaded}
            draft={draft}
            setDraft={setDraft}
            playback={playback}
            activeStep={activeStep}
            onPlay={playRoute}
            onStop={() => dispatch({ type: 'STOP_PLAYBACK', reason: 'stopped by operator' })}
            onSave={submitDraft}
            onDelete={removeRoute}
            onTest={testSteps}
          />
        )}

        <InfoNote>
          Every command is written straight to <code>bms_5578/direction</code> as a single letter — F forward,
          B backward, L left, R right, S stop. An auto route sends each step's letter and holds it for that
          step's duration before moving on.
        </InfoNote>
      </div>

      <div className="screen-side">
        <h3 className="side-title">Status</h3>
        <p className="nav-status">{statusLabel}</p>

        <h3 className="side-title">Live direction</h3>
        <div className="kv-list">
          <div className="kv-row">
            <span>Motor command</span>
            <strong>
              {DIRECTION_LABEL[state.direction]} ({state.direction})
            </strong>
          </div>
          <div className="kv-row">
            <span>Drive mode</span>
            <strong>{manual ? 'Manual' : 'Auto'}</strong>
          </div>
          <div className="kv-row">
            <span>Distance to {targetStation ? targetStation.name : 'station'}</span>
            <strong>{liveDirection ? `${liveDirection.km.toFixed(2)} km` : '—'}</strong>
          </div>
          <div className="kv-row">
            <span>Compass bearing</span>
            <strong>{liveDirection ? liveDirection.compass : '—'}</strong>
          </div>
        </div>

        <h3 className="side-title">Live readings</h3>
        <div className="kv-list">
          <div className="kv-row">
            <span>Temperature</span>
            <strong>{state.temperature != null ? `${state.temperature.toFixed(1)} °C` : '—'}</strong>
          </div>
          <div className="kv-row">
            <span>Current</span>
            <strong>{state.current != null ? `${state.current.toFixed(2)} A` : '—'}</strong>
          </div>
          <div className="kv-row">
            <span>Vehicle voltage</span>
            <strong>{state.voltage != null ? `${state.voltage.toFixed(2)} V` : '—'}</strong>
          </div>
          <div className="kv-row">
            <span>Station voltage</span>
            <strong>{state.stationVoltage != null ? `${state.stationVoltage.toFixed(2)} V` : '—'}</strong>
          </div>
        </div>

        <h3 className="side-title">Route progress</h3>
        <ul className="route-progress">
          <li className={state.routeSteps.reservationConfirmed ? 'done' : ''}>
            <StepIcon done={state.routeSteps.reservationConfirmed} />
            Reservation confirmed
          </li>
          <li className={state.routeSteps.followingTrack || state.routeSteps.arrived ? 'done' : ''}>
            <StepIcon done={state.routeSteps.followingTrack || state.routeSteps.arrived} />
            Driving saved route
          </li>
          <li className={state.routeSteps.arrived ? 'done' : ''}>
            <StepIcon done={state.routeSteps.arrived} />
            Arrival detected
          </li>
        </ul>

        <h3 className="side-title">Wireless charging</h3>
        {state.charging.arrivalConfirmed && state.vehicleStatus !== 'charging' ? (
          <>
            <p className="text-ok">Ready for confirmation</p>
            <p className="muted small">Vehicle is aligned at the station. Confirm to engage the transmitter coil.</p>
            <button type="button" className="btn btn-accent btn-block" onClick={() => dispatch({ type: 'START_CHARGING_SESSION' })}>
              <IconBolt /> Start Wireless Charging
            </button>
          </>
        ) : (
          <>
            <p className={state.vehicleStatus === 'charging' ? 'text-ok' : 'muted'}>
              {state.vehicleStatus === 'charging' ? 'Charging active' : 'Awaiting arrival'}
            </p>
            <p className="muted small">A charging prompt appears once the auto route finishes.</p>
          </>
        )}

        <button type="button" className="btn btn-danger btn-block" onClick={() => dispatch({ type: 'STOP_VEHICLE' })}>
          <IconStop /> Stop vehicle
        </button>
        <p className="muted small center">Sends S immediately and cancels any running route.</p>
      </div>
    </div>
  );
}

function ManualPad({ direction, onCommand }) {
  return (
    <div className="card joystick-card">
      <h3 className="card-title">Manual Joystick</h3>
      <p className="muted small">Each button sends its letter to the controller and stays latched until you send another.</p>

      <div className="joystick-pad">
        {PAD_LAYOUT.flat().map((cmd, i) =>
          cmd == null ? (
            <span key={`gap-${i}`} className="joystick-gap" />
          ) : (
            <button
              key={cmd}
              type="button"
              className={`joystick-btn cmd-${cmd} ${direction === cmd ? 'active' : ''}`}
              onClick={() => onCommand(cmd)}
              aria-pressed={direction === cmd}
            >
              <span className="joystick-glyph">{PAD_GLYPH[cmd]}</span>
              <span className="joystick-label">{DIRECTION_LABEL[cmd]}</span>
              <span className="joystick-code">{cmd}</span>
            </button>
          )
        )}
      </div>

      <div className="joystick-readout">
        <span className="muted">Currently sending</span>
        <strong>
          {DIRECTION_LABEL[direction]} ({direction})
        </strong>
      </div>
    </div>
  );
}

function AutoPanel({
  routes,
  routesLoaded,
  draft,
  setDraft,
  playback,
  activeStep,
  onPlay,
  onStop,
  onSave,
  onDelete,
  onTest,
}) {
  return (
    <div className="auto-panel">
      {playback && (
        <div className={`card route-playing-card ${playback.kind === 'test' ? 'testing' : ''}`}>
          <div className="route-playing-head">
            <div>
              <span className="muted small">{playback.kind === 'test' ? 'Test run — not saved' : 'Now running'}</span>
              <strong>{playback.label}</strong>
            </div>
            <button type="button" className="btn btn-danger" onClick={onStop}>
              <IconStop /> {playback.kind === 'test' ? 'Stop test' : 'Stop route'}
            </button>
          </div>
          <div className="route-playing-step">
            <span className="route-step-badge">
              Step {playback.stepIndex + 1} / {playback.steps.length}
            </span>
            <strong>
              {DIRECTION_LABEL[activeStep.direction]} ({activeStep.direction})
            </strong>
            <span className="route-countdown">{playback.remaining}s left</span>
          </div>
          <ol className="route-step-track">
            {playback.steps.map((step, i) => (
              <li
                key={`${step.direction}-${i}`}
                className={i < playback.stepIndex ? 'done' : i === playback.stepIndex ? 'current' : ''}
              >
                {step.direction} · {step.seconds}s
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="card">
        <div className="route-list-head">
          <h3 className="card-title">
            <IconList /> Saved Routes
          </h3>
          <button
            type="button"
            className="btn btn-accent"
            disabled={!!playback}
            onClick={() => setDraft(emptyDraft())}
          >
            + New route
          </button>
        </div>

        {!routesLoaded ? (
          <p className="muted small">Loading saved routes…</p>
        ) : routes.length === 0 ? (
          <p className="muted small">
            No routes saved yet. Create one to build a sequence like “forward 5s, left 10s, right 8s, backward 9s”.
          </p>
        ) : (
          <ul className="route-list">
            {routes.map((route) => {
              const isPlaying = playback?.routeId === route.id;
              return (
                <li key={route.id} className={`route-list-item ${isPlaying ? 'playing' : ''}`}>
                  <div className="route-list-info">
                    <strong>{route.name}</strong>
                    <span className="muted small">
                      {route.steps.length} step{route.steps.length === 1 ? '' : 's'} · {routeTotalSeconds(route)}s total
                    </span>
                    <div className="route-chip-row">
                      {route.steps.map((step, i) => (
                        <span key={`${route.id}-${i}`} className="route-chip">
                          {step.direction} {step.seconds}s
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="route-list-actions">
                    <button
                      type="button"
                      className="btn btn-accent"
                      disabled={!!playback}
                      onClick={() => onPlay(route)}
                    >
                      ▶ Play
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={!!playback}
                      onClick={() => setDraft({ id: route.id, name: route.name, steps: route.steps.map((s) => ({ ...s })) })}
                    >
                      Edit
                    </button>
                    <button type="button" className="btn btn-outline" disabled={!!playback} onClick={() => onDelete(route)}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {draft && (
        <RouteEditor
          draft={draft}
          setDraft={setDraft}
          onSave={onSave}
          onCancel={() => setDraft(null)}
          onTest={onTest}
          onStop={onStop}
          playback={playback}
        />
      )}
    </div>
  );
}

function RouteEditor({ draft, setDraft, onSave, onCancel, onTest, onStop, playback }) {
  const total = draft.steps.reduce((sum, s) => sum + s.seconds, 0);
  const testing = playback?.kind === 'test';
  const busy = !!playback;
  const draftName = draft.name.trim() || 'unsaved route';

  const updateStep = (index, patch) =>
    setDraft({ ...draft, steps: draft.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  const moveStep = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setDraft({ ...draft, steps });
  };

  return (
    <div className="card route-editor">
      <h3 className="card-title">{draft.id ? 'Edit route' : 'Create route'}</h3>

      <label className="route-field">
        Route name
        <input
          type="text"
          value={draft.name}
          placeholder="e.g. Bay 1 approach"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>

      <div className="route-step-editor">
        {draft.steps.map((step, i) => (
          <div key={i} className="route-step-row">
            <span className="route-step-index">{i + 1}</span>
            <select value={step.direction} onChange={(e) => updateStep(i, { direction: e.target.value })}>
              {STEP_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABEL[d]} ({d})
                </option>
              ))}
            </select>
            <div className="route-step-seconds">
              <input
                type="number"
                min={MIN_STEP_SECONDS}
                max={MAX_STEP_SECONDS}
                value={step.seconds}
                onChange={(e) =>
                  updateStep(i, {
                    seconds: Math.min(
                      MAX_STEP_SECONDS,
                      Math.max(MIN_STEP_SECONDS, Math.round(Number(e.target.value) || MIN_STEP_SECONDS))
                    ),
                  })
                }
              />
              <span className="muted small">sec</span>
            </div>
            <button
              type="button"
              className="btn btn-outline route-step-test"
              disabled={busy}
              title={`Send ${DIRECTION_LABEL[step.direction]} (${step.direction}) for ${step.seconds}s now`}
              onClick={() => onTest([step], `step ${i + 1} (${step.direction} ${step.seconds}s)`)}
            >
              ▶ Test
            </button>
            <div className="route-step-buttons">
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Move step up">
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={i === draft.steps.length - 1}
                onClick={() => moveStep(i, 1)}
                aria-label="Move step down"
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn danger"
                onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, idx) => idx !== i) })}
                aria-label="Remove step"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="route-editor-actions">
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setDraft({ ...draft, steps: [...draft.steps, { direction: 'F', seconds: 5 }] })}
        >
          + Add step
        </button>
        <span className="muted small">Total run time: {total}s</span>
      </div>

      <div className="route-test-bar">
        <div>
          <strong>Try it before you save</strong>
          <span className="muted small">
            Test sends the real command to the vehicle for the time you set, then stops it. Nothing is saved
            until you press {draft.id ? 'Update route' : 'Save route'}.
          </span>
        </div>
        {testing ? (
          <button type="button" className="btn btn-danger" onClick={onStop}>
            <IconStop /> Stop test
          </button>
        ) : (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => onTest(draft.steps, draftName)}>
            ▶ Test all steps ({total}s)
          </button>
        )}
      </div>

      <div className="route-editor-actions">
        <button type="button" className="btn btn-accent" disabled={busy} onClick={onSave}>
          <IconCheck /> {draft.id ? 'Update route' : 'Save route'}
        </button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function StepIcon({ done }) {
  return done ? <IconCheck className="kv-icon ok" /> : <span className="step-circle" />;
}
