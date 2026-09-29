import { SelectletContext } from './context';
import { createSelectletEnvironment, type SelectletEnvironment } from './environment';
import { toNodeList, type IndexedNodeList } from './node-list';
import type { DOMOperations, DOMNode } from '../infra/index';

export const DEFAULT_CONFIG = {
  /**
   * When enabled, methods that return multiple elements return a NodeList-like
   * object instead of a plain array.
   */
  NODE_LIST: false,

  /**
   * Allows duplicate-ID lookup fallback code to temporarily remove and restore
   * id attributes when no fast id collection is available.
   *
   * Faster for DocumentFragment/template sources, but observable by mutation
   * observers and other DOM-inspection code. Disabled by default.
   */
  MUTATE_IDS: false,

  /**
   * Soft upper bound for compiled selector and regex cache entries.
   *
   * The limit is checked only when new cached work is built. Caches may exceed
   * this value slightly during a query, then are cleared on a later cache miss.
   *
   * Set to 0 to disable automatic cache clearing.
   */
  CACHE_WATERMARK: 1024,
};

export type Selectlet<N extends object = Node, E extends N = Element & N> = {
  version: string;
  /** Query state and caches owned by this engine. */
  context: SelectletContext;
  byId(id: string, source?: N): E | null;
  byTag(tag: string, source?: N): ElementList<E>;
  byTagNs(ns: string | null, local: string, source?: N): ElementList<E>;
  byClass(cls: string, source?: N): ElementList<E>;
  matches(sel: string, el: E): boolean;
  select(sel: string, source?: N): ElementList<E>;
  first(sel: string, source?: N): E | null;
  closest(sel: string, el: E): E | null;
  registerPseudo(name: string, predicate: CustomPseudoPredicate<E>): void;
};

/** DOM container supplied to a selector query. */
export type QuerySource = Document | Element | DocumentFragment;
export type ElementList<E extends object = DOMNode> = E[] | IndexedNodeList<E>;
export type SelectletConfig = typeof DEFAULT_CONFIG;
export type ConfigKey = keyof SelectletConfig;

export type SelectletOptions<N extends object = DOMNode, E extends N = N, A extends object = object> = {
  /** Existing owner; takes precedence over the standalone dom option. */
  env?: SelectletEnvironment<N, E, A>;
  /** Operations for the supplied object graph; defaults to standard DOM objects. */
  dom?: DOMOperations<N, E, A>;
  /** Query result and cache configuration. */
  config?: Partial<SelectletConfig>;
  /** Adapt syntax errors at the host's API boundary. */
  errors?: SelectletErrorOptions;
};

export type SelectletErrorOptions = {
  /** Translate selector parser failures to the exception exposed by the host. */
  syntax?: (err: SyntaxError) => Error;
};
export type CustomPseudoPredicate<E extends object = DOMNode> = (element: E) => boolean;

export function createSelectlet(doc: Document, opts?: SelectletOptions<Node, Element, Attr>): Selectlet<Node, Element>;
export function createSelectlet<N extends object, E extends N, A extends object>(
  doc: NoInfer<N>, opts: SelectletOptions<N, E, A>,
): Selectlet<N, E>;
export function createSelectlet(doc: DOMNode, opts: SelectletOptions = {}): Selectlet<DOMNode, DOMNode> {
  const ctx = new SelectletContext(doc, { ...DEFAULT_CONFIG, ...opts.config }, opts.errors, createSelectletEnvironment(opts));

  installDynamicPseudoState(doc, ctx);

  const api = {
    version: 'selectlet-__VERSION__',
    context: ctx,

    // ---------------------------------------------------------------------
    // Fast lookup helpers
    // ---------------------------------------------------------------------

    byId(id: string, source?: DOMNode): DOMNode | null {
      return ctx.byId(id, source);
    },

    byTag(tag: string, source?: DOMNode): ElementList {
      const result = ctx.byTag(tag, source);
      return ctx.config.NODE_LIST ? toNodeList(result) : result;
    },

    byTagNs(ns: string | null, local: string, source?: DOMNode): ElementList {
      const result = ctx.byTagNs(ns, local, source);
      return ctx.config.NODE_LIST ? toNodeList(result) : result;
    },

    byClass(cls: string, source?: DOMNode): ElementList {
      const result = ctx.byClass(cls, source);
      return ctx.config.NODE_LIST ? toNodeList(result) : result;
    },

    // ---------------------------------------------------------------------
    // Selector API
    // ---------------------------------------------------------------------

    matches(sel: string, el: DOMNode): boolean {
      return ctx.matches(sel, el);
    },

    select(sel: string, source?: DOMNode): ElementList {
      return ctx.select(sel, source);
    },

    first(sel: string, source?: DOMNode): DOMNode | null {
      return ctx.first(sel, source);
    },

    closest(sel: string, el: DOMNode): DOMNode | null {
      return ctx.closest(sel, el);
    },

    // ---------------------------------------------------------------------
    // Extension API
    // ---------------------------------------------------------------------

    registerPseudo(name: string, predicate: CustomPseudoPredicate): void {
      if (typeof predicate !== 'function') {
        throw new TypeError('registerPseudo() requires a predicate function');
      }

      if (name.startsWith(':')) {
        throw new SyntaxError(`registerPseudo() expects a pseudo-class name without ":", got ${JSON.stringify(name)}`);
      }

      const key = name.toLowerCase();

      if (!/^-[\w-]+$|^[a-zA-Z_][\w-]*$/.test(name)) {
        throw new SyntaxError(`Invalid pseudo-class name ${JSON.stringify(name)}`);
      }

      if (key in ctx) {
        throw new Error(`Cannot register built-in pseudo-class :${key}`);
      }

      ctx.pseudos[key] = predicate;
      ctx.clearCache();
    },

  };

  ctx.update(doc);

  return api;
}

function installDynamicPseudoState(doc: DOMNode, ctx: SelectletContext): void {
  const dom = ctx.dom;
  const elementTarget = (target: DOMNode | null) => target === null ? null
    : dom.isElement(target) ? target : dom.isText(target) ? dom.parentElement(target) : null;

  // Document.activeElement may fall back to body/html without either matching :focus.
  dom.listen(doc, 'focusin', (target) => { ctx.focusTarget = elementTarget(target); });
  dom.listen(doc, 'focusout', (target) => {
    if (ctx.focusTarget === elementTarget(target)) ctx.focusTarget = null;
  });
  for (const type of ['mouseover', 'pointerover']) {
    dom.listen(doc, type, (target) => { ctx.hoverTarget = elementTarget(target); });
  }
  for (const type of ['mouseout', 'pointerout']) {
    dom.listen(doc, type, () => { ctx.hoverTarget = null; });
  }
  for (const type of ['mousedown', 'pointerdown']) {
    dom.listen(doc, type, (target) => { ctx.activeTarget = elementTarget(target); });
  }
  for (const type of ['mouseup', 'pointerup', 'pointercancel']) {
    dom.listen(doc, type, () => { ctx.activeTarget = null; });
  }
}
