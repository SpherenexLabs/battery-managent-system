const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' };

export function IconHome(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 11.5 12 4l8 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconStation(props) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="5" width="10" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0v-6l-2-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 8.5 7.5 12h3l-2 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconNav(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 4 20l8-4.5L20 20 12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBolt(props) {
  return (
    <svg {...base} {...props}>
      <path d="M13 3 5 13.5h5.5L10 21l8.5-11H13l1-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function IconThermo(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 14.5V5a2 2 0 1 0-4 0v9.5a4 4 0 1 0 4 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="10" cy="17" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function IconBell(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5 1.5 5h-15S6 14 6 10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconInfo(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.6" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function IconWarning(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 3.5 22 20H2L12 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 9.5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.05" fill="currentColor" />
    </svg>
  );
}

export function IconBattery({ pct = 68, ...props }) {
  const w = clampPct(pct);
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none" {...props}>
      <rect x="1" y="1" width="21" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="23" y="4.5" width="2" height="5" rx="1" fill="currentColor" />
      <rect x="3" y="3" width={Math.max(2, 17 * (w / 100))} height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

function clampPct(v) {
  return Math.min(100, Math.max(0, v));
}

export function IconCar(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 15.5 5.5 10a2 2 0 0 1 1.9-1.4h9.2A2 2 0 0 1 18.5 10L20 15.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2.5" y="15.5" width="19" height="4" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="7" cy="19.5" r="1.4" fill="currentColor" />
      <circle cx="17" cy="19.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function IconFan(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <path d="M12 10.5c0-3 1.5-6 4-6.2 2 0 2.6 2 1 3.6-1.1 1.1-2.9 1.9-5 2.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M13.5 12c3 0 6 1.5 6.2 4 0 2-2 2.6-3.6 1-1.1-1.1-1.9-2.9-2.6-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M10.5 12c-3 0-6-1.5-6.2-4 0-2 2-2.6 3.6-1 1.1 1.1 1.9 2.9 2.6 5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function IconClock(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v5.5l3.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShield(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 3.5 20 6.5v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9v-5L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLock(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="5" y="10.5" width="14" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconList(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M8 6.5h11M8 12h11M8 17.5h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4" cy="6.5" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="17.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function IconStop(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IconPulse(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M2.5 12.5h4l2-6 3.5 12 2.5-9 1.5 3h5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconRefresh(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M19.5 12a7.5 7.5 0 0 1-13.2 4.8M4.5 12a7.5 7.5 0 0 1 13.2-4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M18.5 4v4h-4M5.5 20v-4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTarget(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
