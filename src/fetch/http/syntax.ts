/**
 * RFC 9110 §5.6.7 — parse an HTTP-date as UTC epoch milliseconds.
 * Accepts the three HTTP formats, case-insensitively as RFC 9111 §4.2
 * recommends for caches. `now` supplies the reference for two-digit years.
 */
export function parseHTTPDate(input: string, now: number): number | null {
  const value = input.replace(/^[ \t]+|[ \t]+$/g, '');
  let match: string[] | null = /^([a-z]{3}), ([0-9]{2}) ([a-z]{3}) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/i.exec(value);
  let obsolete = false;
  if (!match) {
    match = /^([a-z]+), ([0-9]{2})-([a-z]{3})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/i.exec(value);
    obsolete = match !== null;
  }
  if (!match) {
    const asctime = /^([a-z]{3}) ([a-z]{3}) ([ 0-9][0-9]) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/i.exec(value);
    if (!asctime || asctime[0] !== value) return null;
    match = [asctime[0], asctime[1]!, asctime[3]!, asctime[2]!,
      asctime[7]!, asctime[4]!, asctime[5]!, asctime[6]!];
  }
  if (match[0] !== value) return null;

  const weekday = (obsolete ? longWeekdays : shortWeekdays).indexOf(match[1]!.toLowerCase());
  const day = Number(match[2]);
  const month = months.indexOf(match[3]!.toLowerCase());
  let year = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);
  if (weekday === -1 || month === -1 || hour > 23 || minute > 59 || second > 60) {
    return null;
  }

  const limit = new Date(now);
  if (obsolete) {
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    year += Math.floor(limit.getUTCFullYear() / 100) * 100;
  }
  // Date's setters preserve years 0000–0099, unlike Date.UTC's 1900 offset.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  // ECMAScript cannot represent a leap second. Round down for cache expiry
  // rather than extending freshness (RFC 9111 §4.2).
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  if (obsolete && date.getTime() > limit.getTime()) {
    year -= 100;
    date.setUTCFullYear(year, month, day);
  }
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month ||
    date.getUTCDate() !== day || date.getUTCDay() !== weekday) return null;
  return date.getTime();
}

const shortWeekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const longWeekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
