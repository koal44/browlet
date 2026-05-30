import { Snapshot } from './snapshot';
import { toNodeList } from './utils/collections';
import { isElement, isNode, isText } from './utils/dom';

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
   * Faster for DocumentFragment/template contexts, but observable by mutation
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

export type Selectlet = {
  version: string;

  byId(id: string, ctx?: QueryContext): Element | null;
  byTag(tag: string, ctx?: QueryContext): ElementList;
  byTagNs(ns: string | null, local: string, ctx?: QueryContext): ElementList;
  byClass(cls: string, ctx?: QueryContext): ElementList;

  matches(sel: string, el: Element): boolean;
  select(sel: string, ctx?: QueryContext, cb?: SelectCallback | null): ElementList;
  first(sel: string, ctx?: QueryContext): Element | null;
  closest(sel: string, el: Element): Element | null;

  registerPseudo(name: string, predicate: CustomPseudoPredicate): void;
};

export type QueryContext = Document | Element | DocumentFragment;
export type SelectCallback = (element: Element) => boolean | void;
export type ElementList = Element[] | IndexedNodeList;
export type IndexedNodeList = NodeListOf<Element> & { length: number; [index: number]: Element; };

export type SelectletConfig = typeof DEFAULT_CONFIG;
export type ConfigKey = keyof SelectletConfig;

export type SelectletOptions = {
  config?: Partial<SelectletConfig>;
  caps?: SelectletCaps;
};

export type SelectletCaps<
  E extends Element = Element,
  D extends Document = Document,
  F extends DocumentFragment = DocumentFragment,
> = {
  doc?: DocumentCaps<E, D>;
  frag?: FragmentCaps<E, F>;
};

export type DocumentCaps<E extends Element, D extends Document> = {
  cachedIds?: (doc: D, id: string) => Iterable<E>;
  cachedClasses?: (doc: D, classes: readonly string[]) => Iterable<E>;
  designMode?: (doc: D) => string | undefined;
};

export type FragmentCaps<E extends Element, F extends DocumentFragment> = {
  cachedIds?: (frag: F, id: string) => Iterable<E>;
  cachedClasses?: (frag: F, classes: readonly string[]) => Iterable<E>;
};

export type CustomPseudoPredicate = (element: Element) => boolean;

export function createSelectlet(doc: Document, opts: SelectletOptions = {}): Selectlet {
  const _doc = doc;
  const _snap = new Snapshot(_doc, { ...DEFAULT_CONFIG, ...opts.config }, opts.caps);

  installDynamicPseudoState(_doc, _snap);

  const api = {
    version: 'selectlet-__VERSION__',
    snapshot: _snap,

    // ---------------------------------------------------------------------
    // Fast lookup helpers
    // ---------------------------------------------------------------------

    byId(id: string, ctx?: QueryContext): Element | null {
      return _snap.byId(id, ctx);
    },

    byTag(tag: string, ctx?: QueryContext): ElementList {
      const result = _snap.byTag(tag, ctx);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    byTagNs(ns: string | null, local: string, ctx?: QueryContext): ElementList {
      const result = _snap.byTagNs(ns, local, ctx);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    byClass(cls: string, ctx?: QueryContext): ElementList {
      const result = _snap.byClass(cls, ctx);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    // ---------------------------------------------------------------------
    // Selector API
    // ---------------------------------------------------------------------

    matches(sel: string, el: Element): boolean {
      return _snap.matches(sel, el);
    },

    select(sel: string, ctx?: QueryContext, cb?: SelectCallback | null): ElementList {
      const result = _snap.select(sel, ctx, cb ?? null, true /* isApiEntry */);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    first(sel: string, ctx?: QueryContext): Element | null {
      return _snap.first(sel, ctx, true /* isApiEntry */);
    },

    closest(sel: string, el: Element): Element | null {
      return _snap.closest(sel, el);
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

      if (key in _snap) {
        throw new Error(`Cannot register built-in pseudo-class :${key}`);
      }

      _snap.pseudos[key] = predicate;
      _snap.clearCache();
    },

  };

  _snap.update(_doc);

  return api;
}

function installDynamicPseudoState(doc: Document, snap: Snapshot): void {
  // activeElement can fall back to body/html even when no element actually
  // matches :focus, so track real focus events separately.
  doc.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!isNode(target)) return;
    snap.focusTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  }, true);

  doc.addEventListener('focusout', (e) => {
    const target = e.target;
    if (!isNode(target)) return;

    const el = isElement(target) ? target : isText(target) ? target.parentElement : null;
    if (snap.focusTarget === el) snap.focusTarget = null;
  }, true);

  const setHoverTarget = (e: Event) => {
    const target = e.target;
    if (!isNode(target)) return;
    snap.hoverTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  };

  const clearHoverTarget = () => {
    snap.hoverTarget = null;
  };

  const setActiveTarget = (e: Event) => {
    const target = e.target;
    if (!isNode(target)) return;
    snap.activeTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  };

  const clearActiveTarget = () => {
    snap.activeTarget = null;
  };

  doc.addEventListener('mouseover', setHoverTarget, true);
  doc.addEventListener('pointerover', setHoverTarget, true);
  doc.addEventListener('mouseout', clearHoverTarget, true);
  doc.addEventListener('pointerout', clearHoverTarget, true);

  doc.addEventListener('mousedown', setActiveTarget, true);
  doc.addEventListener('pointerdown', setActiveTarget, true);
  doc.addEventListener('mouseup', clearActiveTarget, true);
  doc.addEventListener('pointerup', clearActiveTarget, true);
  doc.addEventListener('pointercancel', clearActiveTarget, true);
}
