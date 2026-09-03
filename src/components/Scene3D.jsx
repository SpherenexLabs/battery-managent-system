import { lazy, Suspense } from 'react';

// three.js is a large dependency, so it is only fetched when a screen that
// actually shows the 3D view is opened.
const VehicleScene = lazy(() => import('./VehicleScene.jsx'));

export default function Scene3D({ title, hint, mode = 'drive', height = 340 }) {
  return (
    <div className="card scene3d-card">
      <div className="scene3d-head">
        <h3 className="card-title">{title}</h3>
        <span className="muted small">{hint}</span>
      </div>
      <Suspense fallback={<div className="scene3d-fallback" style={{ height }}>Loading 3D view…</div>}>
        <VehicleScene mode={mode} height={height} />
      </Suspense>
    </div>
  );
}
