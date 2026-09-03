export function formatClock(date) {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}
