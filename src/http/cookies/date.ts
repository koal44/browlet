/* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.1 */
/** Parses a cookie-date byte string as a Unix timestamp in milliseconds; returns null on failure. */
export function parseCookieDate(input: string): number | null {
  let time: [number, number, number] | undefined;
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  for (const token of input.split(dateDelimiterPattern)) {
    if (time === undefined) {
      const match = timePattern.exec(token);
      if (match) {
        time = [Number(match[1]), Number(match[2]), Number(match[3])];
        continue;
      }
    }
    if (day === undefined) {
      const match = dayPattern.exec(token);
      if (match) {
        day = Number(match[1]);
        continue;
      }
    }
    if (month === undefined) {
      const index = months.indexOf(token.slice(0, 3).toLowerCase());
      if (index !== -1) {
        month = index;
        continue;
      }
    }
    if (year === undefined) {
      const match = yearPattern.exec(token);
      if (match) year = Number(match[1]);
    }
  }

  if (time === undefined || day === undefined || month === undefined || year === undefined) return null;
  if (year >= 70 && year <= 99) year += 1900;
  else if (year <= 69) year += 2000;

  const [hour, minute, second] = time;
  if (day < 1 || day > 31 || year < 1601 || hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.getTime();
}

const dateDelimiterPattern = /[\t\x20-\x2f\x3b-\x40\x5b-\x60\x7b-\x7e]+/;
const timePattern = /^([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2})(?:[^0-9]|$)/;
const dayPattern = /^([0-9]{1,2})(?:[^0-9]|$)/;
const yearPattern = /^([0-9]{2,4})(?:[^0-9]|$)/;
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
