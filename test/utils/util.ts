import type {
  AttributeSelector, CandidateTest, Combinator, ComplexSelector, CompoundSelector,
  RelativeComplexSelector, RelativeCompoundSelector, RelativeSelectorList, SelectorList, TagSelector,
} from '../../src/parser/parser';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function assertNever(x: never): never {
  throw new Error(`Unexpected key: ${String(x)}`);
}

export type Permutations<T, K = T> =
  [T] extends [never] ? [] :
  T extends K ? [T, ...Permutations<Exclude<K, T>>] : never;

export function isElement(x: unknown): x is Element {
  return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 1;
}

export function isDocument(x: unknown): x is Document {
  return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 9;
}

export function isDocumentFragment(x: unknown): x is DocumentFragment {
  return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 11;
}

export function isIFrame(el: Element | null): el is HTMLIFrameElement {
  return !!el && el.localName === 'iframe';
}

export function isTemplate(el: Element | null): el is HTMLTemplateElement {
  return !!el && el.localName === 'template';
}

export function isHtmlDoc(doc: Document): doc is HTMLDocument {
  return doc.contentType.includes('/html') === true;
}

export function isHTMLElement(el: Element | null): el is HTMLElement {
  return !!el && el.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export function cssEscape(ident: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(ident);
  }

  if (ident === '-') return '\\-';

  let out = '';
  const first = ident.charCodeAt(0);

  for (let i = 0, l = ident.length; i < l; i++) {
    const c = ident.charCodeAt(i);
    const digit = c >= 0x30 && c <= 0x39;
    out +=
      c === 0x00 ?                         '\uFFFD' :               // NUL
      c >= 0x01 && c <= 0x1F ?             `\\${c.toString(16)} ` : // control chars
      c === 0x7F ?                         `\\${c.toString(16)} ` : // delete
      digit && i === 0 ?                   `\\${c.toString(16)} ` : // leading digit
      digit && i === 1 && first === 0x2D ? `\\${c.toString(16)} ` : // second char digit after -
      digit ?                              ident.charAt(i) :        // 0-9
      c >= 0x80 ?                          ident.charAt(i) :        // non-ASCII
      c === 0x2D || c === 0x5F ?           ident.charAt(i) :        // - or _
      c >= 0x41 && c <= 0x5A ?             ident.charAt(i) :        // A-Z
      c >= 0x61 && c <= 0x7A ?             ident.charAt(i) :        // a-z
      `\\${ident.charAt(i)}`;  // ASCII punctuation / syntax
  }
  return out;
}

export function describeList(list: SelectorList): string {
  return list.arms.map(describeComplex).join(', ');
}

export function describeComplex(complex: ComplexSelector): string {
  let out = '';

  for (let i = 0; i < complex.parts.length; i++) {
    const part = complex.parts[i];

    if (i > 0) {
      out += part.combinator === ' ' ? ' ' : ` ${part.combinator} `;
    }

    out += describeCompound(part.compound);
  }

  return out;
}

export function describeCompound(c: CompoundSelector): string {
  let out = '';

  if (c.tag) {
    out += describeTag(c.tag);
  }

  if (c.id) {
    out += `#${c.id.raw}${c.id.seed ? '{seed}' : ''}`;
  }

  if (c.classes) {
    for (let i = 0; i < c.classes.length; i++) {
      const cls = c.classes[i];
      out += `.${cls.raw}${cls.seed ? '{seed}' : ''}`;
    }
  }

  for (let i = 0; i < c.tests.length; i++) {
    out += describeCandidateTest(c.tests[i]);
  }

  return out || '*';
}

function describeRelativeList(list: RelativeSelectorList): string {
  return list.arms.map(describeRelativeArm).join(', ');
}

function describeRelativeArm(arm: RelativeComplexSelector): string {
  let out = '';

  for (let i = 0; i < arm.steps.length; i++) {
    const step = arm.steps[i];
    out += describeRelativeStep(step);
    if (i !== arm.steps.length - 1) out += ' ';
  }

  return out;
}

export function describeRelativeStep(step: { combinator: Combinator; compound: RelativeCompoundSelector; }): string {
  return `${describeRelativeCombinator(step.combinator)}${describeRelativeCompound(step.compound)}`;
}

function describeRelativeCombinator(combinator: Combinator): string {
  return combinator === ' ' ? ' ' : `${combinator} `;
}

export function describeRelativeCompound(compound: RelativeCompoundSelector): string {
  return describeCompound(compound.compound);
}

function describeTag(tag: TagSelector): string {
  if (tag.prefixRaw !== undefined) return `${tag.prefixRaw}|${tag.localRaw}`;
  return tag.localRaw;
}

function describeCandidateTest(test: CandidateTest): string {
  if (test.debug?.kind === 'attr') {
    return describeAttribute(test.debug.attr);
  }

  if (test.debug?.kind === 'pseudo') {
    return `:${test.debug.name}`;
  }

  if (test.debug?.kind === 'is') return `:is(${describeList(test.debug.list)})`;
  if (test.debug?.kind === 'where') return `:where(${describeList(test.debug.list)})`;
  if (test.debug?.kind === 'not') return `:not(${describeList(test.debug.list)})`;
  if (test.debug?.kind === 'has') return `:has(${describeRelativeList(test.debug.list)})`;
  if (test.debug?.kind === 'expanded') {
    return test.pseudoIs
      ? `:xis(${describeList(test.pseudoIs)})`
      : test.pseudoWhere ? `:xwhere(${describeList(test.pseudoWhere)})` : '??';
  }

  if ('source' in test) return describeStaticSource(test.source);
  return '<deferred>';
}

function describeAttribute(attr: AttributeSelector): string {
  const ns =
    attr.prefixRaw === undefined ? ''
    : attr.prefixRaw === '' ? '|'
    : `${attr.prefixRaw}|`;

  const name = `${ns}${attr.localRaw}`;

  if (!attr.op) return `[${name}]`;

  const flag = attr.flag ? ` ${attr.flag}` : '';
  return `[${name}${attr.op}"${attr.valueRaw ?? ''}"${flag}]`;
}

function describeStaticSource(source: string): string {
  if (source === 'true') return 'true';
  if (source === 'false') return 'false';

  if (source === 's.isScope(e)') return ':scope';
  if (source === 's.isRoot(e)') return ':root';
  if (source === 's.isEmpty(e)') return ':empty';
  if (source === 's.isFirstChild(e)') return ':first-child';
  if (source === 's.isLastChild(e)') return ':last-child';
  if (source === 's.isOnlyChild(e)') return ':only-child';
  if (source === 's.isFirstOfType(e)') return ':first-of-type';
  if (source === 's.isLastOfType(e)') return ':last-of-type';
  if (source === 's.isOnlyOfType(e)') return ':only-of-type';

  if (source === 's.isAnyLink(e)') return ':any-link';
  if (source === 's.isTarget(e)') return ':target';
  if (source === 's.defined(e)') return ':defined';

  if (source === 's.isHovered(e)') return ':hover';
  if (source === 's.isActive(e)') return ':active';
  if (source === 's.isFocused(e)') return ':focus';
  if (source === 's.isFocusWithin(e)') return ':focus-within';

  if (source === 's.isEnabled(e)') return ':enabled';
  if (source === 's.isDisabled(e)') return ':disabled';
  if (source === '!s.isReadWrite(e)') return ':read-only';
  if (source === 's.isReadWrite(e)') return ':read-write';
  if (source === 's.isPlaceholderShown(e)') return ':placeholder-shown';
  if (source === 's.isDefault(e)') return ':default';

  if (source === 's.isChecked(e)') return ':checked';
  if (source === 's.isIndeterminate(e)') return ':indeterminate';
  if (source === 's.isRequired(e)') return ':required';
  if (source === 's.isOptional(e)') return ':optional';
  if (source === 's.isInvalid(e)') return ':invalid';
  if (source === 's.isValid(e)') return ':valid';
  if (source === 's.isInRange(e)') return ':in-range';
  if (source === 's.isOutOfRange(e)') return ':out-of-range';

  if (source === 's.isPlaying(e)') return ':playing';
  if (source === 's.isPaused(e)') return ':paused';
  if (source === 's.isSeeking(e)') return ':seeking';
  if (source === 's.isMuted(e)') return ':muted';

  if (source.startsWith('s.hasAttr(')) return '[attr]';
  if (source.startsWith('s.matchAttribute(')) return '[attr op value]';
  if (source.startsWith('s.matchLang(')) return ':lang(...)';
  if (source.startsWith('s.matchDir(')) return ':dir(...)';
  if (source.startsWith('s.isNthElement(')) return ':nth-child(...)';
  if (source.startsWith('s.isNthOfType(')) return ':nth-of-type(...)';
  if (source.includes('s.nthElement(')) return ':nth-child(...)';
  if (source.includes('s.nthOfType(')) return ':nth-of-type(...)';

  return `<source:${source}>`;
}
