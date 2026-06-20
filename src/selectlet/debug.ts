import type { CandidateTest, ComplexSelector, CompoundSelector, TagSelector } from './parser/parser';
import { cssIdentUnescape } from '../utils/css';
import { isDocument, isDocumentFragment, isElement } from '../utils/dom';

export type QueryContextDescription = {
  kind: 'document' | 'fragment' | 'element' | 'unknown';
  summary: string;
  preview?: string;
};

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
      out += `.${cssIdentUnescape(compound.classes[i].raw)}`;
    }
  }

  if (compound.host) {
    out += compound.host.arg ? `:host(${describeCompound(compound.host.arg)})` : ':host';
  }

  if (compound.hostContext) {
    out += `:host-context(${describeCompound(compound.hostContext.arg)})`;
  }

  for (let i = 0; i < compound.tests.length; i++) {
    out += describeTest(compound.tests[i]);
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
  if (debug?.kind === 'expanded') return test.pseudoIs ? ':xis(...)' : ':xwhere(...)';

  // if ('source' in test) return describeStaticTestSource(test.source);

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

export function describeElement(el: Element | null | undefined): string {
  if (!el) return '(missing)';
  const id = el.getAttribute('id');
  const cls = el.getAttribute('class');
  return `<${el.tagName.toLowerCase()}${id ? ` id='${id}'` : ''}${cls ? ` class='${cls}'` : ''}>`;
}

export function describeElements(els: Iterable<Element>, max = 10): string[] {
  const out: string[] = [];
  let count = 0;

  for (const e of els) {
    if (count < max) out[out.length] = describeElement(e);
    count++;
  }

  if (count > max) out[out.length] = `… (${count - max} more)`;
  return out;
}

const TEXT_NODE = 3;

type DescribeContextOptions = {
  preview?: boolean;
};

export function describeContext(ctx: QueryContext, opts?: DescribeContextOptions): QueryContextDescription {
  const includePreview = opts?.preview !== false;

  if (isDocument(ctx)) {
    const root = ctx.documentElement;
    const body = ctx.body as Element | null;
    const html = body ? body.outerHTML : root.outerHTML || '';

    const desc: QueryContextDescription = {
      kind: 'document',
      summary: '#document',
    };

    if (includePreview) desc.preview = previewText(html);
    return desc;
  }

  if (isDocumentFragment(ctx)) {
    const children = Array.from(ctx.childNodes)
      .map((n) => {
        if (isElement(n)) return n.outerHTML;
        if (n.nodeType === TEXT_NODE) return n.textContent ?? '';
        return '';
      }).join('');

    const desc: QueryContextDescription = {
      kind: 'fragment',
      summary: '#document-fragment',
    };

    if (includePreview) desc.preview = previewText(children);
    return desc;
  }

  if (isElement(ctx)) {
    const desc: QueryContextDescription = {
      kind: 'element',
      summary: describeElement(ctx),
    };

    if (includePreview) desc.preview = previewText(ctx.outerHTML);
    return desc;
  }

  return {
    kind: 'unknown',
    summary: '(unknown context)',
  };
}

export function describeLookup(compound: CompoundSelector): string {
  if (compound.id) return `#${cssIdentUnescape(compound.id.raw)}`;

  if (compound.classes?.length) {
    let s = '';
    for (let i = 0; i < compound.classes.length; i++) {
      s += `.${cssIdentUnescape(compound.classes[i].raw)}`;
    }
    return s;
  }

  if (compound.tag) return describeTag(compound.tag);

  return '*';
}

export function describeCombinator(combinator: string | null): string {
  return combinator === ' ' ? 'descendant' : String(combinator);
}
