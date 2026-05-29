import { describeContext, describeElement } from './debug';
import { Snapshot } from './snapshot';
import { toNodeList } from './utils/collections';
import { isDocument, isElement, isNode, isText } from './utils/dom';

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

export type InstallGlobal = (global: typeof globalThis, createSelectlet: unknown) => unknown;

export function createSelectlet(
  global: typeof globalThis,
  // installGlobal: InstallGlobal,
  doc: Document = global.document,
  opts: SelectletOptions = {},
) {
  const _doc = isDocument(doc) ? doc : global.document;
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

  // QSA placeholders to native references
  type QsaStore = {
    closest: Element['closest'];
    matches: Element['matches'];
    querySelector: Element['querySelector'];
    querySelectorAll: Element['querySelectorAll'];
    querySelectorDoc: Document['querySelector'];
    querySelectorAllDoc: Document['querySelectorAll'];
  };
  const _qsaStore: Partial<QsaStore> = {};
  // const _qsaStore: Partial<Record<QsaKey, any>> = {};
  const _qsaHooks: { type: string; listener: EventListenerOrEventListenerObject; }[] = [];

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

    configure(opt: Partial<Record<ConfigKey, boolean>>): void {
      for (const k in opt) {
        // only allow known config keys to be set; ignore others
        if (k in _snap.config) {
          _snap.config[k as ConfigKey] = !!opt[k as ConfigKey];
        }
      }
    },

    clearCache(): void {
      _snap.clearCache();
    },

    // overrides QSA methods (only for browsers)
    install(_all?: boolean): void {
      // ensure any previous overrides are removed before installing new ones
      api.uninstall();

      // save references
      /* eslint-disable @typescript-eslint/unbound-method */
      _qsaStore.closest = Element.prototype.closest;
      _qsaStore.matches = Element.prototype.matches;

      _qsaStore.querySelector = Element.prototype.querySelector;
      _qsaStore.querySelectorAll = Element.prototype.querySelectorAll;

      _qsaStore.querySelectorDoc = Document.prototype.querySelector;
      _qsaStore.querySelectorAllDoc = Document.prototype.querySelectorAll;
      /* eslint-enable @typescript-eslint/unbound-method */

      Element.prototype.closest =
        HTMLElement.prototype.closest =
          function closest(this: Element, selector: string): Element | null {
            return _snap.ancestor(selector, this);
          };

      Element.prototype.matches =
        HTMLElement.prototype.matches =
          function matches(this: Element, selector: string): boolean {
            return _snap.match(selector, this);
          } as Element['matches'];

      Element.prototype.querySelector =
        HTMLElement.prototype.querySelector =
          function querySelector(this: Element, selector: string): Element | null {
            return _snap.first(selector, this, true);
          };

      Element.prototype.querySelectorAll =
        HTMLElement.prototype.querySelectorAll =
          function querySelectorAll(this: Element, selector: string): NodeListOf<Element> {
            return toNodeList(_snap.select(selector, this, null, true), _snap.doc);
          };

      Document.prototype.querySelector =
        DocumentFragment.prototype.querySelector =
          function querySelector(this: QueryContext, selector: string): Element | null {
            return _snap.first(selector, this, true);
          };

      Document.prototype.querySelectorAll =
        DocumentFragment.prototype.querySelectorAll =
          function querySelectorAll(this: QueryContext, selector: string): NodeListOf<Element> {
            return toNodeList(_snap.select(selector, this, null, true), _snap.doc);
          };

      // if (all) {
      //   const fn = function(this: Document, e: Event) {
      //     const evTarget = e.target;
      //     if (!isNode(evTarget) || !isElement(evTarget) || !isIFrame(evTarget)) return;

      //     const iife = `(${String(installGlobal)})(this, ${String(createSelectlet)});`;
      //     const doc = evTarget.ownerDocument;
      //     const script = doc.createElement('script');
      //     script.textContent = iife + 'selectlet.install(true)';
      //     const root = doc.documentElement as Element | null;
      //     root?.removeChild(root.insertBefore(script, root.firstChild));
      //   };
      //   _doc.addEventListener('load', fn, true);
      //   _qsaHooks.push({ type: 'load', listener: fn });
      // }
    },

    // restore QSA methods (only for browsers)
    uninstall(): void {
      // restore references
      if (_qsaStore.closest) {
        Element.prototype.closest = _qsaStore.closest;
        HTMLElement.prototype.closest = _qsaStore.closest;
      }
      if (_qsaStore.matches) {
        Element.prototype.matches = _qsaStore.matches;
        HTMLElement.prototype.matches = _qsaStore.matches;
      }
      if (_qsaStore.querySelector) {
        Element.prototype.querySelector =
          HTMLElement.prototype.querySelector = _qsaStore.querySelector;
      }
      if (_qsaStore.querySelectorAll) {
        Element.prototype.querySelectorAll =
          HTMLElement.prototype.querySelectorAll = _qsaStore.querySelectorAll;
      }
      if (_qsaStore.querySelectorDoc) {
        Document.prototype.querySelector =
          DocumentFragment.prototype.querySelector = _qsaStore.querySelectorDoc;
      }
      if (_qsaStore.querySelectorAllDoc) {
        Document.prototype.querySelectorAll =
          DocumentFragment.prototype.querySelectorAll = _qsaStore.querySelectorAllDoc;
      }
      for (const k in _qsaStore) delete _qsaStore[k as keyof QsaStore];
      for (const o of _qsaHooks) {
        _doc.removeEventListener(o.type, o.listener, true);
      }
      _qsaHooks.length = 0;
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

export type Selectlet = ReturnType<typeof createSelectlet>;
