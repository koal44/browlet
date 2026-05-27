/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { describe, expect, test } from 'vitest';
import type {
  Scenario, ScenariosStatus, TestCase, RunScenariosOptions, ContextRef, ScenarioStep,
  ContextHome,
} from '../../browser/harness/scenarios';
import { getJsdomVariant } from './engines';
import type { JSDOM as JsdomInst } from 'jsdom';
export type { JSDOM as JsdomInst } from 'jsdom';
import type * as JsdomMod from 'jsdom';
export type * as JsdomMod from 'jsdom';
import { assertNever } from '../../utils/type';

type JsdomCtor = typeof JsdomMod.JSDOM;

type CaseInfo = {
  scenario: Scenario;
  case: TestCase;
  stepIndex: number;
  caseIndex: number;
  stepCaseIndex: number;
};

const ONLY = process.env.ONLY;

export function runScenarios(label: string, status: ScenariosStatus, scenarios: Scenario[], _opts: RunScenariosOptions = {}): void {
  const { engine, JSDOM } = getJsdomVariant();
  const describeFn = getDescribeFn(status);

  const hasAnyOnly = scenarios.some((s) => scenarioHas(s, 'only'));
  const respectOnly = ONLY || hasAnyOnly;

  if (ONLY && !hasAnyOnly) {
    test.skip(`jsdom/${engine}/${label} [!ONLY]`, () => {});
    return;
  }

  describeFn(`jsdom/${engine}/${label}`, () => {
    for (const s of scenarios) {
      const hasOnly = scenarioHas(s, 'only');
      if (respectOnly && !hasOnly) continue;

      const skipReason = getScenarioSkipReason(s);
      const testFn = skipReason ? test.skip : getTestFn(s.status);
      const name = skipReason ? `${s.name} [${skipReason}]` : s.name;

      testFn(name, async () => {
        await runScenario(s, JSDOM);
      });
    }
  });
}

async function runScenario(s: Scenario, jsdom: JsdomCtor): Promise<void> {
  if (s.steps?.length && s.cases?.length) {
    throw new Error(`${s.name}: use either steps or top-level cases, not both`);
  }

  const steps: ScenarioStep[] = s.steps ?? (s.cases?.length ? [{ cases: s.cases }] : []);
  const hasOnlyCases = steps.some((step) => step.cases.some((c) => c.status === 'only'));

  const dom = initDom(jsdom, s);
  installSelectletShim(dom);
  hydrateDeclarativeShadowRoots(dom.window.document);
  patchComputedStyleForPseudoElements(dom);
  const { document } = dom.window;
  const page = createJsdomPage(dom);

  if (s.setupPage) {
    await s.setupPage(page as never);
  }

  let stepCaseIndex = 0;
  for (let stepIndex = 0; stepIndex < steps.length; ++stepIndex) {
    const step = steps[stepIndex];

    if (step.setupPage) {
      await step.setupPage(page as never);
    }

    for (let caseIndex = 0; caseIndex < step.cases.length; ++caseIndex) {
      const c = step.cases[caseIndex];
      if (hasOnlyCases && c.status !== 'only') continue;
      if (c.browsers?.length) continue;
      if (c.engines?.length) continue;

      const info: CaseInfo = {
        scenario: s, case: c,
        stepIndex, caseIndex, stepCaseIndex,
      };

      try {
        runCase(document, info);
      } catch (err) {
        throw new Error(`${formatCaseHeader(info)}\n${thrownMessage(err)}`);
      }

      stepCaseIndex++;
    }
  }
}

function getDescribeFn(status: ScenariosStatus) {
  if (status === 'skip') return describe.skip;
  if (status === 'only') return describe.only;
  return describe;
}

function getTestFn(status: Scenario['status']) {
  if (status === 'skip' || status === 'fixme' || status === 'fail') return test.skip;
  if (status === 'only') return test.only;
  return test;
}

function scenarioHas(s: Scenario, status: 'only' | 'fixme'): boolean {
  return s.status === status ||
    !!s.cases?.some((c) => c.status === status) ||
    !!s.steps?.some((step) => step.cases.some((c) => c.status === status));
}

function getScenarioSkipReason(s: Scenario): string | null {
  if (s.status === 'skip') return 'scenario marked skip';
  if (s.status === 'fixme') return 'scenario marked fixme';
  if (s.status === 'fail') return 'scenario marked fail';
  if (s.browsers?.length) return 'browser-specific scenario';
  if (s.engines?.length) return 'engine-specific scenario';
  return null;
}

function initDom(jsdom: JsdomCtor, scenario: Scenario): JsdomInst {
  const opts = {
    runScripts: 'outside-only' as const,
    url: scenario.url ?? 'about:blank',
  };

  if (scenario.markupMode === 'xml-document') {
    return new jsdom(scenario.markup, {
      ...opts,
      contentType: 'text/xml',
    });
  }

  if (scenario.markupMode === 'html-document') {
    const hasHtml = /<html[\s>]/i.test(scenario.markup.trim());
    if (!hasHtml) {
      throw new Error(`markupMode="html-document" requires full HTML document markup including <html>`);
    }
    return new jsdom(scenario.markup, opts);
  }

  return new jsdom(`<!doctype html><html><body>${scenario.markup}</body></html>`, opts);
}

let nextEvalArgId = 1;

type JsdomLocator = {
  focus(): Promise<void>;
  hover(): Promise<void>;
  evaluate<T>(fn: (el: Element) => T | Promise<T>): Promise<Awaited<T>>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<Awaited<T>>;
};

type JsdomPage = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<Awaited<T>>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<Awaited<T>>;
  locator(selector: string): JsdomLocator;
  goto(url: string): Promise<void>;
  mouse: {
    move(x: number, y: number): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
  };
};

function createJsdomPage(dom: JsdomInst): JsdomPage {
  let hovered: Element | null = null;
  let active: Element | null = null;
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    async evaluate(fn: Function, arg?: unknown) {
      const win = dom.window;
      const argKey = `__selectletEvalArg${nextEvalArgId++}`;

      win[argKey] = arg;
      try {
        return await win.eval(`(${fn.toString()})(window.${argKey})`);
      } finally {
        delete win[argKey];
      }
    },

    locator(selector: string) {
      return {
        focus() {
          const el = dom.window.document.querySelector(selector);
          if (!isHTMLElement(el)) {
            throw new Error(`locator(${selector}).focus(): element not found or not HTMLElement`);
          }
          el.focus();
          return Promise.resolve();
        },

        hover() {
          const el = dom.window.document.querySelector(selector);
          if (!el) {
            throw new Error(`locator(${selector}).hover(): element not found`);
          }

          if (hovered && hovered !== el) {
            fireHoverOut(hovered);
          }

          fireHoverIn(el);
          hovered = el;
          return Promise.resolve();
        },

        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        async evaluate(fn: Function) {
          const win = dom.window;
          const el = dom.window.document.querySelector(selector);

          if (!el) {
            throw new Error(`locator(${selector}).evaluate(): element not found`);
          }

          const argKey = `__selectletEvalArg${nextEvalArgId++}`;
          win[argKey] = el;

          try {
            return await win.eval(`(${fn.toString()})(window.${argKey})`);
          } finally {
            delete win[argKey];
          }
        },
      };
    },

    goto(url: string) {
      dom.reconfigure({ url });
      return Promise.resolve();
    },

    mouse: {
      move() {
        if (active) {
          fireRelease(active);
          active = null;
        }

        if (hovered) {
          fireHoverOut(hovered);
          hovered = null;
        }

        return Promise.resolve();
      },

      down() {
        if (hovered) {
          active = hovered;
          firePress(active);
        }

        return Promise.resolve();
      },

      up() {
        if (active) {
          fireRelease(active);
          active = null;
        }

        return Promise.resolve();
      },
    },
  };

  function mouseEvent(type: string, bubbles = true, buttons = 0) {
    return new dom.window.MouseEvent(type, {
      bubbles,
      button: 0,
      buttons,
    });
  }

  function firePress(el: Element) {
    el.dispatchEvent(mouseEvent('pointerdown', true, 1));
    el.dispatchEvent(mouseEvent('mousedown', true, 1));
  }

  function fireRelease(el: Element) {
    el.dispatchEvent(mouseEvent('pointerup', true, 0));
    el.dispatchEvent(mouseEvent('mouseup', true, 0));
  }

  function fireHoverIn(el: Element) {
    el.dispatchEvent(mouseEvent('pointerover'));
    el.dispatchEvent(mouseEvent('mouseover'));
    el.dispatchEvent(mouseEvent('pointerenter', false));
    el.dispatchEvent(mouseEvent('mouseenter', false));
  }

  function fireHoverOut(el: Element) {
    el.dispatchEvent(mouseEvent('pointerout'));
    el.dispatchEvent(mouseEvent('mouseout'));
    el.dispatchEvent(mouseEvent('pointerleave', false));
    el.dispatchEvent(mouseEvent('mouseleave', false));
  }
}


function assertExpectation(label: string, nodes: Element[], threw: boolean, e: TestCase['expect'], thrownError: unknown) {
  if (threw) {
    if (e?.throws) return;
    throw new Error(`Unexpected error for ${label}: ${thrownMessage(thrownError)}`);
  }

  if (e?.throws) {
    throw new Error(`Expected throw for ${label}, but no error was thrown`);
  }

  const ids = nodes.map((e) => e.id);
  const classNames = nodes.map((e) => e.className);
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

function thrownMessage(err: unknown) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function runCase(document: Document, info: CaseInfo) {
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

  assertExpectation(caseQuery(c), nodes, threw, c.expect, thrown);
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

function formatCaseHeader(info: CaseInfo): string {
  const c = info.case;

  return [
    `${info.scenario.name}`,
    `Step #${info.stepIndex + 1}, Case #${info.caseIndex + 1}`,
    `Query: ${caseQuery(c)}`,
    `Context: ${refLabel(caseRef(c))}`,
  ].join('\n');
}

type QueryContext = Document | Element | DocumentFragment;

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

function isHtmlDoc(doc: Document): doc is HTMLDocument {
  return doc.contentType.includes('/html') === true;
}

function isHTMLElement(el: Element | null): el is HTMLElement {
  return !!el && el.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

function cssEscape(ident: string): string {
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

function installSelectletShim(dom: JsdomInst): void {
  const win = dom.window as JsdomMod.DOMWindow & { selectlet?: unknown; };

  win.selectlet ??= {
    configure() {
      // no-op: jsdom backend is already fixed for this harness run
    },
    snapshot: {
      hasDocumentAll: true,
      hasTreeWalker: true,
    },
  };
}

function hydrateDeclarativeShadowRoots(doc: Document): void {
  for (const tmpl of doc.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]')) {
    const host = tmpl.parentElement;
    if (!host) continue;

    const mode = tmpl.getAttribute('shadowrootmode');
    if (mode !== 'open' && mode !== 'closed') continue;

    const root = host.attachShadow({ mode });
    root.append(...tmpl.content.childNodes);
    tmpl.remove();
  }
}

function patchComputedStyleForPseudoElements(dom: JsdomInst): void {
  const win = dom.window;
  const realGetComputedStyle = win.getComputedStyle.bind(win);

  win.getComputedStyle = ((elt: Element, pseudoElt?: string | null) => {
    if (!pseudoElt) return realGetComputedStyle(elt);

    const pseudo = pseudoElt.replace(/^::?/, '');
    if (
      pseudo !== 'before' &&
      pseudo !== 'after' &&
      pseudo !== 'first-letter' &&
      pseudo !== 'first-line'
    ) {
      return { content: 'none', getPropertyValue: () => '' };
    }

    const props = findPseudoDeclarations(win.document, elt, pseudo);

    return new Proxy({
      content: props.get('content') ?? 'none',
      getPropertyValue(name: string) {
        const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        return props.get(name) ?? props.get(kebab) ?? '';
      },
    }, {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in target) return target[prop as keyof typeof target];

        const kebab = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        return props.get(prop) ?? props.get(kebab) ?? '';
      },
    }) as CSSStyleDeclaration;
  }) as typeof win.getComputedStyle;
}

function findPseudoDeclarations(doc: Document, elt: Element, pseudo: string): Map<string, string> {
  const props = new Map<string, string>();
  if (!elt.id) return props;

  const escapedId = elt.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `#${escapedId}\\s*:{1,2}${pseudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'gi',
  );

  for (const style of doc.querySelectorAll('style')) {
    const css = style.textContent ?? '';

    for (let m = re.exec(css); m; m = re.exec(css)) {
      for (const decl of m[1].split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;

        const name = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).trim();

        if (name) props.set(name, value);
      }
    }
  }

  return props;
}
