import type { DOMNode as QuerySource, DOMOperations, DOMNode as Element } from '../infra/index';
import type { CandidateTest, ComplexSelector, CompoundSelector, TagSelector } from './parser/parser';
import { cssIdentUnescape } from './parser/escape';

export type QuerySourceDescription = {
  kind: 'document' | 'fragment' | 'element' | 'unknown';
  summary: string;
  preview?: string;
};

export function describeComplex(complex: ComplexSelector): string {
  let out = '';

  for (let i = 0; i < complex.parts.length; i++) {
    const part = complex.parts[i]!;

    if (i > 0) {
      out += part.combinator === ' ' ? ' ' : ` ${part.combinator} `;
    }

    out += describeCompound(part.compound);
  }

  return out;
}

export function describeCompound(compound: CompoundSelector): string {
  let out = '';

  if (compound.tag) {
    out += describeTag(compound.tag);
  }

  if (compound.id) {
    out += `#${cssIdentUnescape(compound.id.raw)}`;
  }

  if (compound.classes) {
    for (let i = 0; i < compound.classes.length; i++) {
      const cls = compound.classes[i]!;
      out += `.${cssIdentUnescape(cls.raw)}`;
    }
  }

  for (let i = 0; i < compound.tests.length; i++) {
    const test = compound.tests[i]!;
    out += describeTest(test);
  }

  return out || '*';
}

export function describeTag(tag: TagSelector): string {
  const local = tag.localRaw === '*' ? '*' : cssIdentUnescape(tag.localRaw);

  if (tag.prefixRaw !== undefined) {
    return `${tag.prefixRaw}|${local}`;
  }

  return local;
}

export function describeTest(test: CandidateTest): string {
  const debug = test.debug;

  if (debug?.kind === 'pseudo') return `:${debug.name}`;
  if (debug?.kind === 'attr') return '[attr]';
  if (debug?.kind === 'is') return ':is(...)';
  if (debug?.kind === 'where') return ':where(...)';
  if (debug?.kind === 'not') return ':not(...)';
  if (debug?.kind === 'has') return ':has(...)';
  if (debug?.kind === 'host') return debug.arg ? `:host(${describeCompound(debug.arg)})` : ':host';
  if (debug?.kind === 'host-context') return `:host-context(${describeCompound(debug.arg)})`;

  return '<test>';
}

export function describeStaticTestSource(source: string): string {
  if (source === 's.isFirstChild(e)') return ':first-child';
  if (source === 's.isLastChild(e)') return ':last-child';
  if (source === 's.isOnlyChild(e)') return ':only-child';
  if (source === 's.isFirstOfType(e)') return ':first-of-type';
  if (source === 's.isLastOfType(e)') return ':last-of-type';
  if (source === 's.isOnlyOfType(e)') return ':only-of-type';

  if (source.includes('s.nthElement(') || source.startsWith('s.isNthElement(')) {
    return ':nth-child(...)';
  }

  if (source.includes('s.nthOfType(') || source.startsWith('s.isNthOfType(')) {
    return ':nth-of-type(...)';
  }

  if (source === 's.isScope(e)') return ':scope';
  if (source === 's.isRoot(e)') return ':root';
  if (source === 's.isEmpty(e)') return ':empty';

  return '<test>';
}

function previewText(s: string, max = 240): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

export function describeElement(el: Element | null | undefined, dom: DOMOperations): string {
  if (!el) return '(missing)';
  const id = dom.getAttribute(el, 'id');
  const cls = dom.getAttribute(el, 'class');
  return `<${dom.getLocalName(el).toLowerCase()}${id ? ` id='${id}'` : ''}${cls ? ` class='${cls}'` : ''}>`;
}

export function describeElements(els: Iterable<Element>, max = 10, dom: DOMOperations): string[] {
  const out: string[] = [];
  let count = 0;

  for (const e of els) {
    if (count < max) out[out.length] = describeElement(e, dom);
    count++;
  }

  if (count > max) out[out.length] = `… (${count - max} more)`;
  return out;
}

type DescribeQuerySourceOptions = {
  preview?: boolean;
};

export function describeQuerySource(source: QuerySource, opts: DescribeQuerySourceOptions | undefined, dom: DOMOperations): QuerySourceDescription {
  const includePreview = opts?.preview !== false;

  if (dom.isDocument(source)) {
    const root = dom.documentElement(source);
    const body = dom.body(source);
    const html = body ? dom.describe(body) : root ? dom.describe(root) : '';

    const desc: QuerySourceDescription = {
      kind: 'document',
      summary: '#document',
    };

    if (includePreview) desc.preview = previewText(html);
    return desc;
  }

  if (dom.isDocumentFragment(source)) {
    let children = '';
    for (let node = dom.firstChild(source); node; node = dom.nextSibling(node)) {
      if (dom.isElement(node) || dom.isText(node)) children += dom.describe(node);
    }

    const desc: QuerySourceDescription = {
      kind: 'fragment',
      summary: '#document-fragment',
    };

    if (includePreview) desc.preview = previewText(children);
    return desc;
  }

  if (dom.isElement(source)) {
    const desc: QuerySourceDescription = {
      kind: 'element',
      summary: describeElement(source, dom),
    };

    if (includePreview) desc.preview = previewText(dom.describe(source));
    return desc;
  }

  return {
    kind: 'unknown',
    summary: '(unknown query source)',
  };
}

export function describeLookup(compound: CompoundSelector): string {
  if (compound.id) return `#${cssIdentUnescape(compound.id.raw)}`;

  if (compound.classes?.length) {
    let s = '';
    for (let i = 0; i < compound.classes.length; i++) {
      const cls = compound.classes[i]!;
      s += `.${cssIdentUnescape(cls.raw)}`;
    }
    return s;
  }

  if (compound.tag) return describeTag(compound.tag);

  return '*';
}

export function describeCombinator(combinator: string | null): string {
  return combinator === ' ' ? 'descendant' : String(combinator);
}
