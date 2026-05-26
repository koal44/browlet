/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import type { ElementList } from '../../../src/selectlet';
import type { Engine, EquivalentCase, ContextRef, ContextHome, SelectletId } from './scenarios';

export type PwHelpers = {
  resolveContext(doc: Document, ref?: ContextRef): QueryContext | null;
  runQuery(query: () => Element[]): QueryResult;
  compareQueryResults(a: NamedQueryResult, b: NamedQueryResult): string | undefined;
  toEngineResult(res: QueryResult): EngineResult;
  getResults(queryFn: EngineQuery, query: string, ctx: QueryContext | null, ctxErrorMsg?: string): EngineAndQueryResult;
  getEngineQuery(c: EquivalentCase, n: Engine): EngineQuery;
  getCaseQuery(c: EquivalentCase): string;
  getCaseLabel(c: EquivalentCase, n: Engine): string;
  stringify(obj: unknown): string;
  isRehomed(ref?: ContextRef): boolean;
}

export type EvalResult = {
  info: string;
  mismatchMsg?: string;
  equivMismatchMsg?: string;
  engineResults: Partial<Record<Engine, EngineResult>>;
};

export type EngineResult = {
  count: number;
  ids: string[];
  classes: string[];
  threw: boolean;
  error: string;
};

export type EngineQuery = (query: string, ctx: QueryContext) => () => Element[];
export type EngineAndQueryResult = { queryResult: QueryResult; engineResult: EngineResult; };
export type NamedQueryResult = { name: string; result: QueryResult; };
export type QueryResult = { elements: Element[]; error: string; };

export function installBrowserHelpers(): void {
  const HARNESS_NODE_ID = 'data-harness-node-id';

  function assertNever(x: never): never {
    throw new Error(`Unexpected key: ${String(x)}`);
  }

  function isElement(x: unknown): x is Element {
    return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 1;
  }

  function isDocument(x: unknown): x is Document {
    return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 9;
  }

  function isDocFrag(x: unknown): x is DocumentFragment {
    return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 11;
  }

  function isRehomed(ref?: ContextRef): boolean {
    if (!ref) return false;
    if ('within' in ref && isRehomed(ref.within)) return true;
    return 'home' in ref && !!ref.home && ref.home !== 'document';
  }

  // Source - https://stackoverflow.com/a/65443215
  function stringify(obj: unknown): string {
    let json = JSON.stringify(obj, null, 2) as string | undefined;
    if (json === undefined) return String(obj);
    json = json.replace(/^[\t ]*"[^:\n\r]+(?<!\\)":/gm, function(match) {
      return match.replace(/"/g, '');
    });
    return json.replace(/"/g, "'").replace(/\s+/g, ' ');
  }

  function runQuery(query: () => Element[] | NodeListOf<Element>) {
    try {
      const id: SelectletId = 'selectlet-bootstrap';
      const els = [...query()].filter((el) => el.getAttribute('id') !== id);
      return { elements: els, error: '' };
    } catch (e) {
      return { elements: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  function describe(el: Element | undefined) {
    if (!el) return '(missing)';
    const id = el.getAttribute('id');
    const className = el.getAttribute('class');
    const tag = el.namespaceURI === 'http://www.w3.org/1999/xhtml' ? el.localName : el.tagName;
    return `<${tag}${id ? ` id='${id}'` : ''}${className ? ` class='${className}'` : ''}>`;
  }

  function compareQueryResults(a: NamedQueryResult, b: NamedQueryResult): string | undefined {
    if (a.result.error || b.result.error) {
      if (a.result.error && b.result.error) {
        return `Both threw:\n  ${a.name} error: ${a.result.error}\n  ${b.name} error: ${b.result.error}`;
      }
      return a.result.error
        ? `Throw mismatch:\n  ${a.name} threw while ${b.name} did not.\n  error: ${a.result.error}`
        : `Throw mismatch:\n  ${b.name} threw while ${a.name} did not.\n  error: ${b.result.error}`;
    }

    const aElems = a.result.elements;
    const bElems = b.result.elements;

    let mismatchMsg: string | undefined;
    if (aElems.length !== bElems.length) {
      mismatchMsg = `Count mismatch:\n  ${a.name} = ${aElems.length}\n  ${b.name} = ${bElems.length}`;
    }

    const maxLen = Math.max(aElems.length, bElems.length);
    for (let i = 0; i < maxLen; ++i) {
      if (!sameHarnessElement(aElems[i], bElems[i])) {
        mismatchMsg = mismatchMsg ? mismatchMsg + '\n' : '';
        mismatchMsg += `First element mismatch at index ${i}:\n` +
          `  ${a.name}[${i}] = ${describe(aElems[i])}\n` +
          `  ${b.name}[${i}] = ${describe(bElems[i])}`;
        break;
      }
    }

    return mismatchMsg;
  }

  function sameHarnessElement(a: Element | undefined, b: Element | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;

    const aid = a.getAttribute(HARNESS_NODE_ID);
    const bid = b.getAttribute(HARNESS_NODE_ID);

    return !!aid && aid === bid;
  }

  function queryId(base: QueryContext, id: string): Element | null {
    if (isDocument(base) || isDocFrag(base)) return base.getElementById(id);
    return base.querySelector(`#${CSS.escape(id)}`);
  }

  function resolveContext(doc: Document, ref?: ContextRef): QueryContext | null {
    if (!ref || ref.by === 'document') return doc;

    const base = 'within' in ref && ref.within ? resolveContext(doc, ref.within) : doc;
    if (!base) return null;

    if (ref.by === 'iframe') {
      const iframe = queryId(base, ref.id);
      if (!(iframe instanceof HTMLIFrameElement)) return null;
      return iframe.contentDocument ?? null;
    }

    if (ref.by === 'template') {
      const tmpl = queryId(base, ref.id);
      if (!(tmpl instanceof HTMLTemplateElement)) return null;
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

      // Return the fragment container. Use `within` to resolve the cloned element inside it.
      return frag;
    }

    return null;
  }

  function toEngineResult(res: QueryResult): EngineResult {
    return {
      count: res.elements.length,
      ids: res.elements.map((el) => el.getAttribute('id') ?? ''),
      classes: res.elements.map((el) => el.getAttribute('class') ?? ''),
      threw: !!res.error,
      error: res.error,
    };
  }

  function getResults(queryFn: EngineQuery, query: string, ctx: QueryContext | null, ctxErrorMsg?: string): EngineAndQueryResult {
    const queryResult: QueryResult = ctx
      ? runQuery(queryFn(query, ctx))
      : { elements: [], error: ctxErrorMsg ?? 'No context provided' };

    const engineResult = toEngineResult(queryResult);
    return { queryResult, engineResult };
  }

  function toArr(list: ElementList): Element[] {
    return Array.isArray(list) ? list : [...list];
  }

  function getEngineQuery(c: EquivalentCase, ng: Engine): EngineQuery {
    const sxlt = selectlet;
    if (!sxlt) throw new Error('selectlet is not available');

    switch (true) {
      case 'select' in c:
        if (ng === 'native') return (query, ctx) => () => [...ctx.querySelectorAll(query)];
        if (ng === 'selectlet') return (query, ctx) => () => toArr(sxlt.select(query, ctx));
        break;

      case 'first' in c:
        if (ng === 'native') {
          return (query, ctx) => () => {
            const el = ctx.querySelector(query);
            return el ? [el] : [];
          };
        }
        if (ng === 'selectlet') {
          return (query, ctx) => () => {
            const el = sxlt.first(query, ctx);
            return el ? [el] : [];
          };
        }
        break;

      case 'byTag' in c:
        if (ng === 'native') {
          return (query, ctx) => () => {
            const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
            return [...base.getElementsByTagName(query)];
          };
        }
        if (ng === 'selectlet') return (query, ctx) => () => toArr(sxlt.byTag(query, ctx));
        break;

      case 'byTagNs' in c:
        if (ng === 'native') {
          return (_query, ctx) => () => {
            const { ns, local } = c.byTagNs;
            const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
            return [...base.getElementsByTagNameNS(ns, local)];
          };
        }
        if (ng === 'selectlet') {
          return (_query, ctx) => () => {
            const { ns, local } = c.byTagNs;
            return toArr(sxlt.byTagNs(ns, local, ctx));
          };
        }
        break;

      case 'byClass' in c:
        if (ng === 'native') {
          return (query, ctx) => () => {
            const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
            return [...base.getElementsByClassName(query)];
          };
        }
        if (ng === 'selectlet') return (query, ctx) => () => toArr(sxlt.byClass(query, ctx));
        break;

      case 'byId' in c:
        if (ng === 'native') {
          return (query, ctx) => () => {
            const found = queryId(ctx, query);
            return found ? [found] : [];
          };
        }
        if (ng === 'selectlet') {
          return (query, ctx) => () => {
            const found = sxlt.byId(query, ctx);
            return found ? [found] : [];
          };
        }
        break;

      case 'match' in c:
        if (ng === 'native') {
          return (query, ctx) => () => {
            if (!isElement(ctx)) throw new Error(`Context for 'match' case must be an Element`);
            const el = ctx;
            return el.matches(query) ? [el] : [];
          };
        }
        if (ng === 'selectlet') {
          return (query, ctx) => () => {
            if (!isElement(ctx)) throw new Error(`Context for 'match' case must be an Element`);
            const el = ctx;
            return sxlt.match(query, el) ? [el] : [];
          };
        }
        break;

      case 'closest' in c:
        if (ng === 'native') {
          return (query, ctx) => () => {
            if (!isElement(ctx)) throw new Error(`Context for 'closest' case must be an Element`);
            const el = ctx;
            const hit = el.closest(query);
            return hit ? [hit] : [];
          };
        }
        if (ng === 'selectlet') {
          return (query, ctx) => () => {
            if (!isElement(ctx)) throw new Error(`Context for 'closest' case must be an Element`);
            const el = ctx;
            const hit = sxlt.closest(query, el);
            return hit ? [hit] : [];
          };
        }
        break;

      default:
        assertNever(c);
    }

    assertNever(ng);
  }

  function fragmentAsElementContext(ctx: DocumentFragment): Element {
    tagFragmentElements(ctx);

    const isHtml = isHtmlDoc(ctx.ownerDocument);
    const doc = ctx.ownerDocument;
    const wrapper = isHtml ? doc.createElement('div') : doc.createElementNS(null, 'wrapper');

    wrapper.appendChild(doc.importNode(ctx.cloneNode(true), true));
    return wrapper;
  }

  function isHtmlDoc(doc: Document): doc is HTMLDocument {
    return doc.contentType.includes('/html') === true;
  }

  let nextHarnessNodeId = 1;
  function tagFragmentElements(ctx: DocumentFragment): void {
    for (const el of ctx.querySelectorAll('*')) {
      el.setAttribute(HARNESS_NODE_ID, String(nextHarnessNodeId++));
    }
  }

  function getCaseQuery(c: EquivalentCase): string {
    switch (true) {
      case 'select' in c: return c.select;
      case 'first' in c: return c.first;
      case 'byTag' in c: return c.byTag;
      case 'byTagNs' in c: return `${c.byTagNs.ns}:${c.byTagNs.local}`;
      case 'byClass' in c: return c.byClass;
      case 'byId' in c: return c.byId;
      case 'match' in c: return c.match;
      case 'closest' in c: return c.closest;
      default: assertNever(c);
    }
  }

  function getCaseLabel(c: EquivalentCase, engine: Engine): string {
    switch (true) {
      case 'select' in c:
        return engine === 'native'
          ? `querySelectorAll(${c.select})`
          : `sxlt.select(${c.select})`;

      case 'first' in c:
        return engine === 'native'
          ? `querySelector(${c.first})`
          : `sxlt.first(${c.first})`;

      case 'byTag' in c:
        return engine === 'native'
          ? `byTag(${c.byTag})`
          : `sxlt.byTag(${c.byTag})`;

      case 'byTagNs' in c:
        return engine === 'native'
          ? `byTag(${c.byTagNs.ns}:${c.byTagNs.local})`
          : `sxlt.byTagNs(${c.byTagNs.ns}:${c.byTagNs.local})`;

      case 'byClass' in c:
        return engine === 'native'
          ? `byClass(${c.byClass})`
          : `sxlt.byClass(${c.byClass})`;

      case 'byId' in c:
        return engine === 'native'
          ? `byId(${c.byId})`
          : `sxlt.byId(${c.byId})`;

      case 'match' in c:
        return engine === 'native'
          ? `matches(${c.match})`
          : `sxlt.match(${c.match})`;

      case 'closest' in c:
        return engine === 'native'
          ? `closest(${c.closest})`
          : `sxlt.closest(${c.closest})`;

      default:
        assertNever(c);
    }
  }

  window.__pwHelpers = {
    resolveContext,
    runQuery,
    compareQueryResults,
    toEngineResult,
    getResults,
    getEngineQuery,
    getCaseQuery,
    getCaseLabel,
    stringify,
    isRehomed,
  };
};
