import { describe, expect, it } from 'vitest';
import { parseLinkHeader } from '../../src/http/link';

describe('Link field syntax', () => {
  it('preserves target order, quoted delimiters, escapes, and first parameter values', () => {
    const links = parseLinkHeader(String.raw`<a,b.css>; ReL="alternate stylesheet"; title="a,;\"b"; TITLE=ignored, <two.css>; rel=stylesheet; media="screen and (color)"`);
    expect(links.map((link) => ({ href: link.href, parameters: [...link.parameters] }))).toEqual([
      { href: 'a,b.css', parameters: [['rel', 'alternate stylesheet'], ['title', 'a,;"b']] },
      { href: 'two.css', parameters: [['rel', 'stylesheet'], ['media', 'screen and (color)']] },
    ]);
  });

  it('accepts empty targets and valueless parameters without losing subsequent links', () => {
    expect(parseLinkHeader(' <> ; rel = stylesheet ; crossorigin, <b>; rel=next ').map((link) => ({
      href: link.href, parameters: [...link.parameters],
    }))).toEqual([
      { href: '', parameters: [['rel', 'stylesheet'], ['crossorigin', '']] },
      { href: 'b', parameters: [['rel', 'next']] },
    ]);
  });

  it.each(['<valid>; rel=stylesheet, broken', '<valid>; rel=stylesheet, <unfinished'])('retains completed links before malformed input: %s', (input) => {
    expect(parseLinkHeader(input).map((link) => link.href)).toEqual(['valid']);
  });
});
