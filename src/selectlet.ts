import { describeContext, describeElement } from './debug';
import { Snapshot } from './snapshot';
import { toNodeList } from './utils/collections';
import { isElement, isNode, isText } from './utils/dom';

export const DEFAULT_CONFIG = {
  // When enabled, methods that return multiple elements will return a
  // NodeList-like object instead of an array.
  NODE_LIST: false,

  // Allows duplicate-ID candidate lookup to temporarily remove and restore id
  // attributes in contexts where no fast id collection is available.
  // Faster for DocumentFragment/template contexts, but observable by mutation
  // observers and other DOM-inspection code. Disabled by default.
  MUTATE_IDS: false,
};

export type SelectletConfig = typeof DEFAULT_CONFIG;
export type ConfigKey = keyof SelectletConfig;
export type CustomPseudoPredicate = (element: Element) => boolean;
export type IndexedNodeList = NodeListOf<Element> & { length: number; [index: number]: Element; };
export type ElementList = Element[] | IndexedNodeList;

export function createSelectlet(doc: Document, opts: SelectletOptions = {}) {
  const _doc = doc;
  const _snap = new Snapshot(_doc, { ...DEFAULT_CONFIG, ...opts.config }, opts.caps);

  // handlers needed for the :focus pseudo-class; activeElement can fall back to body/html
  // even when no element actually matches :focus.
  _doc.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!isNode(target)) return;
    _snap.focusTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  }, true);

  _doc.addEventListener('focusout', (e) => {
    const target = e.target;
    if (!isNode(target)) return;
    const el = isElement(target) ? target : isText(target) ? target.parentElement : null;
    if (_snap.focusTarget === el) _snap.focusTarget = null;
  }, true);

  const setHoverTarget = (e: Event) => {
    const target = e.target;
    if (!isNode(target)) return;
    _snap.hoverTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  };

  const clearHoverTarget = () => {
    _snap.hoverTarget = null;
  };

  const setActiveTarget = (e: Event) => {
    const target = e.target;
    if (!isNode(target)) return;
    _snap.activeTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  };

  const clearActiveTarget = () => {
    _snap.activeTarget = null;
  };

  // :hover and :active state tracking
  _doc.addEventListener('mouseover', setHoverTarget, true);
  _doc.addEventListener('pointerover', setHoverTarget, true);
  _doc.addEventListener('mouseout', clearHoverTarget, true);
  _doc.addEventListener('pointerout', clearHoverTarget, true);

  _doc.addEventListener('mousedown', setActiveTarget, true);
  _doc.addEventListener('pointerdown', setActiveTarget, true);
  _doc.addEventListener('mouseup', clearActiveTarget, true);
  _doc.addEventListener('pointerup', clearActiveTarget, true);
  _doc.addEventListener('pointercancel', clearActiveTarget, true);

  // public exported methods/objects
  const api = {
    version: 'selectlet-__VERSION__',
    snapshot: _snap,

    // exported engine methods
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

    first(sel: string, ctx?: QueryContext): Element | null {
      return _snap.first(sel, ctx, true /* isApiEntry */);
    },

    match(sel: string, el: Element): boolean {
      return _snap.match(sel, el);
    },

    select(sel: string, ctx?: QueryContext, cb?: QueryCallback | null): ElementList {
      const result = _snap.select(sel, ctx, cb ?? null, true /* isApiEntry */);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    closest(sel: string, el: Element): Element | null {
      return _snap.ancestor(sel, el);
    },

    clearCache(): void {
      _snap.clearCache();
    },

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
      _snap.strictMatchResolvers.clear();
      _snap.selectResolvers.clear();
      _snap.matchLambdas.clear();
      _snap.selectLambdasNoCb.clear();
      _snap.selectLambdasWithCb.clear();
    },

    // debugging utilities used in testing and development
    setDebug(enabled: boolean): void {
      _snap.isDebug = enabled;
      if (enabled) api.clearDebug();
    },

    clearDebug(): void {
      _snap.debugSelect = undefined;
      _snap.debugMatch = undefined;
    },

    printDebug(): string {
      const docDesc = describeContext(_snap.doc);
      const fromDesc = describeContext(_snap.from);
      return JSON.stringify({
        snapshot: {
          isHtml: _snap.isHtml,
          isQuirksMode: _snap.isQuirksMode,
          namespace: _snap.namespace,
          doc: docDesc,
          from: _snap.from === _snap.doc ? '(same as doc)' : fromDesc,
          scopeEl: _snap.scopeEl ? describeElement(_snap.scopeEl) : null,
          root: { summary: describeElement(_snap.root) },
        },
        debugStack: _snap.debugStack,
      }, null, 2);
    },

  };

  _snap.update(_doc);

  return api;
}
