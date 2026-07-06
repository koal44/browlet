import type {
  AttributeSelector, CandidateTest, Combinator, ComplexSelector, CompoundSelector,
  RelativeComplexSelector, RelativeCompoundSelector, RelativeSelectorList, SelectorList, TagSelector,
} from '../../src/selectlet/parser/parser';

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

    if (i === 0 && step.combinator === ' ') {
      out += describeRelativeCompound(step.compound);
    } else {
      out += describeRelativeStep(step);
    }

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
  if (test.debug?.kind === 'static') {
    return test.debug.value ? 'true' : 'false';
  }

  if (test.debug?.kind === 'attr') {
    return describeAttribute(test.debug.attr);
  }

  if (test.debug?.kind === 'pseudo') {
    return `:${test.debug.name}`;
  }

  if (test.debug?.kind === 'pseudo-element') {
    return `::${test.debug.name}`;
  }

  if (test.debug?.kind === 'registered-pseudo') {
    return `:${test.debug.name}`;
  }

  if (test.debug?.kind === 'is') return `:is(${describeList(test.debug.list)})`;
  if (test.debug?.kind === 'where') return `:where(${describeList(test.debug.list)})`;
  if (test.debug?.kind === 'not') return `:not(${describeList(test.debug.list)})`;
  if (test.debug?.kind === 'has') return `:has(${describeRelativeList(test.debug.list)})`;

  if (test.debug?.kind === 'parts') {
    return `::part(${test.debug.parts.join(' ')})`;
  }

  return '<test>';
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
