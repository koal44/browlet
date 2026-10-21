import { asciiLower } from '../infra/ascii';
import { TextCursor } from '../infra/text-cursor';

import { collectHTTPQuotedString, isHTTPTabOrSpace } from './syntax';

/** Parse one Link field into ordered targets and their first parameter values, without resolving URLs. */
// https://www.rfc-editor.org/rfc/rfc8288.html#section-3
// Syntax consumption follows Appendix B.2–B.4; consumers interpret relations,
// anchor contexts, and extended parameters for their particular link application.
export function parseLinkHeader(value: string): HTTPLink[] {
  const c = new TextCursor(value);
  const links: HTTPLink[] = [];
  while (!c.eof()) {
    c.consumeWhile(isHTTPTabOrSpace);
    if (c.next() !== '<') break;
    const start = c.pos();
    c.consumeWhile((character) => character !== '>');
    const href = c.slice(start);
    if (c.next() !== '>') break;
    const parameters = new Map<string, string>();
    c.consumeWhile(isHTTPTabOrSpace);
    while (c.peek() === ';') {
      c.advance();
      c.consumeWhile(isHTTPTabOrSpace);
      const nameStart = c.pos();
      c.consumeWhile((character) => !isHTTPTabOrSpace(character) && character !== '=' && character !== ';' && character !== ',');
      const name = asciiLower(c.slice(nameStart));
      c.consumeWhile(isHTTPTabOrSpace);
      let parameter = '';
      if (c.peek() === '=') {
        c.advance();
        c.consumeWhile(isHTTPTabOrSpace);
        if (c.peek() === '"') {
          parameter = collectHTTPQuotedString(c, true);
        } else {
          const valueStart = c.pos();
          c.consumeWhile((character) => character !== ';' && character !== ',');
          parameter = c.slice(valueStart).replace(/[\t ]+$/, '');
        }
      }
      if (!parameters.has(name)) parameters.set(name, parameter);
      c.consumeWhile(isHTTPTabOrSpace);
    }
    links.push({ href, parameters });
    if (c.eof() || c.next() !== ',') break;
  }
  return links;
}

/** A Link field's unresolved target and case-normalized parameter names. */
export type HTTPLink = {
  href: string;
  parameters: Map<string, string>;
};
