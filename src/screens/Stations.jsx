import { useState } from 'react';
import { routeTotalSeconds, useEvDispatch, useEvState } from '../state/store.js';
import { PageHeader, InfoNote, StatusDot, Card } from '../components/ui.jsx';
import { IconBolt, IconCheck, IconPulse, IconStation, IconTarget } from '../components/icons.jsx';
import { setStationOccupied } from '../state/bms.js';
import { bearingDeg, compassLabel, distanceKm } from '../utils/geo.js';

const STATION_META = {
  available: { label: 'Available', color: 'green' },
  occupied: { label: 'Occupied', color: 'red' },
  reserved: { label: 'Reserved', color: 'blue' },
  charging: { label: 'Charging', color: 'teal' },
};

function stationDirection(vehicleLocation, station) {
  if (vehicleLocation.lat == null || vehicleLocation.lng == null) return null;
  const km = distanceKm(vehicleLocation.lat, vehicleLocation.lng, station.lat, station.lng);
  const compass = compassLabel(bearingDeg(vehicleLocation.lat, vehicleLocation.lng, station.lat, station.lng));
  return { km, compass };
}

export default function Stations() {
  const state = useEvState();
  const dispatch = useEvDispatch();
  const selected = state.stations.find((s) => s.id === state.selectedStationId);
  const reservationLocked = state.reservationStatus === 'confirmed';
  const canReserveNavigate = !reservationLocked;
  const chosenRoute = state.routes.find((r) => r.id === state.selectedRouteId) ?? null;
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);

  function toggleSimulator(station) {
    setStationOccupied(station.id, station.filledSlots === 0);
  }

  function openDirections(station) {
    if (state.vehicleLocation.lat == null || state.vehicleLocation.lng == null) return;
    const origin = `${state.vehicleLocation.lat},${state.vehicleLocation.lng}`;
    const destination = `${station.lat},${station.lng}`;
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`, '_blank', 'noopener,noreferrer');
  }

  function refreshCurrentLocation() {
    if (!navigator.geolocation) {
      dispatch({ type: 'SET_VEHICLE_LOCATION_ERROR', error: 'Geolocation is not supported by this browser.' });
      return;
    }
    setIsFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        dispatch({ type: 'SET_VEHICLE_LOCATION', lat: position.coords.latitude, lng: position.coords.longitude });
        setIsFetchingLocation(false);
      },
      (error) => {
        dispatch({ type: 'SET_VEHICLE_LOCATION_ERROR', error: error.message });
        setIsFetchingLocation(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  return (
    <div className={`screen screen-split stations-screen ${selected ? 'has-station-selection' : 'no-station-selection'}`}>
      <div className="screen-main">
        <PageHeader title="4 Nearby Charging Stations" subtitle="Sorted by live distance from your current vehicle location, with real-time availability and directions." />

        <InfoNote title="Wireless charging station setup">
          Every station monitors its charging bay through the IoT link. Reserve an available station and the vehicle
          will begin automatic navigation to its wireless charging transmitter.
        </InfoNote>

        <div className="station-location-bar">
          <div>
            <span className={state.vehicleLocation.lat != null ? 'text-ok' : 'text-warn'}>
            {state.vehicleLocation.lat != null
                ? `Vehicle current location: ${state.vehicleLocation.lat.toFixed(5)}, ${state.vehicleLocation.lng.toFixed(5)}`
                : 'Waiting for browser GPS location'}
            </span>
            <span className="muted small station-location-help">
              {state.vehicleLocation.lat != null
                ? 'Live browser GPS is used to calculate station distance and directions.'
                : 'Allow location access to calculate nearby-station distance and navigation.'}
            </span>
          </div>
          <button type="button" className="btn btn-outline" disabled={isFetchingLocation} onClick={refreshCurrentLocation}>
            {isFetchingLocation ? 'Fetching location...' : 'Refresh Current Location'}
          </button>
        </div>

        <div className="station-grid">
          {state.stations.map((s) => {
            const meta = STATION_META[s.status];
            const isSelected = s.id === state.selectedStationId;
            const dir = stationDirection(state.vehicleLocation, s);
            return (
              <div key={s.id} className={`station-card ${isSelected ? 'selected' : ''}`}>
                {isSelected && (
                  <span className="station-card-check">
                    <IconCheck />
                  </span>
                )}
                <div className="station-card-head">
                  <strong>{s.name}</strong>
                  <StatusDot color={meta.color} label={meta.label} />
                </div>
                <div className="station-card-art">
                  <IconStation width="48" height="48" />
                </div>
                <p className="muted small">
                  {dir ? `${dir.km.toFixed(2)} km · ${dir.compass}` : 'Waiting for location…'}
                </p>
                <div className="station-slot-summary" aria-label={`${s.name} slot availability`}>
                  <span><strong>{s.availableSlots}</strong> available</span>
                  <span><strong>{s.filledSlots}</strong> filled</span>
                  <span><strong>{s.totalSlots}</strong> total slots</span>
                </div>
                <div className="station-electrical" aria-label={`${s.name} electrical readings`}>
                  <StationReadout icon={<IconPulse />} label="Current" value={s.current != null ? `${s.current.toFixed(2)} A` : '—'} active={s.current != null} />
                  <StationReadout icon={<IconBolt />} label="Voltage" value={s.voltage != null ? `${s.voltage.toFixed(2)} V` : '—'} active={s.voltage != null} />
                  <StationReadout icon={<IconBolt />} label="Power" value={s.power != null ? `${s.power.toFixed(1)} W` : '—'} active={s.power != null} />
                </div>
                <div className="station-live-details">
                  <StationReadout icon={<IconBolt />} label="Transmitter" value={s.status === 'charging' ? 'ACTIVE' : 'STANDBY'} active={s.status === 'charging'} />
                  <StationReadout icon={<IconTarget />} label="Activation" value={isSelected ? 'ARMED' : 'READY'} active={isSelected} />
                  <StationReadout icon={<IconCheck />} label="Engagement" value={engagementLabel(state, s)} active={s.status === 'charging'} />
                  <StationReadout icon={<span className="station-iot-dot" />} label="IoT link" value={state.connectivity.online ? 'LIVE' : 'OFFLINE'} active={state.connectivity.online} />
                </div>
                <div className="station-actions">
                  {s.status === 'available' ? (
                    <button
                      type="button"
                      className={isSelected ? 'btn btn-accent' : 'btn btn-outline'}
                      disabled={!canReserveNavigate}
                      onClick={() => dispatch({ type: 'SELECT_STATION', id: s.id })}
                    >
                      {isSelected ? 'Reserve & Navigate' : 'Reserve'}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-disabled" disabled>
                      {meta.label}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={state.vehicleLocation.lat == null}
                    onClick={() => openDirections(s)}
                  >
                    Directions
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={!state.connectivity.online}
                    onClick={() => toggleSimulator(s)}
                  >
                    {s.filledSlots > 0 ? 'Simulate Free Slot' : 'Simulate Occupied Slot'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <InfoNote title="Reservation confirmed before movement.">
          Please confirm your reservation. The vehicle will navigate automatically to the selected station.
        </InfoNote>

        {state.vehicleLocation.error && (
          <InfoNote tone="warning" title="Location unavailable">
            {state.vehicleLocation.error} Distance and direction to stations require location access.
          </InfoNote>
        )}
      </div>

      <div className="screen-side">
        {selected ? (
          <>
            <h3 className="side-title">Selected: {selected.name}</h3>
            <div className="kv-list">
              <div className="kv-row">
                <span>
                  <IconCheck className="kv-icon ok" /> Status
                </span>
                <strong className="text-ok">{STATION_META[selected.status].label}</strong>
              </div>
              <div className="kv-row">
                <span>Route</span>
                <strong>Predefined Track</strong>
              </div>
              <div className="kv-row">
                <span>Live slots</span>
                <strong>{selected.availableSlots} available / {selected.filledSlots} filled</strong>
              </div>
              <div className="kv-row">
                <span>Engagement</span>
                <strong>{engagementLabel(state, selected)}</strong>
              </div>
              <div className="kv-row">
                <span>Current / Voltage</span>
                <strong>
                  {selected.current != null ? `${selected.current.toFixed(2)} A` : '—'} /{' '}
                  {selected.voltage != null ? `${selected.voltage.toFixed(2)} V` : '—'}
                </strong>
              </div>
              <div className="kv-row">
                <span>Power</span>
                <strong>{selected.power != null ? `${selected.power.toFixed(1)} W` : '—'}</strong>
              </div>
              <div className="kv-row">
                <span>Distance / Direction</span>
                <strong>
                  {(() => {
                    const dir = stationDirection(state.vehicleLocation, selected);
                    return dir ? `${dir.km.toFixed(2)} km · ${dir.compass}` : '—';
                  })()}
                </strong>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-block"
                disabled={state.vehicleLocation.lat == null}
                onClick={() => openDirections(selected)}
              >
                Directions in Maps
              </button>
              <div className="kv-row">
                <span>Reservation</span>
                <strong className={state.reservationStatus === 'confirmed' ? 'text-ok' : 'text-warn'}>
                  {state.reservationStatus === 'confirmed' ? 'Confirmed' : 'Pending'}
                </strong>
              </div>
            </div>

            <h3 className="side-title">Auto route to drive</h3>
            {!state.routesLoaded ? (
              <p className="muted small">Loading saved routes…</p>
            ) : state.routes.length === 0 ? (
              <InfoNote tone="warning" title="No saved routes yet">
                The vehicle only drives directions you have saved. Create a route on the Drive Control screen,
                then come back to reserve.
                <button
                  type="button"
                  className="btn btn-accent btn-block"
                  onClick={() => dispatch({ type: 'GO_TO', screen: 'navigation' })}
                >
                  Create a route →
                </button>
              </InfoNote>
            ) : (
              <div className="route-picker">
                {state.routes.map((route) => (
                  <label
                    key={route.id}
                    className={`route-picker-option ${state.selectedRouteId === route.id ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="reservation-route"
                      checked={state.selectedRouteId === route.id}
                      disabled={reservationLocked}
                      onChange={() => dispatch({ type: 'SELECT_ROUTE', routeId: route.id })}
                    />
                    <span className="route-picker-body">
                      <strong>{route.name}</strong>
                      <span className="muted small">
                        {route.steps.length} step{route.steps.length === 1 ? '' : 's'} · {routeTotalSeconds(route)}s total
                      </span>
                      <span className="route-chip-row">
                        {route.steps.map((step, i) => (
                          <span key={`${route.id}-${i}`} className="route-chip">
                            {step.direction} {step.seconds}s
                          </span>
                        ))}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <InfoNote title="Reservation Confirmed Before Movement">
              A reservation must be confirmed before the vehicle moves. Confirming locks {selected.name} and
              immediately plays the auto route you picked — each direction is sent for its saved duration.
            </InfoNote>

            <ol className="step-list">
              <li className="done">
                <span className="step-num">1</span>
                <div>
                  <strong>Select a station</strong>
                  <p>You selected {selected.name}.</p>
                </div>
              </li>
              <li className={state.selectedRouteId ? 'done' : ''}>
                <span className="step-num">2</span>
                <div>
                  <strong>Choose a saved route</strong>
                  <p>{chosenRoute ? `Driving "${chosenRoute.name}".` : 'Pick which saved directions to drive.'}</p>
                </div>
              </li>
              <li className={state.reservationStatus === 'confirmed' ? 'done' : ''}>
                <span className="step-num">3</span>
                <div>
                  <strong>Confirm &amp; play</strong>
                  <p>Confirming locks the station and starts playing the route straight away.</p>
                </div>
              </li>
            </ol>

            <button
              type="button"
              className="btn btn-accent btn-block"
              disabled={reservationLocked || !chosenRoute}
              onClick={() => dispatch({ type: 'CONFIRM_RESERVATION' })}
            >
              {chosenRoute ? `Confirm & Play "${chosenRoute.name}"` : 'Confirm Reservation'}
            </button>
            {!chosenRoute && state.routes.length > 0 && (
              <p className="muted small center">Choose a saved route above to confirm.</p>
            )}
          </>
        ) : (
          <Card title="No station selected">
            <p className="muted">Choose an available station to view reservation details.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function engagementLabel(state, station) {
  if (state.selectedStationId !== station.id) return 'Not engaged';
  if (state.vehicleStatus === 'charging') return 'Charging engaged';
  if (state.vehicleStatus === 'arrived') return 'Docking engaged';
  if (state.vehicleStatus === 'moving') return 'Vehicle en route';
  return state.reservationStatus === 'pending' ? 'Reservation pending' : 'Reserved';
}

function StationReadout({ icon, label, value, active }) {
  return (
    <div className="station-readout">
      <span className={active ? 'station-readout-icon active' : 'station-readout-icon'}>{icon}</span>
      <span>{label}</span>
      <strong className={active ? 'text-ok' : ''}>{value}</strong>
    </div>
  );
}
