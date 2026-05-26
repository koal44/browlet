import type { CandidateTest, IdSelector, ClassSelector, TagSelector } from '../parser/parser';
import { asciiLower, cssIdentUnescape } from '../utils/css';

// id
export function emitIdTest(id: IdSelector): CandidateTest {
  const value = cssIdentUnescape(id.raw);
  return { source: `s.checkId(e,${JSON.stringify(value)})` };
}

// class
export function emitClassTest(cls: ClassSelector): CandidateTest {
  const value = cssIdentUnescape(cls.raw);

  if (/[\t\n\f\r ]/.test(value)) {
    return { source: 'false' };
  }

  return { source: `s.checkClass(e,${JSON.stringify(value)})` };
}

// tag
export function emitTagTest(tag: TagSelector): CandidateTest {
  const local = cssIdentUnescape(tag.localRaw);
  let source: string;

  if (local === '*') {
    source = 'true';
  } else {
    const lower = asciiLower(local);
    source = local === lower
      ? `e.localName===${JSON.stringify(local)}`
      : `s.checkTag(e,${JSON.stringify(lower)},${JSON.stringify(local)})`;
  }

  if (tag.prefixRaw === '*') return { source };

  if (tag.prefixRaw === '') {
    return { source: source === 'true' ? '!e.namespaceURI' : `!e.namespaceURI&&${source}` };
  }

  return { source };
}
