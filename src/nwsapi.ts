import { describeContext, describeElement } from "./debug";
import { buildRex } from "./rex";
import { DEFAULT_EXTENSIONS, initSnapshot } from "./snapshot";
import { toNodeList } from "./utils/collections";
import { isElement, isIFrame, isNode, isText } from "./utils/dom";

export function Factory(fGlobal: Glob, fExport: Function): DomApi {
  const _doc = fGlobal.document;
  const _snap = initSnapshot(_doc);

  // handlers needed for the :hover pseudo-class; track state change in browsers and headless
  _doc.addEventListener('mouseover', (e) => {
    if (!isNode(e.target)) return;
    _snap.hoverTarget = isElement(e.target) ? e.target : null;
  }, true);
  _doc.addEventListener('mouseout', () => { _snap.hoverTarget = null; }, true);

  // Track pointer-down state for :active. This approximates native activation for common HTML activatable/focusable elements;
  // full formal activation state is browser-internal and not modeled here.
  _doc.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (!isNode(target)) return;
    _snap.activeTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  }, true);
  _doc.addEventListener('pointerup', () => { _snap.activeTarget = null; }, true);
  _doc.addEventListener('pointercancel', () => { _snap.activeTarget = null; }, true);

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

  // QSA placeholders to native references
  const _qsaStore: Partial<Record<QsaKey, any>> = {};
  const _qsaHooks: { type: string, listener: EventListenerOrEventListenerObject }[] = [];

  // public exported methods/objects
  const Dom: DomApi = {
    // Version, Config, CFG, Snapshot -- previous names
    version: 'nwsapi-__VERSION__',
    config: _snap.config,
    extensions: _snap.ext,
    snapshot: _snap,

    // exported engine methods
    byId(id, ctx) {
      return _snap.byId(id, ctx);
    },

    byTag(tag, ctx) {
      const result = _snap.byTag(tag, ctx);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    byTagNs(ns, local, ctx) {
      const result = _snap.byTagNs(ns, local, ctx);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    byClass(cls, ctx) {
      const result = _snap.byClass(cls, ctx);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    first(sel, ctx) {
      return _snap.first(sel, ctx, true /* isApiEntry */);
    },

    match(sel, ctx) {
      return _snap.match(sel, ctx);
    },

    select(sel, ctx, cb) {
      const result = _snap.select(sel, ctx, cb ?? null, true /* isApiEntry */);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    closest(sel, el) {
      return _snap.ancestor(sel, el);
    },

    // configure the engine to use special handling
    configure(opt?: ConfigKey | Partial<Record<string, boolean>> | null, clear = false) {
      if (opt == null) return _snap.config;

      if (typeof opt === 'string') {
        return opt in _snap.config ? !!_snap.config[opt as ConfigKey] : false;
      }

      if (typeof opt !== 'object') {
        throw new TypeError('Invalid configuration argument');
      }

      for (const k in opt) {
        // only allow known config keys to be set; ignore others
        if (k in _snap.config) {
          _snap.config[k as ConfigKey] = !!opt[k];
        }
      }

      if (clear) {
        for (const k in _snap.matchLambdas) delete _snap.matchLambdas[k];
        for (const k in _snap.selectLambdas) delete _snap.selectLambdas[k];
        for (const k in _snap.strictMatchResolvers) delete _snap.strictMatchResolvers[k];
        for (const k in _snap.forgivingMatchResolvers) delete _snap.forgivingMatchResolvers[k];
        for (const k in _snap.selectResolvers) delete _snap.selectResolvers[k];
      }

      return true;
    },

    // overrides QSA methods (only for browsers)
    install(all?: boolean) {
      // ensure any previous overrides are removed before installing new ones
      Dom.uninstall();

      // save references
      _qsaStore.closest = Element.prototype.closest;
      _qsaStore.matches = Element.prototype.matches;

      _qsaStore.querySelector = Element.prototype.querySelector;
      _qsaStore.querySelectorAll = Element.prototype.querySelectorAll;

      _qsaStore.querySelectorDoc = Document.prototype.querySelector;
      _qsaStore.querySelectorAllDoc = Document.prototype.querySelectorAll;

      function parseQSArgs(this: QueryContext, ...args: any[]) {
        const method = args[args.length - 1];
        if (args.length < 2) return method.apply(this, []);
        if (args.length < 3) return method.apply(this, [args[0], this]);
        const args1 = typeof args[1] === 'function' ? args[1] : undefined
        return method.apply(this, [args[0], this, args1]);
      }

      Element.prototype.closest =
      HTMLElement.prototype.closest =
        function closest(this: Element, ...args: any[]) {
          return parseQSArgs.apply(this, [...args, Dom.closest]);
        };

      Element.prototype.matches =
      HTMLElement.prototype.matches =
        function matches(this: Element, ...args: any[]) {
          return parseQSArgs.apply(this, [...args, Dom.match]);
        } as Element['matches'];

      Element.prototype.querySelector =
      HTMLElement.prototype.querySelector =
        function querySelector(this: Element, ...args: any[]) {
          return parseQSArgs.apply(this, [...args, Dom.first]);
        };

      Element.prototype.querySelectorAll =
      HTMLElement.prototype.querySelectorAll =
        function querySelectorAll(this: Element, ...args: any[]) {
          return parseQSArgs.apply(this, [...args, Dom.select]);
        };

      Document.prototype.querySelector =
      DocumentFragment.prototype.querySelector =
        function querySelector(this: QueryContext, ...args: any[]) {
          return parseQSArgs.apply(this, [...args, Dom.first]);
        };

      Document.prototype.querySelectorAll =
      DocumentFragment.prototype.querySelectorAll =
        function querySelectorAll(this: QueryContext, ...args: any[]) {
          return parseQSArgs.apply(this, [...args, Dom.select]);
      };

      if (all) {
        const fn = function(this: Document, e: Event) {
          const evTarget = e.target;
          if (!isNode(evTarget) || !isElement(evTarget) || !isIFrame(evTarget)) return;

          const iife = '(' + fExport + ')(this, ' + Factory + ');';
          const doc = evTarget.ownerDocument;
          const script = doc.createElement('script');
          script.textContent = iife + 'NW.Dom.install(true)';
          const root = doc.documentElement;
          root.removeChild(root.insertBefore(script, root.firstChild));
        }
        _doc.addEventListener('load', fn, true);
        _qsaHooks.push({ type: 'load', listener: fn });
      }
    },

    // restore QSA methods (only for browsers)
    uninstall() {
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
      for (let k in _qsaStore) delete _qsaStore[k as QsaKey];
      for (let o of _qsaHooks) {
        _doc.removeEventListener(o.type, o.listener, true);
      }
      _qsaHooks.length = 0;
    },

    // register a new selector combinator symbol and its related function resolver
    registerCombinator(combinator: string, compiler: CombinatorCompiler) {
      if ([...combinator].length !== 1) throw new Error('Invalid combinator: ' + combinator);
      if (typeof compiler !== 'function') throw new Error('Invalid combinator resolver for: ' + combinator);
      if (DEFAULT_EXTENSIONS.combinators.includes(combinator)) {
        throw new Error(`Cannot override default combinator: '${combinator}'`);
      }

      if (!_snap.ext.combinators.includes(combinator)) {
        _snap.ext.combinators.push(combinator);
        _snap.combinators[combinator] = compiler;
        _snap.re = buildRex(_snap.ext);
      } else {
        console.warn(`Warning: the '${combinator}' combinator is already registered.`);
      }
    },

    // register a new attribute operator symbol and its related function resolver
    // NW.Dom.registerOperator( '!=', { p1: '^', p2: '$', p3: 'false' } );
    registerOperator(operator: string, resolver: AttrMatcherParts) {
      if (!operator || !operator.includes('=')) throw new Error('Invalid operator: ' + operator);

      if (!_snap.ext.operators.includes(operator) && !_snap.operators[operator]) {
        _snap.ext.operators.push(operator);
        _snap.operators[operator] = resolver;
        _snap.re = buildRex(_snap.ext);
      } else {
        console.warn(`Warning: the '${operator}' operator is already registered.`);
      }
    },

    // register a new selector symbol and its related function resolver
    registerSelector(name: string, rexp: RegExp, func: SelectorExtFn) {
      _snap.selectors[name] = {
        Expression: rexp,
        Callback: func,
      };
    },

    // debugging utilities used in testing and development
    setDebug(enabled: boolean) {
      _snap.isDebug = enabled;
      if (enabled) Dom.clearDebug();
    },

    clearDebug() {
      _snap.debugSelect = undefined;
      _snap.debugMatch = undefined;
    },

    printDebug() {
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

  return Dom;
}
