import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DIRECTION_LABEL, routeTotalSeconds, useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, InfoNote } from '../components/ui.jsx';
import { IconBolt, IconCar, IconCheck, IconList, IconStop, IconTarget } from '../components/icons.jsx';
import { deleteRoute, saveRoute } from '../state/bms.js';
import { bearingDeg, compassLabel, distanceKm } from '../utils/geo.js';
import Scene3D from '../components/Scene3D.jsx';

const STEP_DIRECTIONS = ['F', 'B', 'L', 'R', 'S'];

const MIN_STEP_SECONDS = 1;
const MAX_STEP_SECONDS = 600;
const clockNow = () => Date.now();

const emptyDraft = () => ({ id: null, name: '', steps: [] });

export default function Navigation() {
  const state = useEvState();
  const dispatch = useEvDispatch();

  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);

  const { routes, routesLoaded, playback } = state;
  const manual = state.driveMode === 'manual';

  const sendDirection = useCallback(
    (direction, speed, log) => dispatch({ type: 'SEND_DIRECTION', direction, speed, log }),
    [dispatch]
  );

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
              {!manual && ` · ${state.speed}% speed`}
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
          <ManualPad direction={state.direction} onCommand={(d) => sendDirection(d, undefined, 'Manual command')} />
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
            onCommand={sendDirection}
          />
        )}

        <InfoNote>
          Every direction is written to <code>BMS_5578/direction</code>. Auto mode also writes joystick distance
          to <code>BMS_5578/Speed</code> from 0 to 100 and replays each step's saved direction, speed, and duration.
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
          {!manual && (
            <div className="kv-row">
              <span>Motor speed</span>
              <strong>{state.speed}%</strong>
            </div>
          )}
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
      <p className="muted small">Drag and hold the knob to drive. Releasing it returns to the center and stops the vehicle.</p>

      <CircularJoystick
        activeDirection={direction === 'S' ? null : direction}
        onDirectionChange={(nextDirection) => onCommand(nextDirection)}
        onRelease={() => onCommand('S')}
        label="Manual vehicle joystick"
      />

      <div className="joystick-readout">
        <span className="muted">Currently sending</span>
        <strong>
          {DIRECTION_LABEL[direction]} ({direction})
        </strong>
      </div>
    </div>
  );
}

function CircularJoystick({ activeDirection, activeSpeed, onDirectionChange, onRelease, disabled = false, label }) {
  const baseRef = useRef(null);
  const draggingRef = useRef(false);
  const directionRef = useRef(null);
  const speedRef = useRef(0);
  const [knobPosition, setKnobPosition] = useState({ x: 0, y: 0 });

  function setDirectionFromPoint(clientX, clientY) {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = clientX - (rect.left + rect.width / 2);
    const y = clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(x, y);
    const maxTravel = Math.min(rect.width, rect.height) * 0.3;
    const scale = distance > maxTravel ? maxTravel / distance : 1;
    setKnobPosition({ x: x * scale, y: y * scale });

    const deadZone = Math.min(rect.width, rect.height) * 0.1;
    const nextDirection =
      distance < deadZone ? null : Math.abs(x) > Math.abs(y) ? (x > 0 ? 'R' : 'L') : y > 0 ? 'B' : 'F';
    const nextSpeed = nextDirection
      ? Math.min(100, Math.max(0, Math.round(((distance - deadZone) / (maxTravel - deadZone)) * 10) * 10))
      : 0;

    if (nextDirection === directionRef.current && nextSpeed === speedRef.current) return;
    const wasMoving = directionRef.current != null;
    directionRef.current = nextDirection;
    speedRef.current = nextSpeed;
    if (nextDirection) onDirectionChange(nextDirection, nextSpeed);
    else if (wasMoving) onRelease();
  }

  function releaseJoystick() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setKnobPosition({ x: 0, y: 0 });
    if (directionRef.current) onRelease();
    directionRef.current = null;
    speedRef.current = 0;
  }

  function keyboardDirection(direction) {
    if (disabled || directionRef.current === direction) return;
    directionRef.current = direction;
    speedRef.current = 100;
    const offset = 68;
    const positions = {
      F: { x: 0, y: -offset },
      B: { x: 0, y: offset },
      L: { x: -offset, y: 0 },
      R: { x: offset, y: 0 },
    };
    setKnobPosition(positions[direction]);
    onDirectionChange(direction, 100);
  }

  return (
    <div
      ref={baseRef}
      className={`circular-joystick ${disabled ? 'disabled' : ''}`}
      role="application"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDirectionFromPoint(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        event.preventDefault();
        setDirectionFromPoint(event.clientX, event.clientY);
      }}
      onPointerUp={releaseJoystick}
      onPointerCancel={releaseJoystick}
      onKeyDown={(event) => {
        const keys = { ArrowUp: 'F', ArrowDown: 'B', ArrowLeft: 'L', ArrowRight: 'R' };
        const nextDirection = keys[event.key];
        if (!nextDirection || event.repeat) return;
        event.preventDefault();
        keyboardDirection(nextDirection);
      }}
      onKeyUp={(event) => {
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault();
        directionRef.current = null;
        speedRef.current = 0;
        setKnobPosition({ x: 0, y: 0 });
        onRelease();
      }}
    >
      <span className="joystick-axis axis-forward">F</span>
      <span className="joystick-axis axis-left">L</span>
      <span className="joystick-axis axis-right">R</span>
      <span className="joystick-axis axis-backward">B</span>
      <div className="joystick-ring" />
      <div
        className={`joystick-knob ${activeDirection ? 'active' : ''}`}
        style={{ transform: `translate(${knobPosition.x}px, ${knobPosition.y}px)` }}
      >
        <span>{activeDirection ? `${activeDirection}${activeSpeed == null ? '' : ` ${activeSpeed}%`}` : 'S'}</span>
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
  onCommand,
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
              {DIRECTION_LABEL[activeStep.direction]} ({activeStep.direction}) at {activeStep.speed ?? 50}%
            </strong>
            <span className="route-countdown">{playback.remaining}s left</span>
          </div>
          <ol className="route-step-track">
            {playback.steps.map((step, i) => (
              <li
                key={`${step.direction}-${i}`}
                className={i < playback.stepIndex ? 'done' : i === playback.stepIndex ? 'current' : ''}
              >
                {step.direction} · {step.speed ?? 50}% · {step.seconds}s
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
                          {step.direction} {step.speed ?? 50}% · {step.seconds}s
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
          onCommand={onCommand}
        />
      )}
    </div>
  );
}

function RouteEditor({ draft, setDraft, onSave, onCancel, onTest, onStop, playback, onCommand }) {
  const total = draft.steps.reduce((sum, s) => sum + s.seconds, 0);
  const testing = playback?.kind === 'test';
  const busy = !!playback;
  const draftName = draft.name.trim() || 'unsaved route';
  const [recording, setRecording] = useState(null);
  const recordingRef = useRef(null);
  const timerRef = useRef(null);

  function appendRecordedStep(active, endedAt = clockNow()) {
    const elapsedMs = Math.max(1, endedAt - active.startedAt);
    const weightedSpeedMs = active.weightedSpeedMs + active.speed * Math.max(0, endedAt - active.sampleAt);
    const speed = Math.max(0, Math.min(100, Math.round(weightedSpeedMs / elapsedMs / 10) * 10));
    const seconds = Math.min(
      MAX_STEP_SECONDS,
      Math.max(MIN_STEP_SECONDS, Math.ceil(elapsedMs / 1000))
    );
    setDraft((current) => ({
      ...current,
      steps: [...current.steps, { direction: active.direction, speed, seconds }],
    }));
  }

  function finishRecording(saveStep = true) {
    const active = recordingRef.current;
    if (!active) return;

    recordingRef.current = null;
    clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(null);
    onCommand('S', 0);

    if (saveStep) appendRecordedStep(active);
  }

  function startRecording(direction, speed) {
    if (busy) return;
    const now = clockNow();

    if (recordingRef.current) {
      const current = recordingRef.current;
      if (current.direction === direction) {
        if (current.speed === speed) return;
        const next = {
          ...current,
          speed,
          weightedSpeedMs: current.weightedSpeedMs + current.speed * Math.max(0, now - current.sampleAt),
          sampleAt: now,
          elapsedMs: now - current.startedAt,
        };
        recordingRef.current = next;
        setRecording(next);
        onCommand(direction, speed);
        return;
      }

      appendRecordedStep(current, now);
      const next = { direction, speed, startedAt: now, sampleAt: now, weightedSpeedMs: 0, elapsedMs: 0 };
      recordingRef.current = next;
      setRecording(next);
      onCommand(direction, speed, 'Route recording');
      return;
    }

    const active = { direction, speed, startedAt: now, sampleAt: now, weightedSpeedMs: 0, elapsedMs: 0 };
    recordingRef.current = active;
    setRecording(active);
    onCommand(direction, speed, 'Route recording');

    timerRef.current = setInterval(() => {
      const current = recordingRef.current;
      if (!current) return;
      const elapsedMs = clockNow() - current.startedAt;
      if (elapsedMs >= MAX_STEP_SECONDS * 1000) {
        finishRecording(true);
        return;
      }
      setRecording({ ...current, elapsedMs });
    }, 100);
  }

  function stopNow() {
    if (recordingRef.current) finishRecording(true);
    else onCommand('S', 0, 'Route recorder stop');
  }

  useEffect(
    () => () => {
      if (!recordingRef.current) return;
      clearInterval(timerRef.current);
      recordingRef.current = null;
      onCommand('S', 0);
    },
    [onCommand]
  );

  const editorBusy = busy || !!recording;

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

      <div className="route-recorder">
        <div className="route-recorder-copy">
          <strong>Record with joystick</strong>
          <span className="muted small">
            Drag the knob: angle controls direction and distance from the center controls speed from 0 to 100.
            Release to stop and record the movement.
          </span>
        </div>

        <CircularJoystick
          activeDirection={recording?.direction ?? null}
          activeSpeed={recording?.speed ?? 0}
          onDirectionChange={startRecording}
          onRelease={() => finishRecording(true)}
          disabled={busy}
          label="Route recording joystick"
        />

        <div className={`route-recording-readout ${recording ? 'active' : ''}`} aria-live="polite">
          <span>{recording ? `Moving ${DIRECTION_LABEL[recording.direction].toLowerCase()}` : 'Ready to record'}</span>
          <strong>{recording ? `${recording.speed}% · ${(recording.elapsedMs / 1000).toFixed(1)}s` : '0% · 0.0s'}</strong>
        </div>
        <button type="button" className="btn btn-danger route-recorder-stop" disabled={busy} onClick={stopNow}>
          <IconStop /> Stop
        </button>
      </div>

      <div className="route-step-editor">
        {draft.steps.length === 0 && <p className="muted small route-empty-steps">No movements recorded yet.</p>}
        {draft.steps.map((step, i) => (
          <div key={i} className="route-step-row">
            <span className="route-step-index">{i + 1}</span>
            <select
              disabled={editorBusy}
              value={step.direction}
              onChange={(e) =>
                updateStep(i, { direction: e.target.value, ...(e.target.value === 'S' ? { speed: 0 } : {}) })
              }
            >
              {STEP_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABEL[d]} ({d})
                </option>
              ))}
            </select>
            <div className="route-step-seconds">
              <input
                type="number"
                min="0"
                max="100"
                step="10"
                value={step.speed ?? (step.direction === 'S' ? 0 : 50)}
                disabled={editorBusy || step.direction === 'S'}
                aria-label={`Speed for step ${i + 1}`}
                onChange={(e) =>
                  updateStep(i, {
                    speed: Math.min(100, Math.max(0, Math.round((Number(e.target.value) || 0) / 10) * 10)),
                  })
                }
              />
              <span className="muted small">%</span>
            </div>
            <div className="route-step-seconds">
              <input
                type="number"
                min={MIN_STEP_SECONDS}
                max={MAX_STEP_SECONDS}
                value={step.seconds}
                disabled={editorBusy}
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
              disabled={editorBusy}
              title={`Send ${DIRECTION_LABEL[step.direction]} (${step.direction}) at ${step.speed ?? 50}% for ${step.seconds}s now`}
              onClick={() => onTest([step], `step ${i + 1} (${step.direction} ${step.speed ?? 50}% ${step.seconds}s)`)}
            >
              ▶ Test
            </button>
            <div className="route-step-buttons">
              <button type="button" className="icon-btn" disabled={editorBusy || i === 0} onClick={() => moveStep(i, -1)} aria-label="Move step up">
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={editorBusy || i === draft.steps.length - 1}
                onClick={() => moveStep(i, 1)}
                aria-label="Move step down"
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn danger"
                disabled={editorBusy}
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
          disabled={editorBusy}
          onClick={() => setDraft({ ...draft, steps: [...draft.steps, { direction: 'F', speed: 50, seconds: 5 }] })}
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
          <button type="button" className="btn btn-outline" disabled={editorBusy || total === 0} onClick={() => onTest(draft.steps, draftName)}>
            ▶ Test all steps ({total}s)
          </button>
        )}
      </div>

      <div className="route-editor-actions">
        <button type="button" className="btn btn-accent" disabled={editorBusy} onClick={onSave}>
          <IconCheck /> {draft.id ? 'Update route' : 'Save route'}
        </button>
        <button type="button" className="btn btn-outline" disabled={!!recording} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function StepIcon({ done }) {
  return done ? <IconCheck className="kv-icon ok" /> : <span className="step-circle" />;
}
