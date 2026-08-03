/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import type {
  Engine, EquivalentCase, ContextRef, ContextHome, SelectletId, CssomProbe,
} from './scenarios';

export type PwHelpers = {
  resolveContext(doc: Document, ref?: ContextRef): QueryContext | null;
  runQuery(query: () => QueryOutput): QueryResult;
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
  value: string;
  cssom: unknown;
  supported: boolean;
  threw: boolean;
  error: string;
};

export type CssomOutput = { kind: 'cssom'; cssom: unknown; };
export type QueryOutput = Element[] | NodeListOf<Element> | string | boolean | CssomOutput;
export type EngineQuery = (query: string, ctx: QueryContext) => () => QueryOutput;
export type EngineAndQueryResult = { queryResult: QueryResult; engineResult: EngineResult; };
export type NamedQueryResult = { name: string; result: QueryResult; };
export type QueryResult = ElementResult | ValueResult | BooleanResult | CssomResult;
export type ElementResult = { kind: 'elements'; elements: Element[]; error: string; };
export type ValueResult = { kind: 'value'; value: string; error: string; };
export type BooleanResult = { kind: 'boolean'; value: boolean; error: string; };
export type CssomResult = { kind: 'cssom'; cssom: unknown; error: string; };

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

  function isIFrame(el: Element | null): el is HTMLIFrameElement {
    return !!el && el.localName === 'iframe';
  }

  function isTemplate(el: Element | null): el is HTMLTemplateElement {
    return !!el && el.localName === 'template';
  }

  function isRehomed(ref?: ContextRef): boolean {
    if (!ref) return false;
    if ('within' in ref && isRehomed(ref.within)) return true;
    return 'home' in ref && !!ref.home && ref.home !== 'document';
  }

  function isCssomOutput(x: unknown): x is CssomOutput {
    return typeof x === 'object' && x !== null && 'kind' in x && x.kind === 'cssom';
  }

  function isHtmlElement(x: unknown): x is HTMLElement {
    return isElement(x) && x.namespaceURI === 'http://www.w3.org/1999/xhtml';
  }

  function isHtmlLink(x: unknown): x is HTMLLinkElement {
    return isHtmlElement(x) && x.localName === 'link';
  }

  function isHtmlStyle(x: unknown): x is HTMLStyleElement {
    return isHtmlElement(x) && x.localName === 'style';
  }

  function isCssStyleDeclaration(x: unknown): x is CSSStyleDeclaration {
    return typeof x === 'object' &&
      x !== null &&
      'length' in x &&
      'cssText' in x &&
      hasFn(x, 'item') &&
      hasFn(x, 'getPropertyValue') &&
      hasFn(x, 'getPropertyPriority');
  }

  function isCssRuleList(x: unknown): x is CSSRuleList {
    return typeof x === 'object' &&
      x !== null &&
      'length' in x &&
      hasFn(x, 'item') &&
      !hasFn(x, 'getPropertyValue');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  function hasFn<K extends string>(x: object, key: K): x is object & Record<K, Function> {
    return key in x && typeof (x as Record<K, unknown>)[key] === 'function';
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

  function runQuery(query: () => QueryOutput): QueryResult {
    try {
      const out = query();
      if (typeof out === 'string') {
        return { kind: 'value', value: out, error: '' };
      }
      if (typeof out === 'boolean') {
        return { kind: 'boolean', value: out, error: '' };
      }
      if (isCssomOutput(out)) {
        return { kind: 'cssom', cssom: out.cssom, error: '' };
      }
      const id: SelectletId = 'selectlet-bootstrap';
      const els = [...out].filter((el) => el.getAttribute('id') !== id);
      return { kind: 'elements', elements: els, error: '' };
    } catch (e) {
      return { kind: 'elements', elements: [], error: e instanceof Error ? e.message : String(e) };
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

    if (a.result.kind === 'value' && b.result.kind === 'value') {
      return a.result.value === b.result.value
        ? undefined
        : `Value mismatch:\n` +
          `  ${a.name} = ${JSON.stringify(a.result.value)}\n` +
          `  ${b.name} = ${JSON.stringify(b.result.value)}`;
    }

    if (a.result.kind === 'boolean' && b.result.kind === 'boolean') {
      return a.result.value === b.result.value
        ? undefined
        : `Boolean mismatch:\n` +
          `  ${a.name} = ${a.result.value}\n` +
          `  ${b.name} = ${b.result.value}`;
    }

    if (a.result.kind === 'cssom' && b.result.kind === 'cssom') {
      const aJson = JSON.stringify(a.result.cssom);
      const bJson = JSON.stringify(b.result.cssom);

      return aJson === bJson
        ? undefined
        : `CSSOM mismatch:\n` +
          `  ${a.name} = ${aJson}\n` +
          `  ${b.name} = ${bJson}`;
    }

    if (a.result.kind !== 'elements' || b.result.kind !== 'elements') {
      throw new Error(
        `Invalid comparison between different result kinds:\n` +
        `  ${a.name} kind: ${a.result.kind}\n` +
        `  ${b.name} kind: ${b.result.kind}`
      );
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

      // Return the fragment container. Use `within` to resolve the cloned element inside it.
      return frag;
    }

    return null;
  }

  function toEngineResult(res: QueryResult): EngineResult {
    if (res.kind === 'value') {
      return {
        count: 0, ids: [], classes: [],
        value: res.value,
        cssom: undefined,
        supported: false,
        threw: !!res.error,
        error: res.error,
      };
    }
    if (res.kind === 'boolean') {
      return {
        count: 0, ids: [], classes: [],
        value: '',
        cssom: undefined,
        supported: res.value,
        threw: !!res.error,
        error: res.error,
      };
    }
    if (res.kind === 'cssom') {
      return {
        count: 0, ids: [], classes: [],
        value: '',
        cssom: res.cssom,
        supported: false,
        threw: !!res.error,
        error: res.error,
      };
    }
    return {
      count: res.elements.length,
      ids: res.elements.map((el) => el.getAttribute('id') ?? ''),
      classes: res.elements.map((el) => el.getAttribute('class') ?? ''),
      value: '',
      cssom: undefined,
      supported: false,
      threw: !!res.error,
      error: res.error,
    };
  }

  function getResults(queryFn: EngineQuery, query: string, ctx: QueryContext | null, ctxErrorMsg?: string): EngineAndQueryResult {
    const queryResult: QueryResult = ctx
      ? runQuery(queryFn(query, ctx))
      : { kind: 'elements', elements: [], error: ctxErrorMsg ?? 'No context provided' };

    const engineResult = toEngineResult(queryResult);
    return { queryResult, engineResult };
  }

  function toArr(list: Iterable<Element>): Element[] {
    return [...list];
  }

  function getEngineQuery(c: EquivalentCase, ng: Engine): EngineQuery {
    const sxlt = selectlet;
    if (!sxlt) throw new Error('selectlet is not available');

    switch (true) {
      case 'select' in c: {
        if (ng === 'native') return (query, ctx) => () => [...ctx.querySelectorAll(query)];
        if (ng === 'selectlet') return (query, ctx) => () => toArr(sxlt.select(query, ctx));
        break;
      }

      case 'first' in c: {
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
      }

      case 'byTag' in c: {
        if (ng === 'native') {
          return (query, ctx) => () => {
            const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
            return [...base.getElementsByTagName(query)];
          };
        }
        if (ng === 'selectlet') return (query, ctx) => () => toArr(sxlt.byTag(query, ctx));
        break;
      }

      case 'byTagNs' in c: {
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
      }

      case 'byClass' in c: {
        if (ng === 'native') {
          return (query, ctx) => () => {
            const base = isDocFrag(ctx) ? fragmentAsElementContext(ctx) : ctx;
            return [...base.getElementsByClassName(query)];
          };
        }
        if (ng === 'selectlet') return (query, ctx) => () => toArr(sxlt.byClass(query, ctx));
        break;
      }

      case 'byId' in c: {
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
      }

      case 'match' in c: {
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
            return sxlt.matches(query, el) ? [el] : [];
          };
        }
        break;
      }

      case 'closest' in c: {
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
      }

      case 'computedStyle' in c: {
        if (ng === 'native') {
          return (query, ctx) => () => {
            if (!isElement(ctx)) {
              throw new Error(`Context for 'computedStyle' case must be an Element`);
            }
            return getComputedStyle(ctx, c.pseudo).getPropertyValue(query).trim();
          };
        }
        throw new Error(`computedStyle cases do not support engine ${ng}`);
      }

      case 'cssom' in c: {
        if (ng === 'native') {
          return (_query, ctx) => () => ({
            kind: 'cssom',
            cssom: readCssom(c.cssom, ctx, { kind: 'sheet' }),
          });
        }

        if (ng === 'selectlet') {
          return (_query, ctx) => () => {
            const stlt = stylelet;
            if (!stlt) throw new Error('stylelet is not available');

            return {
              kind: 'cssom',
              cssom: readCssom(c.cssom, ctx, {
                kind: 'styleText',
                createSheet(source) {
                  return stlt.createStyleSheet(source);
                },
              }),
            };
          };
        }

        return assertNever(ng);
      }

      case 'supports' in c: {
        if (ng === 'native') {
          return () => () => 'condition' in c.supports
            ? CSS.supports(c.supports.condition)
            : CSS.supports(c.supports.property, c.supports.value);
        }
        throw new Error(`supports cases do not support engine ${ng}`);
      }

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
      case 'computedStyle' in c: return c.computedStyle;
      case 'cssom' in c: return `cssom:${stringify(c.cssom)}`;
      case 'supports' in c: return 'condition' in c.supports
        ? c.supports.condition
        : `${c.supports.property}: ${c.supports.value}`;
      default: assertNever(c);
    }
  }

  function getCaseLabel(c: EquivalentCase, engine: Engine): string {
    switch (true) {
      case 'select' in c: {
        return engine === 'native'
          ? `querySelectorAll(${c.select})`
          : `sxlt.select(${c.select})`;
      }
      case 'first' in c: {
        return engine === 'native'
          ? `querySelector(${c.first})`
          : `sxlt.first(${c.first})`;
      }
      case 'byTag' in c: {
        return engine === 'native'
          ? `byTag(${c.byTag})`
          : `sxlt.byTag(${c.byTag})`;
      }
      case 'byTagNs' in c: {
        return engine === 'native'
          ? `byTag(${c.byTagNs.ns}:${c.byTagNs.local})`
          : `sxlt.byTagNs(${c.byTagNs.ns}:${c.byTagNs.local})`;
      }
      case 'byClass' in c: {
        return engine === 'native'
          ? `byClass(${c.byClass})`
          : `sxlt.byClass(${c.byClass})`;
      }
      case 'byId' in c: {
        return engine === 'native'
          ? `byId(${c.byId})`
          : `sxlt.byId(${c.byId})`;
      }
      case 'match' in c: {
        return engine === 'native'
          ? `matches(${c.match})`
          : `sxlt.match(${c.match})`;
      }
      case 'closest' in c: {
        return engine === 'native'
          ? `closest(${c.closest})`
          : `sxlt.closest(${c.closest})`;
      }
      case 'computedStyle' in c: {
        const pseudo = c.pseudo === undefined ? '' : `, ${JSON.stringify(c.pseudo)}`;
        return engine === 'native'
          ? `native getComputedStyle(...${pseudo}).getPropertyValue(${c.computedStyle})`
          : `stylelet computedStyle(...${pseudo}, ${c.computedStyle})`;
      }
      case 'cssom' in c: {
        return engine === 'native'
          ? `native CSSOM ${stringify(c.cssom)}`
          : `stylelet CSSOM ${stringify(c.cssom)}`;
      }
      case 'supports' in c: {
        if ('condition' in c.supports) {
          return `CSS.supports(${JSON.stringify(c.supports.condition)})`;
        }
        return `CSS.supports(${JSON.stringify(c.supports.property)}, ${JSON.stringify(c.supports.value)})`;
      }
      default: {
        assertNever(c);
      }
    }
  }

  type CssomReadFrom =
    | { kind: 'sheet'; }
    | { kind: 'styleText'; createSheet: (source: string) => CSSStyleSheet; };

  function readCssom(cssom: CssomProbe, ctx: QueryContext, from: CssomReadFrom): unknown {
    const sheet = from.kind === 'sheet'
      ? resolveCssomSheet(ctx, cssom.sheet ?? 0)
      : createCssomSheetFromStyleText(cssom, ctx, from);

    return readCssomSheet(cssom, sheet);
  }

  function readCssomSheet(cssom: CssomProbe, sheet: CSSStyleSheet): unknown {
    switch (cssom.target) {
      case 'sheet.cssRules':
        return ruleListToArray(sheet.cssRules).map((rule) => inspectObject(rule));

      case 'sheet.cssRules.item':
        return inspectObject(sheet.cssRules.item(cssom.rule));

      case 'rule.style':
        return inspectObject(getStyleRule(sheet, cssom.rule).style);

      case 'style.property': {
        const matches: JsonRecord[] = [];

        if (cssom.rule !== undefined) {
          const style = getStyleRule(sheet, cssom.rule).style;
          matches.push(...getActiveDeclarations(style).filter((decl) => decl.name === cssom.name));
        } else {
          const rules = ruleListToArray(sheet.cssRules);

          for (const rule of rules) {
            if (rule.type !== CSSRule.STYLE_RULE) continue;

            const style = (rule as CSSStyleRule).style;
            matches.push(...getActiveDeclarations(style).filter((decl) => decl.name === cssom.name));
          }
        }

        if (matches.length === 0) {
          return null;
        }

        if (matches.length > 1) {
          throw new Error(`Ambiguous CSS declaration ${JSON.stringify(cssom.name)} matched ${matches.length} declarations`);
        }

        return matches[0];
      }

      default:
        return assertNever(cssom);
    }
  }

  function ruleListToArray(list: CSSRuleList): CSSRule[] {
    const rules: CSSRule[] = [];

    for (let i = 0; i < list.length; i++) {
      const rule = list.item(i);
      if (rule) rules.push(rule);
    }

    return rules;
  }

  function resolveCssomSheet(ctx: QueryContext, index = 0): CSSStyleSheet {
    if (isDocument(ctx)) {
      const sheet = ctx.styleSheets[index];
      if (!sheet) throw new Error(`No stylesheet at index ${index}`);
      return sheet;
    }

    if (isHtmlStyle(ctx) || isHtmlLink(ctx)) {
      const sheet = ctx.sheet;
      if (!sheet) throw new Error(`Referenced element has no stylesheet`);
      return sheet;
    }

    throw new Error(`Context for 'cssom' sheet read must be a Document, <style>, or <link>`);
  }

  function createCssomSheetFromStyleText(cssom: CssomProbe, ctx: QueryContext, from: Extract<CssomReadFrom, { kind: 'styleText'; }>): CSSStyleSheet {
    const source = resolveCssomStyleText(ctx, cssom.sheet ?? 0);
    return from.createSheet(source);
  }

  function resolveCssomStyleText(ctx: QueryContext, index = 0): string {
    if (isHtmlStyle(ctx)) {
      if (index !== 0) throw new Error(`No <style> element at index ${index}`);
      return ctx.textContent ?? '';
    }

    if (isHtmlLink(ctx)) {
      throw new Error(`Cannot read selectlet cssom source from <link>; use inline <style> for now`);
    }

    if (isDocument(ctx) || isDocFrag(ctx) || isElement(ctx)) {
      const styles = [...ctx.querySelectorAll('style')].filter(isHtmlStyle);
      const style = styles[index];

      if (!style) throw new Error(`No <style> element at index ${index}`);

      return style.textContent ?? '';
    }

    throw new Error(`Context for 'cssom' styleText read must be a Document, DocumentFragment, Element, or <style>`);
  }

  type JsonRecord = Record<string, unknown>;
  type InspectOptions = { skipEmptyStrings?: boolean; };
  const DEFAULT_INSPECT_OPTIONS: InspectOptions = { skipEmptyStrings: true };

  function inspectObject(value: unknown, depth = 2, opts: InspectOptions = DEFAULT_INSPECT_OPTIONS): unknown {
    return inspectObjectInner(value, depth, opts, new WeakSet<object>());
  }

  function inspectObjectInner(value: unknown, depth: number, opts: InspectOptions, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) return null;

    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return value;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    if (t === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    if (t !== 'object') return String(value);

    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    // Special CSSOM containers get inspected even near the depth boundary
    if (isCssStyleDeclaration(value)) {
      return inspectStyleDeclaration(value, depth, opts, seen);
    }

    if (isCssRuleList(value)) {
      return Array.from(value).map((rule) =>
        inspectObjectInner(rule, depth - 1, opts, seen)
      );
    }

    if (depth < 0) {
      return `[${value.constructor?.name ?? 'Object'}]`;
    }

    return inspectHostObject(value, depth, opts, seen);
  }

  function inspectHostObject(obj: object, depth: number, opts: InspectOptions, seen: WeakSet<object>): JsonRecord {
    const out: JsonRecord = {
      $type: obj.constructor?.name ?? 'Object',
    };

    const names = new Set<string>();

    for (
      let proto: object | null = obj;
      proto && proto !== Object.prototype;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      proto = Object.getPrototypeOf(proto)
    ) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        names.add(name);
      }
    }

    for (const name of names) {
      try {
        const v = (obj as Record<string, unknown>)[name];

        if (typeof v === 'function') continue;
        if (v === undefined) continue;
        if (opts.skipEmptyStrings && v === '') continue;

        out[name] = inspectObjectInner(v, depth - 1, opts, seen);
      } catch (err) {
        out[name] = `[Throws: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }

    return out;
  }

  function inspectStyleDeclaration(style: CSSStyleDeclaration, depth: number, opts: InspectOptions, seen: WeakSet<object>): JsonRecord {
    const out = inspectHostObject(style, Math.max(depth, 0), opts, seen);

    out.kind = 'styleDeclaration';

    const active = [];
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      const priority = style.getPropertyPriority(name);

      active.push({
        kind: 'declaration',
        index: i,
        name,
        value: style.getPropertyValue(name),
        priority,
        important: priority === 'important',
      });
    }

    out.active = active;
    out.length = style.length;
    out.cssText = style.cssText;

    return out;
  }

  function getStyleRule(sheet: CSSStyleSheet, index: number): CSSStyleRule {
    const rule = getRule(sheet, index);
    if (rule.type !== CSSRule.STYLE_RULE) {
      throw new Error(`CSS rule at index ${index} is not a style rule`);
    }

    return rule as CSSStyleRule;
  }

  function getRule(sheet: CSSStyleSheet, index: number): CSSRule {
    const rule = sheet.cssRules[index];
    if (!rule) throw new Error(`No CSS rule at index ${index}`);
    return rule;
  }

  function getActiveDeclarations(style: CSSStyleDeclaration): JsonRecord[] {
    const decls: JsonRecord[] = [];

    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      const priority = style.getPropertyPriority(name);

      decls.push({
        kind: 'declaration',
        index: i,
        name,
        value: style.getPropertyValue(name),
        priority,
        important: priority === 'important',
      });
    }

    return decls;
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
}
