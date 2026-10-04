import { SelectletContext } from './context';
import { createSelectletEnvironment, type SelectletEnvironment } from './environment';
import { toNodeList, type IndexedNodeList } from './node-list';
import type {
  DOMOperations, DOMNode, DOMElement, DOMDocument, DOMDocumentFragment, DOMQueryRoot,
  StandardNode, StandardElement, StandardDocument, StandardDocumentFragment, StandardAttribute,
} from '../infra/index';

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

export type Selectlet<
  N extends object = StandardNode, E extends N = StandardElement & N,
  D extends N = StandardDocument & N, F extends N = StandardDocumentFragment & N,
> = {
  version: string;
  /** Query state and caches owned by this engine. */
  context: SelectletContext;
  byId(id: string, source?: D | E | F): E | null;
  byTag(tag: string, source?: D | E | F): ElementList<E>;
  byTagNs(ns: string | null, local: string, source?: D | E | F): ElementList<E>;
  byClass(cls: string, source?: D | E | F): ElementList<E>;
  matches(sel: string, el: E): boolean;
  select(sel: string, source?: D | E | F): ElementList<E>;
  first(sel: string, source?: D | E | F): E | null;
  closest(sel: string, el: E): E | null;
  registerPseudo(name: string, predicate: CustomPseudoPredicate<E>): void;
};

/** DOM container supplied to a selector query. */
export type QuerySource<
  D extends object = StandardDocument, E extends object = StandardElement, F extends object = StandardDocumentFragment,
> = D | E | F;
export type ElementList<E extends object = DOMElement> = E[] | IndexedNodeList<E>;
export type SelectletConfig = typeof DEFAULT_CONFIG;
export type ConfigKey = keyof SelectletConfig;

export type SelectletOptions<
  N extends object = DOMNode, E extends N = N & DOMElement, A extends object = object,
  D extends N = N & DOMDocument, F extends N = N & DOMDocumentFragment,
> = {
  /** Existing owner; takes precedence over the standalone dom option. */
  env?: SelectletEnvironment<N, E, A, D, F>;
  /** Operations for the supplied object graph; defaults to standard DOM objects. */
  dom?: DOMOperations<N, E, A, D, F>;
  /** Query result and cache configuration. */
  config?: Partial<SelectletConfig>;
  /** Adapt syntax errors at the host's API boundary. */
  errors?: SelectletErrorOptions;
};

export type SelectletErrorOptions = {
  /** Translate selector parser failures to the exception exposed by the host. */
  syntax?: (err: SyntaxError) => Error;
};
export type CustomPseudoPredicate<E extends object = DOMElement> = (element: E) => boolean;

/** Preserve the caller's concrete browser node types when using the standard adapter. */
export function createSelectlet<D extends StandardDocument>(
  doc: D,
  opts?: SelectletOptions<
    StandardNodeOf<D>, StandardElementOf<D>, StandardAttribute, D & StandardNodeOf<D>, StandardFragmentOf<D>
  >,
): Selectlet<StandardNodeOf<D>, StandardElementOf<D>, D & StandardNodeOf<D>, StandardFragmentOf<D>>;
export function createSelectlet<N extends object, E extends N, A extends object, D extends N, F extends N>(
  doc: NoInfer<D>, opts: SelectletOptions<N, E, A, D, F>,
): Selectlet<N, E, D, F>;
export function createSelectlet(
  doc: DOMDocument, opts: SelectletOptions = {},
): Selectlet<DOMNode, DOMElement, DOMDocument, DOMDocumentFragment> {
  const ctx = new SelectletContext(doc, { ...DEFAULT_CONFIG, ...opts.config }, opts.errors, createSelectletEnvironment(opts));

  installDynamicPseudoState(doc, ctx);

  const api = {
    version: 'selectlet-__VERSION__',
    context: ctx,

    // ---------------------------------------------------------------------
    // Fast lookup helpers
    // ---------------------------------------------------------------------

    byId(id: string, source?: DOMQueryRoot): DOMElement | null {
      return ctx.byId(id, source);
    },

    byTag(tag: string, source?: DOMQueryRoot): ElementList {
      const result = ctx.byTag(tag, source);
      return ctx.config.NODE_LIST ? toNodeList(result) : result;
    },

    byTagNs(ns: string | null, local: string, source?: DOMQueryRoot): ElementList {
      const result = ctx.byTagNs(ns, local, source);
      return ctx.config.NODE_LIST ? toNodeList(result) : result;
    },

    byClass(cls: string, source?: DOMQueryRoot): ElementList {
      const result = ctx.byClass(cls, source);
      return ctx.config.NODE_LIST ? toNodeList(result) : result;
    },

    // ---------------------------------------------------------------------
    // Selector API
    // ---------------------------------------------------------------------

    matches(sel: string, el: DOMElement): boolean {
      return ctx.matches(sel, el);
    },

    select(sel: string, source?: DOMQueryRoot): ElementList {
      return ctx.select(sel, source);
    },

    first(sel: string, source?: DOMQueryRoot): DOMElement | null {
      return ctx.first(sel, source);
    },

    closest(sel: string, el: DOMElement): DOMElement | null {
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

function installDynamicPseudoState(doc: DOMDocument, ctx: SelectletContext): void {
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

// Infer the caller's node types from its document methods without importing lib.dom.
// A browser Document supplies Node, Element, and DocumentFragment, preserving members
// beyond the standard adapter's minimal views. The intersections express that elements
// and fragments also belong to that document's node type.
type StandardNodeOf<D extends StandardDocument> = ReturnType<D['getRootNode']>;
type StandardElementOf<D extends StandardDocument> =
  NonNullable<ReturnType<D['getElementsByTagName']>[number]> & StandardNodeOf<D>;
type StandardFragmentOf<D extends StandardDocument> =
  ReturnType<D['createDocumentFragment']> & StandardNodeOf<D>;
