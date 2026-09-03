import { IconInfo, IconWarning } from './icons.jsx';

export function PageHeader({ title, subtitle, children, showBadge = true }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="page-header-right">
        {children}
        {showBadge && <span className="badge badge-neutral">Live BMS data</span>}
      </div>
    </div>
  );
}

const DOT_COLOR = {
  green: 'var(--ok)',
  red: 'var(--danger)',
  blue: 'var(--info)',
  teal: 'var(--accent)',
  orange: 'var(--warn)',
  gray: 'var(--muted)',
};

export function StatusDot({ color = 'gray', label }) {
  return (
    <span className="status-dot-wrap">
      <span className="status-dot" style={{ background: DOT_COLOR[color] }} />
      {label}
    </span>
  );
}

export function Card({ title, className = '', children, footer }) {
  return (
    <div className={`card ${className}`}>
      {title && <h3 className="card-title">{title}</h3>}
      {children}
      {footer}
    </div>
  );
}

export function InfoNote({ tone = 'info', title, children }) {
  const Icon = tone === 'warning' ? IconWarning : IconInfo;
  return (
    <div className={`info-note tone-${tone}`}>
      <Icon className="info-note-icon" />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div className="info-note-body">{children}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max = 100, tone = 'accent' }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="progress-track">
      <div className={`progress-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pill({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Sparkline({ data, color = 'var(--accent)', height = 44 }) {
  const values = (data || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (values.length < 2) {
    return <div className="sparkline-empty">Waiting for live data…</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const w = 100;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const norm = range === 0 ? 0.5 : (v - min) / range;
      return `${(i * step).toFixed(2)},${(height - norm * height).toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
