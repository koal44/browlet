import { isAsciiWhitespace } from '../../../infra/index';
import { getEncoding, type Encoding } from '../../../encoding/index';

/** Extract an encoding from a meta content value; null means no recognized label. */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#algorithm-for-extracting-a-character-encoding-from-a-meta-element
export function extractMetaEncoding(input: string): Encoding | null {
  const charset = /charset/ig;
  while (charset.test(input)) {
    let position = charset.lastIndex;
    while (isAsciiWhitespace(input.charCodeAt(position))) position++;
    if (input.charCodeAt(position) !== 61) {
      charset.lastIndex = position;
      continue;
    }
    position++;
    while (isAsciiWhitespace(input.charCodeAt(position))) position++;
    const quote = input.charCodeAt(position);
    if (quote === 34 || quote === 39) {
      const end = input.indexOf(input[position]!, position + 1);
      return end === -1 ? null : getEncoding(input.slice(position + 1, end));
    }
    const start = position;
    while (position < input.length && !isAsciiWhitespace(input.charCodeAt(position)) && input.charCodeAt(position) !== 59) {
      position++;
    }
    // Unlike HTTP parameters, single quotes are allowed and backslashes have
    // no escape meaning. An unknown first label also ends the search.
    return getEncoding(input.slice(start, position));
  }
  return null;
}
