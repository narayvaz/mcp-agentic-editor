// A source update time is separate from the time its status was fetched.
// Positive epochs below 1e11 are seconds; contemporary millisecond epochs are larger.
// Zero is a common missing-time sentinel in worker status responses.
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const epoch = typeof value === 'number' ? value : Number(value.trim());
    if (!Number.isFinite(epoch) || epoch <= 0) return null;
    const milliseconds = epoch < 100_000_000_000 ? epoch * 1000 : epoch;
    if (!Number.isSafeInteger(Math.trunc(milliseconds)) || milliseconds > 253_402_300_799_999) return null;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, , zone] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const date = new Date(zone ? text : `${text}Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Keep a zone-free source value zone-free; assigning UTC would invent provenance.
  return zone ? date.toISOString() : text;
}
