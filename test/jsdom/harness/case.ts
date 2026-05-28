/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { expect } from 'vitest';
import { assertNever } from '../../utils/util';
import type { ContextHome, ContextRef, Expectation, Scenario, TestCase } from './scenarios';
import {
  cssEscape, isDocFrag, isDocument, isElement, isHtmlDoc, isIFrame, isTemplate,
} from '../../utils/util';

export type CaseInfo = {
  scenario: Scenario;
  case: TestCase;
  stepIndex: number;
  caseIndex: number;
  stepCaseIndex: number;
};

export function runCase(document: Document, info: CaseInfo, stackTrace: boolean): void {
  const c = info.case;

  if (c.status === 'skip' || c.status === 'fixme' || c.status === 'fail') return;

  let threw = false;
  let nodes: Element[] = [];
  let thrown: unknown;
  const ctx = resolveContext(document, 'ref' in c ? c.ref : undefined);

  try {
    if (!ctx) throw new Error('No context provided');

    if ('select' in c) {
      nodes = [...ctx.querySelectorAll(c.select)];
    } else if ('first' in c) {
      const el = ctx.querySelector(c.first);
      nodes = el ? [el] : [];
    } else if ('byTag' in c) {
      const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
      nodes = [...base.getElementsByTagName(c.byTag)];
    } else if ('byTagNs' in c) {
      const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
      nodes = [...base.getElementsByTagNameNS(c.byTagNs.ns, c.byTagNs.local)];
    } else if ('byClass' in c) {
      const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
      nodes = [...base.getElementsByClassName(c.byClass)];
    } else if ('byId' in c) {
      const found = queryId(ctx, c.byId);
      nodes = found ? [found] : [];
    } else if ('match' in c) {
      if (!isElement(ctx)) throw new Error(`Context for 'match' case must be an Element`);
      nodes = ctx.matches(c.match) ? [ctx] : [];
    } else if ('closest' in c) {
      if (!isElement(ctx)) throw new Error(`Context for 'closest' case must be an Element`);
      const hit = ctx.closest(c.closest);
      nodes = hit ? [hit] : [];
    } else {
      throw new Error(`jsdom harness does not support this case yet`);
    }
  } catch (err) {
    threw = true;
    thrown = err;
  }

  assertExpectation(caseQuery(c), nodes, threw, c.expect, thrown, stackTrace);
}

function caseQuery(c: TestCase): string {
  if ('select' in c) return c.select;
  if ('first' in c) return c.first;
  if ('match' in c) return c.match;
  if ('closest' in c) return c.closest;
  if ('byId' in c) return `byId(${c.byId})`;
  if ('byTag' in c) return `byTag(${c.byTag})`;
  if ('byClass' in c) return `byClass(${c.byClass})`;
  if ('byTagNs' in c) return `byTagNs(${c.byTagNs.ns}, ${c.byTagNs.local})`;
  return '<unknown case>';
}

function refLabel(ref: ContextRef | undefined): string {
  if (!ref) return 'document';
  if (ref.by === 'document') return 'document';
  if (ref.by === 'id') return `#${ref.id}${ref.home ? ` home=${ref.home}` : ''}`;
  if (ref.by === 'first') return `first(${ref.selector})${ref.home ? ` home=${ref.home}` : ''}`;
  if (ref.by === 'documentElement') return `documentElement${ref.home ? ` home=${ref.home}` : ''}`;
  if (ref.by === 'iframe') return `iframe#${ref.id}`;
  if (ref.by === 'template') return `template#${ref.id}`;
  if (ref.by === 'shadowRoot') return `shadowRoot#${ref.id}`;
  return assertNever(ref);
}

function caseRef(c: TestCase): ContextRef | undefined {
  if ('ref' in c) return c.ref;
  return undefined;
}

export function formatCaseHeader(info: CaseInfo): string {
  const c = info.case;

  return [
    `${info.scenario.name}`,
    `Step #${info.stepIndex + 1}, Case #${info.caseIndex + 1}`,
    `Query: ${caseQuery(c)}`,
    `Context: ${refLabel(caseRef(c))}`,
  ].join('\n');
}

function queryId(base: QueryContext, id: string): Element | null {
  if (isDocument(base) || isDocFrag(base)) return base.getElementById(id);
  return base.querySelector(`#${cssEscape(id)}`);
}

function resolveContext(doc: Document, ref?: ContextRef): QueryContext | null {
  if (!ref || ref.by === 'document') return doc;

  const base = 'within' in ref && ref.within ? resolveContext(doc, ref.within) : doc;
  if (!base) return null;

  if (ref.by === 'iframe') {
    const iframe = queryId(base, ref.id);
    if (!isIFrame(iframe)) return null;
    return iframe.contentDocument ?? null;
  }

  if (ref.by === 'template') {
    const tmpl = queryId(base, ref.id);
    if (!isTemplate(tmpl)) return null;
    return tmpl.content;
  }

  if (ref.by === 'shadowRoot') {
    const host = queryId(base, ref.id);
    return host?.shadowRoot ?? null;
  }

  const el = ref.by === 'id' ? queryId(base, ref.id)
    : ref.by === 'first' ? base.querySelector(ref.selector)
    : ref.by === 'documentElement' ? doc.documentElement
    : null;

  if (!el) return null;

  const home: ContextHome = ref.home ?? 'document';
  if (home === 'document') return el;

  const clone = el.cloneNode(true);
  if (!isElement(clone)) return null;
  if (home === 'detached') return clone;

  if (home === 'fragment') {
    const frag = doc.createDocumentFragment();
    frag.appendChild(clone);
    return frag;
  }

  return null;
}

function fragmentAsElementContext(ctx: DocumentFragment): Element {
  tagFragmentElements(ctx);

  const isHtml = isHtmlDoc(ctx.ownerDocument);
  const doc = ctx.ownerDocument;
  const wrapper = isHtml ? doc.createElement('div') : doc.createElementNS(null, 'wrapper');

  wrapper.appendChild(doc.importNode(ctx.cloneNode(true), true));
  return wrapper;
}

const HARNESS_NODE_ID = 'data-harness-node-id';

let nextHarnessNodeId = 1;

function tagFragmentElements(ctx: DocumentFragment): void {
  for (const el of ctx.querySelectorAll('*')) {
    el.setAttribute(HARNESS_NODE_ID, String(nextHarnessNodeId++));
  }
}

function assertExpectation(
  label: string, nodes: Element[], threw: boolean, e: Expectation | undefined, thrownError: unknown, stackTrace: boolean
) {
  if (threw) {
    if (e?.throws) return;
    throw new Error(`Unexpected error for ${label}: ${thrownMessage(thrownError, stackTrace)}`);
  }

  if (e?.throws) {
    throw new Error(`Expected throw for ${label}, but no error was thrown`);
  }

  const ids = nodes.map((e) => e.id);
  const classNames = nodes.map((e) => classNameOf(e));
  const classTokens = nodes.flatMap((e) => [...e.classList]);

  if (e?.count !== undefined) {
    expect(nodes.length, `count for ${label}`).toBe(e.count);
  }

  if (e?.ids !== undefined) {
    expect(ids, `ids for ${label}`).toEqual(e.ids);
  }

  if (e?.includesIds !== undefined) {
    expect(ids, `includesIds for ${label}`).toEqual(expect.arrayContaining(e.includesIds));
  }

  if (e?.excludesIds !== undefined) {
    for (const id of e.excludesIds) {
      expect(ids, `excludesIds for ${label}`).not.toContain(id);
    }
  }

  if (e?.classes !== undefined) {
    expect(classNames, `classes for ${label}`).toEqual(e.classes);
  }

  if (e?.includesClasses !== undefined) {
    expect(classTokens, `includesClasses for ${label}`).toEqual(
      expect.arrayContaining(e.includesClasses),
    );
  }

  if (e?.excludesClasses !== undefined) {
    for (const cls of e.excludesClasses) {
      expect(classTokens, `excludesClasses for ${label}`).not.toContain(cls);
    }
  }
}

function classNameOf(el: Element): string {
  const cls = el.className as string | SVGAnimatedString;

  if (typeof cls === 'string') return cls;
  return cls.baseVal;
}

export function thrownMessage(err: unknown, stackTrace: boolean): string {
  if (!stackTrace) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;

  if (typeof err === 'object' && err !== null && 'name' in err && 'message' in err) {
    const e = err as { name: unknown; message: unknown; stack?: unknown; };
    return typeof e.stack === 'string' ? e.stack : `${String(e.name)}: ${String(e.message)}`;
  }

  return String(err);
}
