import { get } from "node:http";
import { debug } from "node:util";

function Factory(fGlobal: Glob, fExport: Function): DomApi {
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

  updateSnapshot(_snap, _doc);

  return Dom;
}

export const DEFAULT_CONFIG: NwsConfig = {
  // When enabled, methods that return multiple elements will return a NodeList-like object instead of an array.
  NODE_LIST: false,

  // Allows duplicate-ID candidate lookup to temporarily remove and restore id
  // attributes in contexts where no fast id collection is available.
  // Faster for DocumentFragment/template contexts, but observable by mutation
  // observers and other DOM-inspection code. Disabled by default.
  MUTATE_IDS: false,
};

export const DEFAULT_EXTENSIONS: NwsExtensions = {
  operators: ['~=', '*=', '^=', '$=', '|=', '='],
  combinators: ['>', '+', '~', ' ', '\t'],
};

export function initSnapshot(doc: Document) {
  const snap = {
    doc: doc,
    from: doc as QueryContext,
    root: doc.documentElement as Element,
    scopeEl: null as Element | null,
    isHtml: isHtmlDoc(doc),
    isQuirksMode: isQuirksMode(doc),
    namespace: getNamespace(doc) as string | null,
    hasDocumentAll: 'all' in doc,
    hasTreeWalker: 'createTreeWalker' in doc,
    re: {} as Rex,

    isDebug: false,
    debugSelect: undefined as DebugSelect | undefined,
    debugMatch: undefined as DebugMatch | undefined,
    debugStack: [] as (DebugSelect | DebugMatch)[],

    // special handling configuration flags
    config: { ...DEFAULT_CONFIG } as NwsConfig,
    ext: {
      operators: [...DEFAULT_EXTENSIONS.operators],
      combinators: [...DEFAULT_EXTENSIONS.combinators],
    } as NwsExtensions,
    selectors: {} as Record<string, SelectorExtension>,
    combinators: {} as Record<string, CombinatorCompiler>,
    operators: {
      '=':  { p1: '^',       p2: '$',       p3: true },
      '^=': { p1: '^',       p2: '',        p3: true },
      '$=': { p1: '',        p2: '$',       p3: true },
      '*=': { p1: '',        p2: '',        p3: true },
      '|=': { p1: '^',       p2: '(-|$)',   p3: true },
      '~=': { p1: '(^|\\s)', p2: '(\\s|$)', p3: true },
    } as Record<string, AttrMatcherParts>,

    hoverTarget: null as EventTarget | null,
    activeTarget: null as EventTarget | null,
    focusTarget: null as EventTarget | null,

    // cached
    matchLambdas: {} as Partial<Record<string, MatchLambda>>,
    selectLambdas: {} as Partial<Record<string, SelectLambda>>,
    strictMatchResolvers: {} as Partial<Record<string, MatchResolver>>,
    forgivingMatchResolvers: {} as Partial<Record<string, MatchResolver>>,
    selectResolvers: {} as Partial<Record<string, SelectResolver>>,

    byId: (id: string, context?: QueryContext) => byId(id, context ?? snap.doc, snap),
    byTag: (tag: string, context?: QueryContext) => byTagRaw(tag, context ?? snap.doc, snap),
    byTagNs: (ns: string | null, local: string, context?: QueryContext) => byTagNsRaw(ns, local, context ?? snap.doc, snap),
    byClass: (cls: string, context?: QueryContext) => byClassRaw(cls, context ?? snap.doc, snap),
    first: (sel: string, context?: QueryContext, isApiEntry?: boolean) => {
      return firstRaw(sel, context ?? snap.doc, snap, isApiEntry);
    },
    match: (sel: string, context: Element, h: HashCache | null = null) => {
      return matchRaw(sel, context, snap, h);
    },
    select: (sel: string, context?: QueryContext, cb?: QueryCallback | null, isApiEntry?: boolean) => {
      return selectRaw(sel, context ?? snap.doc, cb ?? null, snap, isApiEntry);
    },
    ancestor: (sel: string, context: Element) => {
      return ancestorRaw(sel, context, snap);
    },

    matchStrict: (selectors: string, element: Element, h: HashCache | null = null) =>
      matchStrict(selectors, element, snap, h),
    matchForgiving: (selectors: string, element: Element, h: HashCache | null = null) =>
      matchForgiving(selectors, element, snap, h),

    isType: isType,
    nthOfType: nthOfType,
    nthElement: nthElement,
    isNthElement: isNthElement,
    isNthOfType: isNthOfType,
    matchHas: (steps: [SelectorCombinator, string][], anchor: Element, h: HashCache) => matchHasFrom(steps, 0, anchor, snap, h),
    matchDir: matchDir,
    matchLang: matchLang,
    defined: (element: Element) => isDefined(element, snap),
    isDisabled: isDisabled,
    isEnabled: isEnabled,
    isReadWrite: isReadWrite,
    isFormStateElement: isFormStateElement,
    isPlaceholderShown: isPlaceholderShown,
    isDefault: isDefault,
    isChecked: isChecked,
    isIndeterminate: isIndeterminate,
    isRequired: isRequired,
    isOptional: isOptional,
    isValid: isValid,
    isInvalid: isInvalid,
    isInRange: isInRange,
    isOutOfRange: isOutOfRange,
    isPlaying: isPlaying,
    isPaused: isPaused,
    isSeeking: isSeeking,
    isMuted: isMuted,
    hasAttr: (e: Element, anyNs: boolean, local: string, htmlLocal: string, hasColon: boolean): boolean =>
      hasAttr(e, anyNs, local, htmlLocal, hasColon, snap),
    matchAttribute: (e: Element, anyNs: boolean, name: string, htmlName: string, hasColonName: boolean, pattern: string, expected: string, htmlExpected: string, sensitivity: number) =>
      matchAttribute(e, anyNs, name, htmlName, hasColonName, pattern, expected, htmlExpected, sensitivity, snap),
    isFocused: (node: Element) =>
      isFocused(node, snap),

    regexCache: {} as Record<string, RegExp>,
    getCachedRegex: (source: string, flags: string) => getCachedRegex(source, flags, snap),

    probe: {
      select: 0,
      selBuild: 0,
      match: 0,
      matBuild: 0,
      reset: () => {
        snap.probe.select = 0;
        snap.probe.selBuild = 0;
        snap.probe.match = 0;
        snap.probe.matBuild = 0;
      }
    }
  };

  snap.re = buildRex(snap.ext);

  return snap;
}

export type Snapshot = ReturnType<typeof initSnapshot>;

function concatList(list: Element[], nodes: ArrayLike<Element>): Element[] {
  for (let i = 0, l = nodes.length; i < l; ++i) {
    list.push(nodes[i]);
  }
  return list;
}

// create a NodeList-like object from an element array
let emptyNL: NodeListOf<ChildNode> | undefined;
function toNodeList(nodeArray: Element[], doc: Document): IndexedNodeList {
  // create a DocumentFragment
  emptyNL ??= doc.createDocumentFragment().childNodes;

  // base an object on emptyNL
  const fakeNL = Object.create(emptyNL, {
    length: {
      value: nodeArray.length,
      enumerable: false
    },
    item: {
      value: function(i: string | number) {
        return this[+i || 0];
      },
      enumerable: false
    }
  });

  // copy the array elements
  nodeArray.forEach(function(v, i) { fakeNL[i] = v; });

  // return an object pretending to be a NodeList.
  return fakeNL;
}

function sortUnique(nodes: Element[]): Element[] {
  let hasDupes = false;

  nodes.sort((a, b) => {
    if (a === b) {
      hasDupes = true;
      return 0;
    }
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    return a.compareDocumentPosition(b) & 4 ? -1 : 1;
  });

  if (!hasDupes) return nodes;

  const list: Element[] = [];
  for (let i = 0, l = nodes.length; i < l; ++i) {
    if (i === 0 || nodes[i] !== nodes[i - 1]) list.push(nodes[i]);
  }

  return list;
}

function getNamespace(doc: Document): string | null {
  return doc.documentElement?.namespaceURI ?? null;
}

function updateSnapshot(snap: Snapshot, ctx: QueryContext, updateScope = false) {
  const doc = ctx.ownerDocument ?? ctx;

  if (snap.doc !== doc) {
    snap.doc = doc;
    snap.root = doc.documentElement;
    snap.isHtml = isHtmlDoc(doc);
    snap.isQuirksMode = isQuirksMode(doc);
    snap.namespace = getNamespace(doc);
    snap.hasDocumentAll = 'all' in doc;
    snap.hasTreeWalker = 'createTreeWalker' in doc;
  }

  // Debug breadcrumb only
  snap.from = ctx;

  if (updateScope) {
    snap.scopeEl = isDocument(ctx) ? ctx.documentElement : isElement(ctx) ? ctx : null;
  }
}

// convert single codepoint to string
export function stringFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ) {
    return "\ufffd";
  }
  return String.fromCodePoint(cp);
}

// convert escape sequence in a CSS string or identifier
// to javascript string with characters representations
export function cssIdentUnescape(str: string): string {
  return /\\/.test(str) ?
    str.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_match, escaped: string) => {
      if (/^[0-9a-fA-F]/.test(escaped)) {
        const codePoint = parseInt(escaped, 16);
        return codePoint === 0 ? '\uFFFD' : stringFromCodePoint(codePoint);
      }
      // CSS simple escape: backslash + non-hex char => that char.
      return escaped;
    }) :
    str;
}

export function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\-\\]/g, '\\$&');
}

function walkElements(context: QueryContext, visit: (e: Element) => boolean | void): void {
  let node: Element | null = context.firstElementChild;

  while (node) {
    if (visit(node) === false) return;

    if (node.firstElementChild) {
      node = node.firstElementChild;
      continue;
    }

    while (node && node !== context && !node.nextElementSibling) {
      node = node.parentElement;
    }

    node = node && node !== context ? node.nextElementSibling : null;
  }
}

function getCandidatesById(id: string, context: QueryContext, snap: Snapshot): Element[] {
  if (!id) return [];

  if (isDocument(context)) {  // Document
    if (snap.hasDocumentAll) return byId_All(id, context);
    if (snap.config.MUTATE_IDS) return byId_MutateInDoc(id, context);
  } else if (isElement(context)) {  // Element
    if (context.isConnected) {
      if (snap.hasDocumentAll) return byId_All(id, context);
      if (snap.config.MUTATE_IDS) return byId_MutateInEl(id, context);
    }
  } else {  // DocumentFragment
    if (snap.config.MUTATE_IDS) return byId_MutateInDoc(id, context);
  }

  return snap.hasTreeWalker ? byId_TreeWalk(id, context) : byId_Walk(id, context);
}

function byId_All(id: string, context: Document | Element): Element[] {
  // document.all only sees connected document-tree elements.
  // Detached elements, fragments, and template contents need local traversal.

  const isDoc = isDocument(context);

  let doc: Document;
  if (isDoc) {
    doc = context;
  } else {
    if (!context.isConnected) throw new Error('byId_All cannot be used on a disconnected element or fragment');
    doc = context.ownerDocument;
  }

  const item = doc.all.namedItem(id);
  if (item === null) return [];

  const nodes: Element[] = [];
  if (isNamedItemAnElement(item)) {  // Element
    const e = item;
    if (sameId(e, id) && (isDoc || (e !== context && context.contains(e)))) {
      nodes.push(e);
    }
  } else {  // HTMLCollection
    for (let i = 0; i < item.length; i++) {
      const e = item[i];
      if (sameId(e, id) && (isDoc || (e !== context && context.contains(e)))) {
        nodes.push(e);
      }
    }
  }

  return nodes;
}

function byId_MutateInDoc(id: string, context: Document | DocumentFragment): Element[] {
  const nodes: Element[] = [];

  try {
    for (;;) {
      const e = context.getElementById(id);
      if (!e) break;
      nodes.push(e);
      e.removeAttribute('id');
    }
  } finally {
    for (const e of nodes) e.setAttribute('id', id);
  }

  return nodes;
}

function byId_MutateInEl(id: string, context: Element): Element[] {
  if (!context.isConnected) {
    throw new Error('byId_MutateInEl cannot be used on a disconnected element');
  }

  const doc = context.ownerDocument;
  const nodes: Element[] = [];
  const mutated: Element[] = [];

  try {
    for (;;) {
      const e = doc.getElementById(id);
      if (!e) break;

      if (e !== context && context.contains(e)) {
        nodes.push(e);
      }
      e.removeAttribute('id');
      mutated.push(e);
    }
  } finally {
    for (const e of mutated) e.setAttribute('id', id);
  }

  return nodes;
}

function byId_Walk(id: string, context: QueryContext): Element[] {
  const nodes: Element[] = [];

  if (isDocument(context)) {
    const root = context.documentElement;
    if (sameId(root, id)) nodes.push(root);
    walk(root);
    return nodes;
  } else if (isElement(context)) {
    walk(context);
    return nodes;
  } else {  // DocumentFragment
    for (let root = context.firstElementChild; root; root = root.nextElementSibling) {
      if (sameId(root, id)) nodes.push(root);
      walk(root);
    }
    return nodes;
  }

  function walk(context: Element): void {
    let node: Element | null = context;
    let next: Element | null = context.firstElementChild;

    while ((node = next)) {
      if (sameId(node, id)) nodes.push(node);

      next = node.firstElementChild || node.nextElementSibling;
      if (next) continue;

      while (!next && (node = node.parentElement) && node !== context) {
        next = node.nextElementSibling;
      }
    }
  }
}

function byId_TreeWalk(id: string, context: QueryContext): Element[] {
  const nodes: Element[] = [];

  let root: Element | DocumentFragment;
  let doc: Document;
  if (isDocument(context)) {
    root = context.documentElement;
    doc = context;
    if (sameId(root, id)) nodes.push(root);
  } else {
    root = context;
    doc = context.ownerDocument;
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const e = node as Element; // TypeScript doesn't know the filter is effectively applied.
    if (sameId(e, id)) nodes.push(e);
  }

  return nodes;
}

function sameId(e: Element, id: string): boolean {
  // return e.id === id; // fast but can be wrong
  // return e.getAttribute('id') === id; // slower but correct
  // return isHtmlForm(e) ? e.getAttribute('id') === id : e.id === id;  // compromise
  const v = e.id;
  return typeof v === 'string' ? v === id : e.getAttribute('id') === id; // best compromise
}

// scoped getElementById for Document, DocumentFragment, and Element contexts
function byId(id: string, context: QueryContext, snap: Snapshot): Element | null {
  updateSnapshot(snap, context);
  if (!id) return null;

  if (!isElement(context)) return context.getElementById(id);

  if (context.isConnected) {
    if (snap.hasDocumentAll) return byId_AllFirst(id, context);
    if (snap.config.MUTATE_IDS) return byId_MutateFirst(id, context);
  }

  return byId_WalkFirst(id, context);
}

function byId_AllFirst(id: string, context: Element): Element | null {
  if (!context.isConnected) throw new Error('byId_AllFirst cannot be used on a disconnected element');

  const item = context.ownerDocument.all.namedItem(id);
  if (item === null) {  // null
    return null;
  } else if (isNamedItemAnElement(item)) {  // Element
    const e = item;
    if (e !== context && sameId(e, id) && context.contains(e)) {
      return e;
    }
    return null;
  } else {  // HTMLCollection
    for (let i = 0; i < item.length; i++) {
      const e = item[i];
      if (e !== context && sameId(e, id) && context.contains(e)) {
        return e;
      }
    }
    return null;
  }
}

function byId_MutateFirst(id: string, context: Element): Element | null {
  if (!context.isConnected) throw new Error('byId_MutateFirst cannot be used on a disconnected element');

  const doc = context.ownerDocument;
  const mutated: Element[] = [];

  try {
    for (;;) {
      const e = doc.getElementById(id);
      if (!e) return null;
      if (e !== context && context.contains(e)) return e;
      e.removeAttribute('id');
      mutated.push(e);
    }
  } finally {
    for (const e of mutated) e.setAttribute('id', id);
  }
}

function byId_WalkFirst(id: string, context: Element): Element | null {
  let node: Element = context;
  let next: Element | null = node.firstElementChild;

  while ((node = next as Element)) {
    if (sameId(node, id)) return node;

    next = node.firstElementChild || node.nextElementSibling;
    if (next) continue;

    while (!next && (node = node.parentElement as Element) && node !== context) {
      next = node.nextElementSibling;
    }
  }

  return null;
}

// context agnostic getElementsByTagName
function byTagRaw(tag: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);

  if (!tag) return [];

  if (isDocument(context) || isElement(context)) {
    return Array.from(context.getElementsByTagName(tag));
  }

  const lowerTag = tag.toLowerCase();
  const nodes: Element[] = [];
  let el = context.firstElementChild;

  while (el) {
    const isHtml = isHtmlElement(el);
    const name = isHtml ? el.localName : el.tagName;
    const wanted = isHtml ? lowerTag : tag;

    if (tag === '*' || name === wanted) nodes.push(el);

    concatList(nodes, el.getElementsByTagName(tag));
    el = el.nextElementSibling;
  }

  return nodes;
}

// context agnostic getElementsByTagNameNS
function byTagNsRaw(ns: string | null, local: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);

  if (!local) return [];

  if (isDocument(context) || isElement(context)) {
    return Array.from(context.getElementsByTagNameNS(ns, local));
  }

  const nodes: Element[] = [];
  let el = context.firstElementChild;

  while (el) {
    const nsMatch = ns === '*' || el.namespaceURI === ns;
    const localMatch = local === '*' || el.localName === local;

    if (nsMatch && localMatch) nodes.push(el);

    concatList(nodes, el.getElementsByTagNameNS(ns, local));
    el = el.nextElementSibling;
  }

  return nodes;
}

// Selector type seeds cannot use byTagRaw because qualified-name lookup can miss
// namespaced local-name matches; byTagNsRaw is exact-case and misses HTML folding.
function seedsByTag(tag: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);

  if (!tag) return [];
  if (tag === '*') return byTagRaw('*', context, snap);

  const nodes: Element[] = [];
  const lowerTag = tag.toLowerCase();

  walkElements(context, e => {
    if (snap.isHtml && isHtmlElement(e)) {
      if (e.localName === lowerTag) nodes.push(e);
    } else if (e.localName === tag) {
      nodes.push(e);
    }
  });

  return nodes;
}

// context agnostic getElementsByClassName
function byClassRaw(cls: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);

  if (isDocument(context) || isElement(context)) {
    return Array.from(context.getElementsByClassName(cls));
  }

  const nodes: Element[] = [];
  const reCls = RegExp('(^|\\s)' + escapeRegExp(cls) + '(\\s|$)', snap.isQuirksMode ? 'i' : '');
  let el = context.firstElementChild;

  while (el) {
    if (reCls.test(el.getAttribute('class') || '')) nodes.push(el);
    concatList(nodes, el.getElementsByClassName(cls));
    el = el.nextElementSibling;
  }

  return nodes;
}

function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`);
}

function isType(e: Element, htmlName: string, xmlName: string): boolean {
  return isHtmlElement(e)
    ? e.localName === htmlName
    : e.localName === xmlName;
}

function hasAttr(
  e: Element,
  anyNs: boolean,
  name: string,
  htmlName: string | null, // null implies same as name
  hasColonName: boolean,
  snap: Snapshot
): boolean {
  // Fast path for non-namespaced attributes without colons, which are common in HTML and SVG
  if (!anyNs && !hasColonName) {
    return e.hasAttribute(name);
  }

  const attrs = e.attributes;
  const expected = htmlName !== null && snap.isHtml && isHtmlElement(e) ? htmlName : name;

  if (anyNs) {
    for (let i = 0; i < attrs.length; i++) {
      if (attrs[i].localName === expected) return true;
    }
    return false;
  }

  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (attr.localName === expected && attr.namespaceURI === null) return true;
  }

  return false;
}

function matchAttribute(
  e: Element,
  anyNs: boolean,
  name: string,
  htmlName: string | null, // null implies same as name
  hasColonName: boolean,
  pattern: string,
  expected: string,
  htmlExpected: string,
  sensitivity: number,
  snap: Snapshot
): boolean {
  if (!anyNs && !hasColonName) {
    const attrValue = e.getAttribute(name);

    const insensitive = sensitivity === 1 || (sensitivity === 2 && snap.isHtml && isHtmlElement(e));
    return attrValue !== null &&
      matchAttrValueOp(attrValue, pattern, expected, htmlExpected, insensitive, snap);
  }

  let expectedName = name;
  let insensitive = sensitivity === 1;

  const needsHtmlInfo = htmlName !== null || sensitivity === 2;
  if (needsHtmlInfo && snap.isHtml) {
    const isHtml = isHtmlElement(e);

    if (isHtml) {
      if (htmlName !== null) expectedName = htmlName;
      if (sensitivity === 2) insensitive = true;
    }
  }

  const attrs = e.attributes;

  if (anyNs) {
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];

      if (
        attr.localName === expectedName &&
        matchAttrValueOp(attr.value, pattern, expected, htmlExpected, insensitive, snap)
      ) {
        return true;
      }
    }

    return false;
  }

  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];

    if (
      attr.localName === expectedName &&
      attr.namespaceURI === null &&
      matchAttrValueOp(attr.value, pattern, expected, htmlExpected, insensitive, snap)
    ) {
      return true;
    }
  }

  return false;
}

function matchAttrValueOp(
  attrValue: string,
  pattern: string,
  expected: string,
  htmlExpected: string,
  insensitive: boolean,
  snap: Snapshot
): boolean {
  // For ASCII-insensitive matching, avoid asciiLower(attrValue) in the hot path.
  if (insensitive) {
    switch (pattern) {
      case '=': return asciiEquals(attrValue, htmlExpected);
      case '^': return asciiStartsWith(attrValue, htmlExpected);
      case '$': return asciiEndsWith(attrValue, htmlExpected);
      case '|': return asciiDashMatch(attrValue, htmlExpected);
      case '*': return asciiIncludes(attrValue, htmlExpected);
      case '~': return asciiHasCssToken(attrValue, htmlExpected);
      default: return getCachedRegex(pattern, 'i', snap).test(attrValue);
    }
  }

  switch (pattern) {
    case '=': return attrValue === expected;
    case '~': return hasCssToken(attrValue, expected);
    case '^': return attrValue.startsWith(expected);
    case '$': return attrValue.endsWith(expected);
    case '*': return attrValue.includes(expected);
    case '|':
      return attrValue === expected ||
        (
          attrValue.length > expected.length &&
          attrValue.at(expected.length) === '-' &&
          attrValue.startsWith(expected)
        );

    default: return getCachedRegex(pattern, '', snap).test(attrValue);
  }
}

export function asciiEquals(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;
  if (actual.length !== n) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return true;
}

export function asciiStartsWith(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;
  if (actual.length < n) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return true;
}

export function asciiEndsWith(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;
  const offset = actual.length - n;
  if (offset < 0) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(offset + i);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return true;
}

export function asciiIncludes(actual: string, expectedLower: string): boolean {
  const m = expectedLower.length;

  // Native `[attr*=""]` matches nothing in selector semantics, and the compiler
  // should short-circuit that case before reaching here.
  if (m === 0) return false;
  if (actual.length < m) return false;

  const limit = actual.length - m;

  outer:
  for (let start = 0; start <= limit; start++) {
    for (let i = 0; i < m; i++) {
      let c = actual.charCodeAt(start + i);
      if (c >= 65 && c <= 90) c += 32;

      if (c !== expectedLower.charCodeAt(i)) continue outer;
    }

    return true;
  }

  return false;
}

export function asciiDashMatch(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;

  if (actual.length < n) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;

    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return actual.length === n || actual.at(n) === '-';
}

export function hasCssToken(actual: string, token: string): boolean {
  const n = actual.length;
  const m = token.length;

  if (m === 0) return false;

  let i = 0;
  while (i < n) {
    while (i < n && isCssSpace(actual.charCodeAt(i))) i++;
    const start = i;
    while (i < n && !isCssSpace(actual.charCodeAt(i))) i++;
    if (i - start === m && actual.slice(start, i) === token) return true;
  }

  return false;
}

export function asciiHasCssToken(actual: string, expectedLower: string): boolean {
  const n = actual.length;
  const m = expectedLower.length;

  if (m === 0) return false;

  let i = 0;

  while (i < n) {
    // Skip leading CSS whitespace.
    while (i < n && isCssSpace(actual.charCodeAt(i))) {
      i++;
    }

    const start = i;

    // Find end of this token.
    while (i < n && !isCssSpace(actual.charCodeAt(i))) {
      i++;
    }

    if (i - start === m) {
      let matched = true;

      for (let j = 0; j < m; j++) {
        let c = actual.charCodeAt(start + j);

        if (c >= 65 && c <= 90) {
          c += 32;
        }

        if (c !== expectedLower.charCodeAt(j)) {
          matched = false;
          break;
        }
      }

      if (matched) return true;
    }
  }

  return false;
}

function isCssSpace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 32));
}

// fast resolver for :nth-child() and :nth-last-child()
// use cache if available to get the 1-based index of element among its siblings
function nthElement(element: Element, fromLast: boolean, h: HashCache | null): number {
  if (!h) return nthElementLocal(element, fromLast);

  const parent = element.parentNode;
  if (!parent) return 1; // detached/rootless/root

  const cache = h.nthElement ??= new WeakMap<ParentNode, NthElementIndexMap>();

  let indexMap = cache.get(parent);
  if (!indexMap) {
    indexMap = new WeakMap<Element, number>();

    let index = 0;
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
      indexMap.set(node, index++);
    }
    cache.set(parent, indexMap);
  }

  const index = indexMap.get(element);
  if (index === undefined) {
    throw new Error('nthElement cache did not contain the target element');
  }

  return fromLast ? parent.childElementCount - index : index + 1;
}

function nthElementLocal(element: Element, fromLast: boolean): number {
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? e.nextElementSibling : e.previousElementSibling)) {
    n++;
  }

  return n;
}

// fast resolver for :nth-of-type() and :nth-last-of-type()
// use cache if available to get the 1-based index of element among same-type siblings
function nthOfType(element: Element, fromLast: boolean, h: HashCache | null): number {
  if (!h) return nthOfTypeLocal(element, fromLast);

  const parent = element.parentNode;
  if (!parent) return 1;

  const namespaceURI = element.namespaceURI;
  const localName = element.localName;
  const typeKey = `${namespaceURI ?? ''}\x00${localName}`;

  const cache = h.nthOfType ??= new WeakMap<ParentNode, NthOfTypeParentMap>();

  let typeMap = cache.get(parent);
  if (!typeMap) {
    typeMap = new Map<string, NthOfTypeIndexEntry>();
    cache.set(parent, typeMap);
  }

  let entry = typeMap.get(typeKey);
  if (!entry) {
    const indexMap = new WeakMap<Element, number>();

    let index = 0;
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
      if (node.localName === localName && node.namespaceURI === namespaceURI) {
        indexMap.set(node, index++);
      }
    }

    entry = { length: index, indexMap };
    typeMap.set(typeKey, entry);
  }

  const index = entry.indexMap.get(element);
  if (index === undefined) {
    throw new Error('nthOfType cache did not contain the target element');
  }

  return fromLast ? entry.length - index : index + 1;
}

function nthOfTypeLocal(element: Element, fromLast: boolean): number {
  const namespaceURI = element.namespaceURI;
  const localName = element.localName;
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? e.nextElementSibling : e.previousElementSibling)) {
    if (e.localName === localName && e.namespaceURI === namespaceURI) {
      n++;
    }
  }

  return n;
}

function isNthElement(element: Element, index: number, fromLast: boolean, h: HashCache | null): boolean {
  if (!h) return isNthElementLocal(element, index, fromLast);
  return nthElement(element, fromLast, h) === index;
}

function isNthOfType(element: Element, index: number, fromLast: boolean, h: HashCache | null): boolean {
  if (!h) return isNthOfTypeLocal(element, index, fromLast);
  return nthOfType(element, fromLast, h) === index;
}

function isNthElementLocal(element: Element, target: number, fromLast: boolean): boolean {
  if (target < 1) {
    throw new Error(`Invalid nth-child index: ${target}`);
  }

  const parent = element.parentNode;
  if (!parent) return target === 1;

  const length = parent.childElementCount;
  if (target > length) return false;

  const forwardTarget = fromLast ? length - target + 1 : target;

  let node: Element | null;

  if (forwardTarget <= length - forwardTarget + 1) {
    node = parent.firstElementChild;
    for (let i = 1; node && i < forwardTarget; ++i) {
      node = node.nextElementSibling;
    }
  } else {
    node = parent.lastElementChild;
    for (let i = length; node && i > forwardTarget; --i) {
      node = node.previousElementSibling;
    }
  }

  return node === element;
}

function isNthOfTypeLocal(element: Element, target: number, fromLast: boolean): boolean {
  if (target < 1) {
    throw new Error(`Invalid nth-of-type index: ${target}`);
  }

  const parent = element.parentNode;
  if (!parent) return target === 1;

  const namespaceURI = element.namespaceURI;
  const localName = element.localName;

  let index = 0;

  if (!fromLast) {
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
      if (node.localName === localName && node.namespaceURI === namespaceURI) {
        ++index;
        if (node === element) return index === target;
        if (index >= target) return false;
      }
    }
  } else {
    for (let node = parent.lastElementChild; node; node = node.previousElementSibling) {
      if (node.localName === localName && node.namespaceURI === namespaceURI) {
        ++index;
        if (node === element) return index === target;
        if (index >= target) return false;
      }
    }
  }

  return false;
}

function isFocused(node: Element, snap: Snapshot): boolean {
  const doc = node.ownerDocument;
  if (!doc || isIFrame(node)) return false;

  if (node === doc.body || node === doc.documentElement) {
    return node === snap.focusTarget && doc.hasFocus();
  }

  return node === doc.activeElement && doc.hasFocus();
}

function matchHasFrom(steps: [SelectorCombinator, string][], index: number, base: Element, snap: Snapshot, h: HashCache): boolean {
  // steps: RelativeStep[]
  if (index >= steps.length) {
    return true;
  }

  const step = steps[index];
  const source = step[1];
  const combinator = step[0];
  const next = index + 1;

  switch (combinator) {
    case ' ':
      for (let node = base.firstElementChild; node; node = nextDescendant(base, node)) {
        if (snap.matchStrict(source, node, h) && matchHasFrom(steps, next, node, snap, h)) {
          return true;
        }
      }
      return false;

    case '>':
      for (let node = base.firstElementChild; node; node = node.nextElementSibling) {
        if (snap.matchStrict(source, node, h) && matchHasFrom(steps, next, node, snap, h)) {
          return true;
        }
      }
      return false;

    case '+': {
      const node = base.nextElementSibling;
      return !!node && snap.matchStrict(source, node, h) && matchHasFrom(steps, next, node, snap, h);
    }

    case '~':
      for (let node = base.nextElementSibling; node; node = node.nextElementSibling) {
        if (snap.matchStrict(source, node, h) && matchHasFrom(steps, next, node, snap, h)) {
          return true;
        }
      }
      return false;
  }
}

function nextDescendant(root: Element, node: Element): Element | null {
  if (node.firstElementChild) return node.firstElementChild;

  while (node !== root) {
    if (node.nextElementSibling) return node.nextElementSibling;

    const parent = node.parentElement;
    if (!parent) return null;

    node = parent;
  }

  return null;
}

function matchLang(wanted: string, element: Element): boolean {
  const n = wanted.length;

  for (let node: Element | null = element; node; node = node.parentElement) {
    const actual = node.getAttribute('lang');

    if (actual) {
      const lang = actual.toLowerCase();
      return lang === wanted || (lang.length > n && lang.charAt(n) === '-' && lang.startsWith(wanted));
    }
  }

  return false;
}

function matchDir(wanted: string, element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const actual = node.getAttribute('dir');

    if (actual) {
      const dir = actual.toLowerCase();

      if (dir === 'ltr' || dir === 'rtl') {
        return dir === wanted;
      }

      if (dir === 'auto') {
        const auto = autoDir(node.textContent || '');
        return auto ? auto === wanted : wanted === 'ltr';
      }
    }

    // <bdi> defaults to auto directionality even without a dir attribute.
    if (node === element && node.localName === 'bdi') {
      const auto = autoDir(node.textContent || '');
      return auto ? auto === wanted : wanted === 'ltr';
    }
  }

  return wanted === 'ltr';
}

// TODO: cover more edge cases
// Minimal first-strong direction check for :dir(auto) / <bdi>.
function autoDir(text: string): 'ltr' | 'rtl' | null {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (
      (code >= 0x0590 && code <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana, etc.
      (code >= 0xfb1d && code <= 0xfdff) || // Hebrew/Arabic presentation forms
      (code >= 0xfe70 && code <= 0xfeff)    // Arabic presentation forms-B
    ) {
      return 'rtl';
    }

    if (
      (code >= 0x0041 && code <= 0x005a) || // Latin uppercase
      (code >= 0x0061 && code <= 0x007a) || // Latin lowercase
      (code >= 0x00c0 && code <= 0x02af) || // Latin extended / IPA
      (code >= 0x0370 && code <= 0x052f)    // Greek and Cyrillic
    ) {
      return 'ltr';
    }
  }

  return null;
}

const CUSTOM_ELEMENT_NAME_BLACKLIST = new Set([
  'annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri',
  'font-face-format', 'font-face-name', 'missing-glyph',
]);
const PCEN = String.raw`[-.0-9_a-z\u00B7\u0300-\u036F\u203F-\u2040]`;
const CUSTOM_ELEMENT_NAME = new RegExp(String.raw`^[a-z]${PCEN}*-${PCEN}*$`);

function isPotentialCustomElementName(name: string): boolean {
  return CUSTOM_ELEMENT_NAME.test(name) &&
    !CUSTOM_ELEMENT_NAME_BLACKLIST.has(name);
}

function isDefined(element: Element, snap: Snapshot): boolean {
  if (!isHtmlElement(element)) return true;

  const name = element.localName;
  if (!isPotentialCustomElementName(name)) return true;

  return !!snap.doc.defaultView?.customElements?.get(name);
}

function isDisabled(e: Element): boolean {
  return isFormStateElement(e) && isDisabledFormStateElement(e);
}

function isEnabled(e: Element): boolean {
  return isFormStateElement(e) && !isDisabledFormStateElement(e);
}

function isDisabledFormStateElement(e: FormStateElement): boolean {
  if (e.disabled) return true;

  if (isHtmlOption(e)) {
    const parent = e.parentElement;
    return !!parent && isHtmlOptGroup(parent) && parent.disabled;
  }

  if (isHtmlOptGroup(e)) return false;

  // Ancestor disabled fieldsets may disable form controls, unless the control is
  // inside that fieldset's first legend child.
  for (let n = e.parentElement; n; n = n.parentElement) {
    if (!(n as HTMLFieldSetElement).disabled || !isHtmlFieldSet(n)) continue; // re-ordered for perf

    let exempt = false;

    for (let child = n.firstElementChild; child; child = child.nextElementSibling) {
      if (!isHtmlLegend(child)) continue;
      exempt = child.contains(e);
      break;
    }

    if (exempt) continue;
    return true;
  }

  return false;
}

// https://html.spec.whatwg.org/multipage/semantics-other.html#selector-read-only
const READONLY_APPLIES_INPUT_TYPES = new Set(['date', 'datetime-local', 'email', 'month', 'number', 'password', 'search', 'tel', 'text', 'time', 'url', 'week']);
function isReadWrite(e: Element): boolean {
  if (isHtmlInput(e)) {
    return READONLY_APPLIES_INPUT_TYPES.has(e.type) && !e.readOnly && !isDisabled(e);
  }
  if (isHtmlTextArea(e)) return !e.readOnly && !isDisabled(e);
  return isEditingHostOrEditable(e);
}

function isEditingHostOrEditable(e: Element): boolean {
  if (!isHtmlSvgOrMathElement(e)) return false;

  // Editing host: HTML element with contenteditable in the true or plaintext-only state.
  const attr = e.getAttribute('contenteditable')?.toLowerCase();
  if (isHtmlElement(e) && (attr === '' || attr === 'true' || attr === 'plaintext-only')) {
    return true;
  }

  // Editable: the node itself must not have contenteditable=false.
  if (attr === 'false') {
    return false;
  }

  // Editing host: child HTML element of a Document whose designMode is enabled.
  // DesignMode: eligible descendants of a designMode document are editable unless blocked.
  if (e.ownerDocument.designMode.toLowerCase() === 'on') {
    for (let n: Element | null = e; n; n = n.parentElement) {
      if (n.getAttribute('contenteditable')?.toLowerCase() === 'false') {
        return false;
      }
    }

    return true;
  }

  // Editable: not an editing host, does not have contenteditable=false,
  // parent is an editing host or editable, and the element is HTML/SVG/Math.
  for (let n: Element | null = e.parentElement; n; n = n.parentElement) {
    const parentAttr = n.getAttribute('contenteditable')?.toLowerCase();

    if (parentAttr === 'false') {
      return false;
    }

    if (isHtmlElement(n) && (parentAttr === '' || parentAttr === 'true' || parentAttr === 'plaintext-only')) {
      return true;
    }
  }

  return false;
}

const PLACEHOLDER_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);

function isPlaceholderShown(e: Element): boolean {
  if (!e.hasAttribute('placeholder')) return false;

  if (isHtmlTextArea(e)) {
    return e.value === '';
  }

  if (isHtmlInput(e)) {
    return PLACEHOLDER_INPUT_TYPES.has(e.type) && e.value === '';
  }

  return false;
}

function isDefault(e: Element): boolean {
  if (isHtmlOption(e)) return e.defaultSelected;
  const isInput = isHtmlInput(e);
  if (isInput && (e.type === 'checkbox' || e.type === 'radio')) return e.defaultChecked;
  const isButton = isHtmlButton(e);
  if (!isInput && !isButton) return false;
  const isSubmit = (isInput && (e.type === 'submit' || e.type === 'image')) || (isButton && e.type === 'submit');
  if (!isSubmit) return false;

  // find the first submit button, which may be in or outside the form
  const form = e.form;
  if (!form) return false;

  let firstInput = null;
  const inputs = form.ownerDocument.getElementsByTagName('input')
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (input.form === form && (input.type === 'submit' || input.type === 'image')) {
      firstInput = input;
      break;
    }
  }

  let firstButton = null;
  const buttons = form.ownerDocument.getElementsByTagName('button');
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    if (button.form === form && button.type === 'submit') {
      firstButton = button;
      break;
    }
  }

  const firstSubmit =
    !firstInput ? firstButton :
    !firstButton ? firstInput :
    (firstInput.compareDocumentPosition(firstButton) & Node.DOCUMENT_POSITION_FOLLOWING)
      ? firstInput
      : firstButton;

  return firstSubmit === e;
}

function isChecked(e: Element): boolean {
  if (isHtmlInput(e)) return (e.type === 'checkbox' || e.type === 'radio') && e.checked;
  if (isHtmlOption(e)) return e.selected;
  return false;
}

function isIndeterminate(e: Element): boolean {
  // progress elements with no value content attribute
  if (isHtmlProgress(e)) return !e.hasAttribute('value');

  if (!isHtmlInput(e)) return false;

  // input elements whose type attribute is in the Checkbox state
  // and whose indeterminate IDL attribute is set to true
  if (e.type === 'checkbox') return e.indeterminate;

  // input elements whose type attribute is in the Radio Button state
  // and whose radio button group contains no checked input
  if (e.type !== 'radio') return false;
  if (e.checked) return false;


  // Radio groups require a non-empty name attribute; an unnamed unchecked radio is alone,
  // so its group contains no checked input.
  const name = e.getAttribute('name');
  if (!name) return true;

  const root = e.getRootNode();
  const inputs = e.ownerDocument.getElementsByTagName('input');

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];

    // Same radio group: radio state, same form owner, same tree,
    // non-empty equal name attribute, and checkedness state is true.
    if (
      input !== e &&
      input.type === 'radio' &&
      input.form === e.form &&
      input.getRootNode() === root &&
      input.getAttribute('name') === name &&
      input.checked
    ) {
      return false;
    }
  }

  return true;
}

const REQUIRED_INPUT_TYPES = new Set([
  'checkbox', 'date', 'datetime-local', 'email', 'file', 'month', 'number',
  'password', 'radio', 'search', 'tel', 'text', 'time', 'url', 'week',
  // 'color' for webkit?
]);

function isRequired(e: Element): boolean {
  if (isHtmlSelect(e) || isHtmlTextArea(e)) return e.required;
  if (isHtmlInput(e)) return REQUIRED_INPUT_TYPES.has(e.type) && e.required;
  return false;
}

function isOptional(e: Element): boolean {
  if (isHtmlInput(e)) return !isRequired(e);
  if (isHtmlSelect(e) || isHtmlTextArea(e)) return !e.required;
  return false;
}

function isInvalid(e: Element): boolean {
  if (isHtmlForm(e)) return !e.checkValidity();

  if (isHtmlFieldSet(e)) {
    return hasInvalidDescendant(e);
  }

  if (isValidityElement(e)) {
    return e.willValidate && !e.checkValidity();
  }

  return false;
}

function isValid(e: Element): boolean {
  if (isHtmlForm(e)) return e.checkValidity();

  if (isHtmlFieldSet(e)) {
    return !hasInvalidDescendant(e);
  }

  if (isValidityElement(e)) {
    return e.willValidate && e.checkValidity();
  }

  return false;
}

function hasInvalidDescendant(root: Element): boolean {
  for (let node = root.firstElementChild; node; node = nextDescendant(root, node)) {
    if (isInvalid(node)) return true;
  }
  return false;
}

function isRangeInput(e: Element): e is HTMLInputElement {
  if (!isHtmlInput(e)) return false;

  switch (e.type) {
    case 'range':
      return true;

    case 'date': case 'datetime-local': case 'month': case 'number': case 'time': case 'week':
      return e.hasAttribute('min') || e.hasAttribute('max');

    default:
      return false;
  }
}

function isInRange(e: Element): boolean {
  if (!isRangeInput(e) || !e.willValidate) return false;

  const validity = e.validity;
  return !validity.rangeUnderflow && !validity.rangeOverflow;
}

function isOutOfRange(e: Element): boolean {
  if (!isRangeInput(e) || !e.willValidate) return false;

  const validity = e.validity;
  return validity.rangeUnderflow || validity.rangeOverflow;
}

function getMediaElement(e: Element): HTMLMediaElement | null {
  if (isHtmlMediaElement(e)) return e;
  const parent = e.parentElement;
  return parent && isHtmlMediaElement(parent) ? parent : null;
}

function isPlaying(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.currentTime > 0 && !media.paused && !media.ended && media.readyState > 2;
}

function isPaused(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.paused;
}

function isSeeking(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.seeking;
}

function isMuted(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.muted;
}

function previewText(s: string, max = 240): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function describeElement(el: Element | null | undefined): string {
  if (!el) return '(missing)';
  const id = el.getAttribute('id');
  const cls = el.getAttribute('class');
  return `<${el.tagName.toLowerCase()}${id ? ` id='${id}'` : ''}${cls ? ` class='${cls}'` : ''}>`;
}

function describeElements(els: Element[], max = 10): string[] {
  const out = els.slice(0, max).map(describeElement);
  if (els.length > max) out.push(`… (${els.length - max} more)`);
  return out;
}

function describeContext(ctx: QueryContext): QueryContextDescription {
  if (isDocument(ctx)) {
    const root = ctx.documentElement;
    const body = ctx.body;
    return {
      kind: 'document',
      summary: '#document',
      preview: previewText(body?.outerHTML || root?.outerHTML || ''),
    };
  }

  if (isDocumentFragment(ctx)) {
    const children = Array.from(ctx.childNodes)
      .map((n) => {
        if (isElement(n)) return n.outerHTML;
        if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
        return '';
      }).join('');
    return {
      kind: 'fragment',
      summary: '#document-fragment',
      preview: previewText(children),
    };
  }

  if (isElement(ctx)) {
    return {
      kind: 'element',
      summary: describeElement(ctx),
      preview: previewText(ctx.outerHTML),
    };
  }

  return {
    kind: 'unknown',
    summary: '(unknown context)',
  };
}

function isNode(x: unknown): x is Node {
  return !!x &&
    typeof x === 'object' &&
    typeof (x as any).nodeType === 'number' &&
    typeof (x as any).nodeName === 'string';
}

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}

function isDocument(n: Node): n is Document {
  return n.nodeType === 9;
}

function isDocumentFragment(n: Node): n is DocumentFragment {
  return n.nodeType === 11;
}

function isComment(n: Node): n is Comment {
  return n.nodeType === 8;
}

function isText(n: Node): n is Text {
  return n.nodeType === 3;
}

function isHtmlDoc(doc: Document): doc is HTMLDocument {
  return doc.contentType.includes('/html') || doc.createElement('DiV').localName == 'div';
}

function isQuirksMode(doc: Document): boolean {
  return doc.compatMode !== 'CSS1Compat';
}

function isHtmlElement(e: Element): e is HTMLElement {
  return e.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

function isSvgElement(e: Element): e is SVGElement {
  return e.namespaceURI === 'http://www.w3.org/2000/svg';
}

function isMathElement(e: Element): e is MathMLElement {
  return e.namespaceURI === 'http://www.w3.org/1998/Math/MathML';
}

function isHtmlSvgOrMathElement(e: Element): e is HTMLElement | SVGElement | MathMLElement {
  return isHtmlElement(e) || isSvgElement(e) || isMathElement(e);
}

function isHtmlMediaElement(e: Element): e is HTMLMediaElement {
  return 'currentTime' in e && 'paused' in e && 'ended' in e && 'readyState' in e;
}

function isIFrame(e: Element): e is HTMLIFrameElement {
  return e.localName === 'iframe';
}

function isHtmlInput(e: Element): e is HTMLInputElement {
  return e.localName === 'input';
}

function isHtmlButton(e: Element): e is HTMLButtonElement {
  return e.localName === 'button';
}

type FormStateElement = HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLOptGroupElement | HTMLOptionElement | HTMLSelectElement | HTMLTextAreaElement;
const FORM_STATE_ELEMENTS = new Set(['button', 'fieldset', 'input', 'optgroup', 'option', 'select', 'textarea']);
function isFormStateElement(e: Element): e is FormStateElement {
  return FORM_STATE_ELEMENTS.has(e.localName);
}

function isHtmlTextArea(e: Element): e is HTMLTextAreaElement {
  return e.localName === 'textarea';
}

function isHtmlFieldSet(e: Element): e is HTMLFieldSetElement {
  return e.localName === 'fieldset';
}

function isHtmlLegend(e: Element): e is HTMLLegendElement {
  return e.localName === 'legend';
}

function isHtmlOptGroup(e: Element): e is HTMLOptGroupElement {
  return e.localName === 'optgroup';
}

function isHtmlOption(e: Element): e is HTMLOptionElement {
  return e.localName === 'option';
}

function isHtmlProgress(e: Element): e is HTMLProgressElement {
  return e.localName === 'progress';
}

function isHtmlSelect(e: Element): e is HTMLSelectElement {
  return e.localName === 'select';
}

function isHtmlForm(e: Element): e is HTMLFormElement {
  return e.localName === 'form';
}

type ValidityElement =
  HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLObjectElement |
  HTMLOutputElement | HTMLSelectElement | HTMLTextAreaElement;

function isValidityElement(e: Element): e is ValidityElement {
  return 'willValidate' in e;
}

function isNamedItemAnElement(item: Element | HTMLCollection): item is Element {
  return (item as { nodeType?: unknown }).nodeType === 1;
}


export function buildRexStrings(ext: NwsExtensions) {
  // NOTE: SPECIAL CASES IN CSS SYNTAX PARSING RULES
  // The <EOF-token> https://drafts.csswg.org/css-syntax/#typedef-eof-token
  // allow mangled|unclosed selector syntax at the end of selectors strings

  // string literals and character escapes
  const SP = `\\ `;           // space
  const HT = `\\t`;           // horizontal tab
  const LF = `\\n`;           // line feed
  const CR = `\\r`;           // carriage return
  const FF = `\\f`;           // form feed
  const DQ = `\\"`;           // double quote
  const SQ = `\\'`;           // single quote
  const BS = `\\\\`;          // backslash
  const LP = `\\(`;           // left parenthesis
  const RP = `\\)`;           // right parenthesis
  const LB = `\\[`;           // left bracket
  const RB = `\\]`;           // right bracket
  const PIPE = `\\|`;         // pipe
  const UNIVERSAL = `\\*`;    // universal
  const HEX = `0-9a-fA-F`;    // hex digit
  const ALPHA = `a-zA-Z`;     // alpha char
  const DIGIT = `0-9`;        // digit char
  const SLUG = `a-zA-Z0-9_-`; // loose name char, used for pseudo names
  const IDENT_HEAD = `${ALPHA}_`; // identifier head char
  const IDENT_TAIL = `${IDENT_HEAD}${DIGIT}-`; // identifier tail char
  const VSP = `${CR}${LF}${FF}`;  // vertical whitespace
  const HSP = `${SP}${HT}`;       // horizontal whitespace
  const WSP = `${VSP}${HSP}`;     // any whitespace

  // character classes
  const wsp = `[${WSP}]`;
  const digitCh = `[${DIGIT}]`;
  const slugCh = `[${SLUG}]`;
  const quote = `[${DQ}${SQ}]`;
  const identHeadCh = `[${IDENT_HEAD}]`;
  const identTailCh = `[${IDENT_TAIL}]`;
  const hexCh = `[${HEX}]`;
  const nonAsciiCh = `[^\\x00-\\x9f]`;
  const esc = `${BS}[^${VSP}${HEX}]`;
  const ucEsc = `${BS}${hexCh}{1,6}(?:${CR}${LF}|${wsp})?`;

  // character sequences
  const identHead = `(?:${identHeadCh}|${nonAsciiCh}|${esc}|${ucEsc})`;
  const identTail = `(?:${identTailCh}|${nonAsciiCh}|${esc}|${ucEsc})`;
  const identifier =
    `(?:` +
      `-?${identHead}${identTail}*|` +
      `--${identTail}*` +
    `)`;

  // :nth
  const nthFormula = `(?:[-+]?${digitCh}+|[-+]?${digitCh}*[nN](?:${wsp}*[-+]${wsp}*${digitCh}+)?)`;
  const even = `[eE][vV][eE][nN]`;
  const odd = `[oO][dD][dD]`;
  const nthArg = `(?:${even}|${odd}|${nthFormula})`;
  const nthPseudo = `nth(?:-last)?(?:-child|-of\\-type)`;

  // namespace
  const nsPart = `(?:${UNIVERSAL}|${identifier})`;
  const nsType = `(?:${nsPart}?${PIPE}${nsPart})`;
  const attrName = `(?:(?:${nsPart}?${PIPE})?${identifier})`;

  // configurable combinators and operators
  const COMBINATOR = ext.combinators.map(escapeRegExp).join('');
  const combinator = `[${COMBINATOR}]${wsp}?(?=[^${COMBINATOR}])`;
  const operators = `(?:${ext.operators.map(escapeRegExp).join('|')})`;

  // attribute selectors
  const dqString = `"[^"${BS}]*(?:${BS}.[^"${BS}]*)*(?:"|$)`;
  const sqString = `'[^'${BS}]*(?:${BS}.[^'${BS}]*)*(?:'|$)`;
  const attrValue = `(?:${identifier}|${dqString}|${sqString})`;
  const attrvalueCap = `(${quote}?)((?!\\3)*|(?:${BS}?.)*?)(?:\\3|$)`;
  // const attrFlag = `(?:\\b[is]\\b)`;
  const attrFlag =
    `(?:` +
      `\\b[iIsS]|` +
      `${BS}(?:[iIsS]|(?:0{0,5}(?:49|53|69|73))(?:${CR}${LF}|${wsp})?)` +
    `)`;

  // const simpleSelector = `(?:${classSelector}|${idSelector}|${attributes}|${pseudoSelector})`;
  // const compoundSelector = `(?:${typeSelector}${simpleSelector}*|${simpleSelector}+)`;
  // after simple selector
  const afterSubSelector = `(?=$|[${WSP},)>+~.#\\[:])`;

  // [ attrName (operator attrValue)? attrFlag? ]
  // [attr], [attr=value], [attr~=value], [attr~="value'], [ns|attr=value i], etc.
  const attributeSelector =
    `${LB}` +
      `${wsp}?` +
      `(${attrName})` +
      `${wsp}?` +
      `(?:` +
        `(${operators})` +
        `${wsp}?` +
        `${attrValue}` +
        `${wsp}?` +
        `(${attrFlag})?` +
      `)?` +
      `${wsp}?` +
    `(?:${RB}|$)` + afterSubSelector;

  const attrMatcher = attributeSelector.replace(attrValue, attrvalueCap);

  // selector components
  const pseudoName = `${slugCh}+`;
  const typeSelector = `(?:${nsType}|${UNIVERSAL}|${identifier})`;
  const classSelector = `\\.${identifier}` + afterSubSelector;
  const idSelector = `#${identifier}` + afterSubSelector;
  const pseudoSelector = `:${pseudoName}`;
  // const brokenAttrInPseudo = `${LB}[^${RB}${RP}]*(?=${RP}|$)`;

  // const pseudoSelector = `:${pseudoName}(?:${pseudoBody}*)?`;
  // const simpleSelector = `(?:${classSelector}|${idSelector}|${attributes}|${pseudoSelector})`;
  // const compoundSelector = `(?:${typeSelector}${simpleSelector}*|${simpleSelector}+)`;
  // const relativeSelector = `(?:${compoundSelector}?${wsp}?${combinator}${wsp}?)+${compoundSelector}?`;
  // const complexSelector = `(?:${relativeSelector}|${compoundSelector})`;
  // const selectorList = `${complexSelector}(?:${wsp}?,${wsp}?${complexSelector})*`;

  // Loose token walker for functional pseudo-class arguments.
  // Handles selector-list-ish and relative-selector-ish bodies such as:
  //   :not(*)
  //   :is(.a, #b, div, *|item, [attr=value])
  //   :has(> .item, + dt)
  //   :is(:scope > .item)
  // TODO: replace this with parser-side validation for functional pseudo bodies.
  const pseudoBody =
    `(?:` +
    `${LP}` +
      `(?:${wsp}?)|` +
      `(?:${typeSelector})|` +
      `(?:${nthFormula})|` +
      `(?:${pseudoSelector})|` +
      `(?:${classSelector}|${idSelector})|` +
      `(?:${attributeSelector})|` +
      `(?:${wsp}?${combinator})|` +
      `(?:,${wsp}?)|` +
    `(?:${RP}|$)` +
    `)`;

  // Cheated because regex can't do recursion, but here's the full version after the fact.
  const pseudoSelectorFull = `:{1,2}${pseudoName}${pseudoBody}*` + afterSubSelector;

  const validator =
    `(?=${wsp}?[^>+~(){}<>])` +
    `(?:` +
      `(?:${typeSelector})|` +
      `(?:${classSelector}|${idSelector})|` +
      `(?:${attributeSelector})|` +
      `(?:${pseudoSelectorFull})|` +
      `(?:${wsp}?${combinator}${wsp}?)|` +
      `(?:${wsp}?,${wsp}?)|` +
      `(?:${wsp}?)` +
    `)+`;

  // TODO: replace this regex heuristic with a rightmost-compound seed picker.
  // Current behavior is order-dependent inside a compound selector; a selector like
  // `.foo#bar` should seed on `#bar` regardless of whether the id appears last.
  // Desired priority: #id > .class > type/tag > universal/fallback.

  // The following global RE is used to return the deepest localName in selector strings and then
  // use it to retrieve all possible matching nodes that will be filtered by compiled resolvers
  const optimizer =
    `(?:` +
      `([.:#*]?)` +
      `(${identifier})` +
      `(?:` +
        `:${pseudoName}|` +
        `${LB}[^${RB}]+(?:${RB}|$)|` +
        `${LP}[^${RP}]+(?:${RP}|$)` +
      `)*` +
    `)$`;

  const Not = {
    // not enclosed in double/single/parens/square
    double_enc: `(?=(?:[^"]*["][^"]*["])*[^"]*$)`,
    single_enc: `(?=(?:[^']*['][^']*['])*[^']*$)`,
    parens_enc: `(?![^${LP}]*${RP})`,
    square_enc: `(?![^${LB}]*${RB})`,
  };
  const Groups = {
    // pseudo-classes requiring parameters
    linguistic: `(dir|lang)(?:${LP}${wsp}?(${slugCh}{2,})${wsp}?${RP})`,
    logicalsel: `(is|where|matches|not|has)(?:${LP}${wsp}?([^()]*|.*)${wsp}?${RP})`,
    treestruct: `(${nthPseudo})(?:${LP}${wsp}*(${nthArg})${wsp}*${RP})`,
    // pseudo-classes not requiring parameters
    locationpc: `(any\\-link|link|visited|target|defined)\\b`,
    useraction: `(hover|active|focus\\-within|focus\\-visible|focus)\\b`,
    structural: `(scope|root|empty|(?:(?:first|last|only)(?:-child|\\-of\\-type)))\\b`,
    inputstate: `(enabled|disabled|read\\-only|read\\-write|placeholder\\-shown|default)\\b`,
    inputvalue: `(checked|indeterminate|required|optional|valid|invalid|in\\-range|out\\-of\\-range)\\b`,
    // pseudo-classes not requiring parameters and describing functional state
    rsrc_state: `(playing|paused|seeking|buffering|stalled|muted|volume-locked)\\b`,
    disp_state: `(open|closed|modal|fullscreen|picture-in-picture)\\b`,
    time_state: `(current|past|future)\\b`,
    // pseudo-classes for parsing only selectors
    pseudo_nop: `(autofill|-webkit\\-autofill)\\b`,
    // pseudo-elements starting with single colon (:)
    pseudo_sng: `(after|before|first\\-letter|first\\-line)\\b`,
    // pseudo-elements starting with double colon (::)
    pseudo_dbl: `:(after|before|first\\-letter|first\\-line|selection|placeholder|-webkit-${slugCh}{2,})\\b`,
  };

  return {
    Groups, Not, optimizer, validator, hexCh, wsp, nsPart, attrmatcher: attrMatcher, identifier, quote,
    LP, RP, LB, RB, BS, LF, CR, FF, SP, HT, UNIVERSAL, PIPE, COMBINATOR,
    // for testing
    attrValue, attributeSelector,
  }
}

export function buildRex(ext: NwsExtensions) {
  const {
    Groups, Not, optimizer, validator, hexCh, wsp, nsPart, attrmatcher, identifier, quote,
    LP, RP, LB, RB, BS, LF, CR, FF, SP, HT, UNIVERSAL, PIPE, COMBINATOR
  } = buildRexStrings(ext);

  const rex = {
    // regular expressions
    HasEscapes: RegExp(`${BS}`),
    HexNumbers: RegExp(`^${hexCh}`),
    EscOrQuote: RegExp(`^${BS}|${quote}`),
    RegExpChar: RegExp(`(?!${BS})[${BS}^$.,*+?()[${RB}{}|\\/]`, 'g'),
    TrimSpaces: RegExp(`^${wsp}+|${wsp}+$`, 'g'),
    SplitGroup: RegExp(`(${LP}[^${RP}]*${RP}|${LB}[^${LB}]*${RB}|${BS}.|[^,])+`, 'g'),
    CommaGroup: RegExp(`(${wsp}*,${wsp}*)${Not.square_enc}${Not.parens_enc}`, 'g'),
    FixEscapes: RegExp(`${BS}(${hexCh}{1,6}${wsp}?|.)|(${quote})`, 'g'),
    CombineWSP: RegExp(`[${LF}${CR}${FF}${SP}]+${Not.single_enc}${Not.double_enc}`, 'g'),
    TabCharWSP: RegExp(`(${SP}?${HT}+${SP}?)${Not.single_enc}${Not.double_enc}`, 'g'),
    PseudosWSP: RegExp(`([0-9n])${wsp}*([-+])${wsp}*(?=[0-9n])${Not.square_enc}`, 'gi'),
    STD: {
      combinator: RegExp(`${wsp}?([${COMBINATOR}])${wsp}?`, 'g'),
      apimethods: RegExp(`^${nsPart}?${PIPE}`),
      namespaces: RegExp(`(${nsPart}?)${PIPE}${nsPart}`),
    },
    Patterns: {
      // pseudo-classes
      treestruct: RegExp(`^:(?:${Groups.treestruct})(.*)`, 'i'),
      structural: RegExp(`^:(?:${Groups.structural})(.*)`, 'i'),
      linguistic: RegExp(`^:(?:${Groups.linguistic})(.*)`, 'i'),
      useraction: RegExp(`^:(?:${Groups.useraction})(.*)`, 'i'),
      inputstate: RegExp(`^:(?:${Groups.inputstate})(.*)`, 'i'),
      inputvalue: RegExp(`^:(?:${Groups.inputvalue})(.*)`, 'i'),
      rsrc_state: RegExp(`^:(?:${Groups.rsrc_state})(.*)`, 'i'),
      disp_state: RegExp(`^:(?:${Groups.disp_state})(.*)`, 'i'),
      time_state: RegExp(`^:(?:${Groups.time_state})(.*)`, 'i'),
      locationpc: RegExp(`^:(?:${Groups.locationpc})(.*)`, 'i'),
      logicalsel: RegExp(`^:(?:${Groups.logicalsel})(.*)`, 'i'),
      pseudo_nop: RegExp(`^:(?:${Groups.pseudo_nop})(.*)`, 'i'),
      pseudo_sng: RegExp(`^:(?:${Groups.pseudo_sng})(.*)`, 'i'),
      pseudo_dbl: RegExp(`^:(?:${Groups.pseudo_dbl})(.*)`, 'i'),
      // combinator symbols
      children: RegExp(`^${wsp}?\\>${wsp}?(.*)`),
      adjacent: RegExp(`^${wsp}?\\+${wsp}?(.*)`),
      relative: RegExp(`^${wsp}?\\~${wsp}?(.*)`),
      ancestor: RegExp(`^${wsp}+(.*)`),
      // universal & namespace
      universal: RegExp(`^(${UNIVERSAL})(.*)`),
      namespace: RegExp(`^(${nsPart}?)${PIPE}(.*)`),
      // id, class, tag
      id: RegExp(`^#(${identifier})(.*)`),
      tagName: RegExp(`^(${identifier})(.*)`),
      className: RegExp(`^\\.(${identifier})(.*)`),
      attribute: RegExp(`^(?:${attrmatcher})(.*)`),
    },

    // regexp to better approximate detection of RTL languages (Arabic)
    RTL: RegExp(`^(?:[\\u0627-\\u064a]|[\\u0591-\\u08ff]|[\\ufb1d-\\ufdfd]|[\\ufe70-\\ufefc])+$`),

    optimizer: RegExp(optimizer),
    validator: RegExp(validator, 'g'),
  };

  return rex;
}

type Rex = ReturnType<typeof buildRex>;

const MACROS = {
  S: { // SELECT
    INIT: '"use strict";return function Resolver(c,f,x,r,h)',
    HEAD: 'var e,m,n,o,j=r.length-1,k=-1,p=false',
    LOOP: 'main:while((e=c[++k]))',
    BODY: 'r[++j]=c[k];',
    TAIL: 'continue main;',
    TEST: 'if(f(c[k])===false){p=true;break main;}',
    RETURN: 'return p;',
    VARS: [] as string[],
  },

  M: { // MATCH
    INIT: '"use strict";return function Resolver(c,f,h)',
    HEAD: 'var e,m,n,o',
    LOOP: 'e=c;',
    BODY: '',
    TAIL: 'return true;',
    TEST: 'f(c);',
    RETURN: 'return false;',
    VARS: [] as string[],
  },
} as const;

// compile groups or single selector strings into
// executable functions for matching or selecting
function compile(selector: string, mode: true, hasCb: boolean, snap: Snapshot): SelectLambda;
function compile(selector: string, mode: false, hasCb: false, snap: Snapshot): MatchLambda;
function compile(selector: string, mode: boolean, hasCb: boolean, snap: Snapshot): SelectLambda | MatchLambda {
  const isSelectMode = mode === true;

  const cache = isSelectMode ? snap.selectLambdas : snap.matchLambdas;
  const key = isSelectMode ? selectLambdaKey(selector, hasCb) : selector;
  const cached = cache[key];
  if (cached) return cached;

  const spec = isSelectMode ? MACROS.S : MACROS.M;
  const macro = `${spec.BODY}${hasCb ? spec.TEST : ''}${spec.TAIL}`;

  const { source, post, modvar } = compileSelector(selector, macro, mode, snap);

  const loop = `${spec.LOOP}${isSelectMode ? `{${source}}` : source}`;
  const vars = modvar.length ? `,${modvar.join(',')}` : '';
  const f = `${spec.INIT}{${spec.HEAD}${vars};${loop}${post}${spec.RETURN}}`;
  const factory = Function('s', f)(snap) as SelectLambda | MatchLambda;

  if (isSelectMode) {
    snap.selectLambdas[key] = factory as SelectLambda;
  } else {
    snap.matchLambdas[key] = factory as MatchLambda;
  }

  return factory;
}

const ATTR_INSENSITIVE = new Set([
  'accept', 'accept-charset', 'align', 'alink', 'axis',
  'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color',
  'compact', 'declare', 'defer', 'dir', 'direction', 'disabled',
  'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang',
  'language', 'link', 'media', 'method', 'multiple', 'nohref',
  'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev',
  'rules', 'scope', 'scrolling', 'selected', 'shape', 'target',
  'text', 'type', 'valign', 'valuetype', 'vlink',
]);

// build conditional code to check components of selector strings
function compileSelector(
  expression: string, source: string, mode: boolean | null, snap: Snapshot
): CompileSelectorResult {
  const out: CompileSelectorResult = { source: '', post: '', modvar: [] };
  let k = 0;
  let selector: string | undefined = expression;

  // isolate selector combinators
  selector = selector.replace(snap.re.STD.combinator, '$1');

  while (selector) {

    ++k;

    // get namespace prefix if present or get first char of selector
    const symbol: string = snap.re.STD.apimethods.test(selector) ? '|'
      : /^-?(?:[_a-zA-Z]|[^\0-\x7f]|\\)/.test(selector) ? '<tag>'
      : selector[0];

    let match: RegExpMatchArray | null = null;
    switch (symbol) {

      // universal resolver
      case '*': {
        match = selector.match(snap.re.Patterns.universal);
        if (!match) throw new Error('Invalid universal selector: ' + selector);
        break;
      }

      // id resolver
      case '#': {
        match = selector.match(snap.re.Patterns.id);
        if (!match) throw new Error('Invalid ID selector: ' + selector);

        const id = cssIdentUnescape(match[1]);
        const idLit = JSON.stringify(id);

        source = `if((e.getAttribute("id")===${idLit})){${source}}`;
        break;
      }

      // class name resolver
      case '.': {
        match = selector.match(snap.re.Patterns.className);
        if (!match) throw new Error('Invalid class selector: ' + selector);

        const className = cssIdentUnescape(match[1]);

        // Class selectors match whitespace-separated tokens. If the decoded selector
        // fragment itself contains whitespace, it cannot denote one class token.
        if (/[\t\n\f\r ]/.test(className)) {
          source = `if(false){${source}}`;
          break;
        }

        const classPattern = `(^|[\\t\\n\\f\\r ])${escapeRegExp(className)}([\\t\\n\\f\\r ]|$)`;
        const classPatternLit = JSON.stringify(classPattern);
        const flagsLit = JSON.stringify(snap.isQuirksMode ? 'i' : '');
        source = `if(s.getCachedRegex(${classPatternLit},${flagsLit}).test(e.getAttribute("class")||"")){${source}}`;
        break;
      }

      // tag name resolver
      case '<tag>': {
        match = selector.match(snap.re.Patterns.tagName);
        if (!match) throw new Error('Invalid tag selector: ' + selector);

        const rawTagName = cssIdentUnescape(match[1]);
        const htmlTagName = rawTagName.toLowerCase();

        source = `if(s.isType(e,${JSON.stringify(htmlTagName)},${JSON.stringify(rawTagName)})){${source}}`;
        break;
      }

      // namespace resolver
      case '|': {
        match = selector.match(snap.re.Patterns.namespace);
        if (!match) throw new Error('Invalid namespace selector: ' + selector);

        const rawPrefix = match[1] as string | undefined;
        const nsPrefix = rawPrefix ? cssIdentUnescape(rawPrefix) : rawPrefix;

        if (nsPrefix === '*') {
          source = `if(true){${source}}`;
        } else if (!nsPrefix) {
          source = `if((!e.namespaceURI)){${source}}`;
        } else if (snap.root.prefix === nsPrefix) {
          throw new Error(`Namespace prefix "${nsPrefix}" is declared in this document but cannot be used in DOM selector APIs: ${expression}`);
        } else {
          throw new Error(`Unresolvable namespace prefix "${nsPrefix}" in selector: ${expression}`);
        }
        break;
      }

      // attributes resolver
      case '[': {
        match = selector.match(snap.re.Patterns.attribute);
        if (!match) throw new Error('Invalid attribute selector: ' + selector);

        const attrName = match[1];
        const pipe = findUnescapedPipe(attrName);

        // nsPrefix can be '*', '', or null. Named prefixes are rejected for now.
        const rawNsPrefix = pipe >= 0 ? attrName.slice(0, pipe) : null;
        const nsPrefix = rawNsPrefix === null ? null : cssIdentUnescape(rawNsPrefix);

        if (nsPrefix !== null && nsPrefix !== '' && nsPrefix !== '*') {
          throw new Error(`Unsupported namespace prefix "${nsPrefix}" in attribute selector: ${selector}`);
        }

        const anyNsArg = nsPrefix === '*' ? 'true' : 'false';

        const rawLocalName = pipe >= 0 ? attrName.slice(pipe + 1) : attrName;
        const localName = cssIdentUnescape(rawLocalName);
        const htmlName = asciiLower(localName);

        const nameArg = JSON.stringify(localName);
        const htmlNameArg = htmlName === localName ? 'null' : JSON.stringify(htmlName); // null = no HTML-name folding needed; use name directly
        const hasColonNameArg = localName.indexOf(':') >= 0 ? 'true' : 'false';

        const attrOp = match[2] as string | undefined;

        // Existence: [attr], [|attr], [*|attr]
        if (!attrOp) {
          source = `if(s.hasAttr(e,${anyNsArg},${nameArg},${htmlNameArg},${hasColonNameArg})){${source}}`;
          break;
        }

        const rawAttrVal = match[4] as string | undefined;
        const attrVal = rawAttrVal === undefined ? undefined : cssIdentUnescape(rawAttrVal);

        if (attrVal === undefined) {
          throw new Error(`Missing attribute value in selector: ${selector}`);
        }

        const rawAttrFlag = match[5] as string | undefined;
        const attrFlag = rawAttrFlag === undefined ? null : cssIdentUnescape(rawAttrFlag).toLowerCase();

        if (attrFlag !== null && attrFlag !== 'i' && attrFlag !== 's') {
          throw new Error(`Invalid attribute selector flag: ${rawAttrFlag}`);
        }

        const sensitivity =
            attrFlag === 'i' ? 1
          : attrFlag === 's' ? 0
          : ATTR_INSENSITIVE.has(htmlName) ? 2
          : 0;

        let pattern: string;
        let negate = false;

        if (attrVal === '') {
          if (attrOp === '=') {
            // Native: [attr=""] and [attr|=""] match only empty values.
            pattern = '=';
          } else if (attrOp === '|=') {
            // Native: [attr|=""] matches only empty or hyphen-only values, not values with non-hyphen characters.
            pattern = '|';
          } else if (attrOp === '^=' || attrOp === '$=' || attrOp === '*=' || attrOp === '~=') {
            // Native: prefix/suffix/contains/token with empty expected value match nothing.
            source = `if(false){${source}}`;
            break;
          } else {
            const test = snap.operators[attrOp];
            if (!test) {
              throw new Error(`Unsupported attributes operator: ${attrOp}, in selector: ${expression}`);
            }

            pattern = `${test.p1}${escapeRegExp(attrVal)}${test.p2}`;
            negate = !test.p3;
          }
        } else if (attrOp === '=') {
          pattern = '=';
        } else if (attrOp === '^=') {
          pattern = '^';
        } else if (attrOp === '$=') {
          pattern = '$';
        } else if (attrOp === '*=') {
          pattern = '*';
        } else if (attrOp === '|=') {
          pattern = '|';
        } else if (attrOp === '~=') {
          if (/[\t\n\f\r ]/.test(attrVal)) {
            // [attr~="a b"] is syntactically valid but can never match one whitespace-separated token.
            source = `if(false){${source}}`;
            break;
          }
          // Keep ~= on the manual token path. A CSS-space regex is faster for one
          // hot repeated token selector, but token-selector churn favors avoiding
          // distinct regex patterns and cache/JIT overhead.
          // pattern = '~';
          pattern = `(^|[\\t\\n\\f\\r ])${escapeRegExp(attrVal)}([\\t\\n\\f\\r ]|$)`;
        } else {
          const test = snap.operators[attrOp];
          if (!test) {
            throw new Error(`Unsupported attributes operator: ${attrOp}, in selector: ${expression}`);
          }

          pattern = `${test.p1}${escapeRegExp(attrVal)}${test.p2}`;
          negate = !test.p3;
        }

        const patternArg = JSON.stringify(pattern);
        const valueArg = JSON.stringify(attrVal);
        const htmlValueArg = JSON.stringify(asciiLower(attrVal));

        const attrExpr =
          `s.matchAttribute(e,${anyNsArg},${nameArg},${htmlNameArg},${hasColonNameArg},` +
          `${patternArg},${valueArg},${htmlValueArg},${sensitivity})`;

        source = `if(${negate ? `!${attrExpr}` : attrExpr}){${source}}`;
        break;
      }

      // *** Subsequent-sibling combinator
      // E ~ F (F relative sibling of E)
      case '~': {
        match = selector.match(snap.re.Patterns.relative);
        if (!match) throw new Error('Invalid relative sibling combinator in selector: ' + selector);

        source = `var N${k}=e;while(e&&(e=e.previousElementSibling)){${source}}e=N${k};`;
        break;
      }

      // *** Adjacent-sibling combinator
      // E + F (F adiacent sibling of E)
      case '+': {
        match = selector.match(snap.re.Patterns.adjacent);
        if (!match) throw new Error('Invalid adjacent sibling combinator in selector: ' + selector);

        source = `var N${k}=e;if(e&&(e=e.previousElementSibling)){${source}}e=N${k};`;
        break;
      }

      // *** Descendant combinator
      // E F (E ancestor of F)
      case '\x09':
      case '\x20': {
        match = selector.match(snap.re.Patterns.ancestor);
        if (!match) throw new Error('Invalid descendant combinator in selector: ' + selector);

        source = `var N${k}=e;while(e&&(e=e.parentElement)){${source}}e=N${k};`;
        break;
      }

      // *** Child combinator
      // E > F (F children of E)
      case '>': {
        match = selector.match(snap.re.Patterns.children);
        if (!match) throw new Error('Invalid child combinator in selector: ' + selector);

        source = `var N${k}=e;if(e&&(e=e.parentElement)){${source}}e=N${k};`;
        break;
      }

      // *** user supplied combinators extensions
      case (symbol in snap.combinators ? symbol : undefined): {
        const symbolPattern = new RegExp(`^\\s?${escapeRegExp(symbol)}\\s?(.*)`);
        match = selector.match(symbolPattern);
        if (!match) throw new Error(`Invalid combinator "${symbol}" in selector: ` + selector);

        const compiler = snap.combinators[symbol];
        source = `var N${k}=e;${compiler(source)}e=N${k};`;
        break;
      }

      // *** tree-structural pseudo-classes
      // :root, :empty, :first-child, :last-child, :only-child, :first-of-type, :last-of-type, :only-of-type
      case ':':
        if ((match = selector.match(snap.re.Patterns.structural))) {
          const pseudo = match[1].toLowerCase();
          switch (pseudo) {
            case 'scope':
              // there can only be one :root element, so exit the loop once found
              source = `if(e===s.scopeEl){${source}}`;
              break;
            case 'root':
              // there can only be one :root element, so exit the loop once found
              source = `if(e===s.root){${source}${mode ? 'break main;' : ''}}`;
              break;
            case 'empty':
              // matches elements that don't contain elements or text nodes
              source = `n=e.firstChild;while(n&&n.nodeType!==1&&n.nodeType!==3){n=n.nextSibling}if(!n){${source}}`;
              break;

            // *** child-indexed pseudo-classes
            // :first-child, :last-child, :only-child
            case 'only-child':
              source = `if(!e.nextElementSibling&&!e.previousElementSibling){${source}}`;
              break;
            case 'last-child':
              source = `if(!e.nextElementSibling){${source}}`;
              break;
            case 'first-child':
              source = `if(!e.previousElementSibling){${source}}`;
              break;

            // *** typed child-indexed pseudo-classes
            // :only-of-type, :last-of-type, :first-of-type
            case 'only-of-type': {
              source =
                `o=e.localName;` +
                `m=e.namespaceURI;` +
                `n=e;` +
                `while((n=n.nextElementSibling)&&(n.localName!==o||n.namespaceURI!==m));` +
                `if(!n){` +
                  `n=e;` +
                  `while((n=n.previousElementSibling)&&(n.localName!==o||n.namespaceURI!==m));` +
                `}` +
                `if(!n){${source}}`;
              break;
            }
            case 'last-of-type': {
              source =
                `n=e;` +
                `o=e.localName;` +
                `m=e.namespaceURI;` +
                `while((n=n.nextElementSibling)&&(n.localName!==o||n.namespaceURI!==m));` +
                `if(!n){${source}}`;
              break;
            }
            case 'first-of-type': {
              source =
                `n=e;` +
                `o=e.localName;` +
                `m=e.namespaceURI;` +
                `while((n=n.previousElementSibling)&&(n.localName!==o||n.namespaceURI!==m));` +
                `if(!n){${source}}`;
              break;
            }
            default:
              throw new Error(`Unsupported structural-tree pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // *** child-indexed & typed child-indexed pseudo-classes
        // :nth-child, :nth-of-type, :nth-last-child, :nth-last-of-type
        else if ((match = selector.match(snap.re.Patterns.treestruct))) {
          const pseudo = match[1].toLowerCase();

          let isOfType = false, isLast = false;
          if      (pseudo === 'nth-child')        { /*defaults*/ }
          else if (pseudo === 'nth-last-child')   { isLast = true; }
          else if (pseudo === 'nth-of-type')      { isOfType = true; }
          else if (pseudo === 'nth-last-of-type') { isOfType = isLast = true; }
          else {
            throw new Error(`Unsupported tree-structural pseudo-class: ${pseudo}, in selector: ${expression}`);
          }

          let nthArg = match[2].toLowerCase().replace(/\s+/g, '');
          nthArg = nthArg.replace(/^[+-]?0n/, '') || '0';
          if (!nthArg) {
            throw new Error(`Missing argument for pseudo-class ${pseudo} in selector: ${expression}`);
          }

          if (nthArg === 'n') {
            // source = `if(true){${source}}`;
            break;
          }

          let nthTest: string;
          if (nthArg === 'even' || nthArg === '2n+0' || nthArg === '2n') {
            nthTest = 'n%2===0';
          } else if (nthArg === 'odd' || nthArg === '2n+1') {
            nthTest = 'n%2===1';
          } else if (!nthArg.includes('n')) {
            const index = parseInt(nthArg, 10);
            nthTest = isOfType
              ? `s.isNthOfType(e,${index},${isLast},h)`
              : `s.isNthElement(e,${index},${isLast},h)`;
            source = `if(${nthTest}){${source}}`;
            break;
          } else {
            const [rawStep, rawOffset = ''] = nthArg.split('n');
            const step = /\d/.test(rawStep) ? parseInt(rawStep, 10) : parseInt(`${rawStep}1`, 10);
            const absStep = Math.abs(step);
            const offset = rawOffset ? parseInt(rawOffset, 10) : 0;
            const shifted = offset ? `(n${offset > 0 ? '-' : '+'}${Math.abs(offset)})` : 'n';
            const periodic = absStep === 1 ? '' : `${shifted}%${absStep}===0`;
            nthTest =
              step > 0 ? `n>${offset - 1}${periodic ? `&&${periodic}` : ''}` :
              step < 0 ? `n<${offset + 1}${periodic ? `&&${periodic}` : ''}` :
              'false';
          }

          const nthCall = isOfType
            ? `s.nthOfType(e,${isLast},h)`
            : `s.nthElement(e,${isLast},h)`;
          source = `n=${nthCall};if(${nthTest}){${source}}`;
          break;
        }

        // *** Logical/relational pseudo-classes.
        // :is(), :where(), and legacy :matches() test the current element against a selector list.
        // :not() negates a selector-list match.
        // :has() evaluates a relative selector list anchored at the current element.
        else if ((match = matchLogicalSelector(selector))) {
          const pseudo = match[1].toLowerCase();
          const expr = match[2]
            .replace(snap.re.CommaGroup, ',')
            .replace(snap.re.TrimSpaces, '');
          const exprLit = JSON.stringify(expr);

          switch (pseudo) {
            case 'is':
            case 'where': {
              source = `if(s.matchForgiving(${exprLit},e,h)){${source}}`;
              break;
            }
            case 'matches':
              throw new Error(`Unsupported pseudo-class :matches(); use :is()`);
            case 'not':
              source = `if(!s.matchStrict(${exprLit},e,h)){${source}}`;
              break;
            case 'has': {
              const list = parseRelativeSelectorList(expr);
              let hasSource = 'o=false;';

              for (const selector of list.selectors) {
                const steps = selector.steps.map(step => [
                  step.combinator,
                  step.compound.source,
                ]);

                hasSource += `if(!o){o=s.matchHas(${JSON.stringify(steps)},e,h);}`;
              }

              source = `${hasSource}if(o){${source}}`;
              break;
            }
            default:
              throw new Error(`Unsupported logical/relational pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // *** linguistic pseudo-classes
        // :dir(ltr / rtl), :lang(en)
        else if ((match = selector.match(snap.re.Patterns.linguistic))) {
          const pseudo = match[1].toLowerCase();
          const expr = match[2].replace(snap.re.TrimSpaces, '').toLowerCase();
          const exprLit = JSON.stringify(expr);

          switch (pseudo) {
            case 'dir':
              source = expr === 'ltr' || expr === 'rtl'
                ? `if(s.matchDir(${exprLit},e)){${source}}`
                : `if(false){${source}}`;
              break;

            case 'lang':
              source = `if(s.matchLang(${exprLit},e)){${source}}`;
              break;

            default:
              throw new Error(`Unsupported linguistic pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // *** location pseudo-classes
        // :any-link, :link, :visited, :target, :defined
        else if ((match = selector.match(snap.re.Patterns.locationpc))) {
          const pseudo = match[1].toLowerCase();

          switch (pseudo) {
            case 'any-link':
            case 'link':
              source = `if(((e.localName==="a"||e.localName==="area"||((m=e.localName.toLowerCase())==="a"||m==="area"))&&e.hasAttribute("href"))){${source}}`;
              break;

            case 'visited':
              // Browser selector APIs do not expose history state to script.
              source = `if(false){${source}}`;
              break;

            case 'target':
              source = `if((m=s.doc.location.hash).length>1&&e.id===m.slice(1)&&(s.doc.compareDocumentPosition(e)&16)){${source}}`;
              break;

            case 'defined':
              source = `if(s.defined(e)){${source}}`;
              break;

            default:
              throw new Error(`Unsupported location pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // *** user actions pseudo-classes
        // :hover, :active, :focus, :focus-visible, :focus-within
        else if ((match = selector.match(snap.re.Patterns.useraction))) {
          const pseudo = match[1].toLowerCase();

          switch (pseudo) {
            case 'hover':
              source =
                `for(n=s.hoverTarget;n;n=n.parentElement){` +
                  `if(n===e){${source}break;}` +
                `}`;
              break;

            case 'active':
              source =
                `for(n=s.activeTarget;n;n=n.parentElement){` +
                  `if(n===e){${source}break;}` +
                `}`;
              break;

            case 'focus':
              source = `if(s.isFocused(e)){${source}}`;
              break;

            // TODO: distinguish :focus-visible from :focus 
            case 'focus-visible':
              source = `if(s.isFocused(e)){${source}}`;
              break;

            case 'focus-within':
              source =
                `if((n=s.doc.activeElement)&&(e===n||e.contains(n))){${source}}`;
              break;

            default:
              throw new Error(`Unsupported user action pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // *** user interface and form pseudo-classes
        // :enabled, :disabled, :read-only, :read-write, :placeholder-shown, :default
        else if ((match = selector.match(snap.re.Patterns.inputstate))) {
          const pseudo = match[1].toLowerCase();
          switch (pseudo) {
            case 'enabled':
              source = `if(s.isEnabled(e)){${source}}`;
              break;

            case 'disabled':
              source = `if(s.isDisabled(e)){${source}}`;
              break;

            case 'read-only':
              source = `if(!s.isReadWrite(e)){${source}}`;
              break;

            case 'read-write':
              source = `if(s.isReadWrite(e)){${source}}`;
              break;

            case 'placeholder-shown':
              source = `if(s.isPlaceholderShown(e)){${source}}`;
              break;

            case 'default':
              source = `if(s.isDefault(e)){${source}}`;
              break;

            default:
              throw new Error(`Unsupported user interface pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // *** input pseudo-classes (for form validation)
        // :checked, :indeterminate, :valid, :invalid, :in-range, :out-of-range, :required, :optional
        else if ((match = selector.match(snap.re.Patterns.inputvalue))) {
          const pseudo = match[1].toLowerCase();
          switch (pseudo) {
            case 'checked':
              source = `if(s.isChecked(e)){${source}}`;
              break;
            
            case 'indeterminate':
              source = `if(s.isIndeterminate(e)){${source}}`;
              break;

            case 'required':
              source = `if(s.isRequired(e)){${source}}`;
              break;

            case 'optional':
              source = `if(s.isOptional(e)){${source}}`;
              break;

            case 'invalid':
              source = `if(s.isInvalid(e)){${source}}`;
              break;

            case 'valid':
              source = `if(s.isValid(e)){${source}}`;
              break;

            case 'in-range':
              source = `if(s.isInRange(e)){${source}}`;
              break;

            case 'out-of-range':
              source = `if(s.isOutOfRange(e)){${source}}`;
              break;

            default:
              throw new Error(`Unsupported form validation pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // resources state pseudo-classes (multimedia state)
        // :playing, :paused, :seeking, :buffering, :stalled, :muted, :volume-locked
        else if ((match = selector.match(snap.re.Patterns.rsrc_state))) {
          const pseudo = match[1].toLowerCase();
          switch (pseudo) {
            case 'playing':
              source = `if(s.isPlaying(e)){${source}}`;
              break;

            case 'paused':
              source = `if(s.isPaused(e)){${source}}`;
              break;

            case 'seeking':
              source = `if(s.isSeeking(e)){${source}}`;
              break;

            case 'muted':
              source = `if(s.isMuted(e)){${source}}`;
              break;

            case 'buffering':
            case 'stalled':
            case 'volume-locked':
              source = `if(false){${source}}`;
              break;
          }
        }

        // placeholder for parse only no-op selectors
        else if ((match = selector.match(snap.re.Patterns.pseudo_nop))) {
          const pseudo = match[1].toLowerCase();
          switch (pseudo) {
            case 'autofill':
            case '-webkit-autofill':
              source = `if(false){${source}}`;
              break;
          }
        }

        // parse-valid legacy single-colon pseudo-elements; match no DOM elements
        else if ((match = selector.match(snap.re.Patterns.pseudo_sng))) {
          source = `if(false){${source}}`;
        }

        // parse-valid double-colon pseudo-elements; match no DOM elements
        else if ((match = selector.match(snap.re.Patterns.pseudo_dbl))) {
          source = `if(false){${source}}`;
        }

        else {

          // reset
          let expr = '';
          let status = false;

          // process registered selector extensions
          for (expr in snap.selectors) {
            if ((match = selector.match(snap.selectors[expr].Expression))) {
              const result = snap.selectors[expr].Callback(match, source, mode);
              if ('match' in result) { match = result.match ?? null; }
              const modvar = result.modvar;
              if (modvar && !out.modvar.includes(modvar)) { out.modvar.push(modvar); }
              // extension source code
              source = result.source;
              // extension status code
              status = result.status;
              // break on status error
              if (status) { break; }
            }
          }

          if (!status) {
            throw new Error(`Unrecognized selector component: ${selector} in selector: ${expression}`);
          }

          if (!expr) {
            throw new Error(`Selector extension did not specify an expression: ${selector} in selector: ${expression}`);
          }

        }
        break;

    default:
      throw new Error(`Unexpected token '${symbol}' in selector: ${expression}`);

    }
    // end of switch symbol

    if (!match) {
      throw new Error(`Failed to parse selector component: ${selector} in selector: ${expression}`);
    }

    // pop last component
    selector = match.pop();
  }
  // end of while selector

  out.source = source;
  return out;
}

// Parse a normal selector list. In forgiving mode, invalid selector-list arms
// are dropped; this is intended for :is()/:where() argument parsing.
export function parse(selectors: string, re: Rex, forgiving = false): string[] {
  if (selectors === '') {
    throw new Error(`[parse] '' is not a valid selector`);
  }

  const normalized = normalizeSelectorInput(selectors, re);

  if (!forgiving && normalized.endsWith(',')) {
    throw new Error(`[parse] Selector cannot end with a comma: '${selectors}'`);
  }

  const groups = splitSelectorGroups(normalized)
    .map(group => trimSelectorSpaces(group));

  const valid: string[] = [];

  for (const group of groups) {
    if (!group) {
      if (!forgiving) {
        throw new Error(`[parse] Empty selector-list item in selector: '${selectors}'`);
      }
      continue;
    }

    if (/^[>+~]/.test(group)) {
      if (!forgiving) {
        throw new Error(`[parse] Relative selector is not valid here: '${group}'`);
      }
      continue;
    }

    const validated = group.match(re.validator);
    if (validated?.join('') === group) {
      valid.push(group);
      continue;
    }

    if (!forgiving) {
      throw new Error(`[parse] Failed to validate selector: '${group}'`);
    }
  }

  return valid;
}

export function normalizeSelectorInput(selectors: string, re: Rex): string {
  let
  normalized = stripCssComments(selectors);
  normalized = normalizeNestingSelector(normalized);
  normalized = normalized
    .replace(/\x00|\\$/g, '\ufffd')
    .replace(re.CombineWSP, '\x20')
    .replace(re.PseudosWSP, '$1$2')
    .replace(re.TabCharWSP, '\t')
    .replace(re.CommaGroup, ',')
    // .replace(re.TrimSpaces, '');
  normalized = trimSelectorSpaces(normalized);
  return normalized;
}

// equivalent of w3c 'matches' method
function matchRaw(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  snap.probe.match++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugMatch(snap, selectors, element, true /*isApiEntry*/);

  const resolver = getStrictMatchResolver(selectors, snap);

  if (resolver.usesScope) {
    updateSnapshot(snap, element, true);
  }

  const result = resolver.lambdas.some(f => f(element, h));

  if (isDebug) updateDebugMatch(snap, resolver, result);

  return result;
}

function matchStrict(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  const resolver = getStrictMatchResolver(selectors, snap);
  return resolver.lambdas.some(f => f(element, h));
}

function matchForgiving(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  const resolver = getForgivingMatchResolver(selectors, snap);
  return resolver.lambdas.some(f => f(element, h));
}

function getStrictMatchResolver(selectors: string, snap: Snapshot): MatchResolver {
  let resolver = snap.strictMatchResolvers[selectors];

  if (!resolver) {
    const parsed = parse(selectors, snap.re);

    if (snap.isDebug && snap.debugMatch) {
      snap.debugMatch.parsed = parsed;
    }

    resolver = snap.strictMatchResolvers[selectors] = buildStrictMatchResolver(parsed, snap);
  }

  return resolver;
}

function getForgivingMatchResolver(selectors: string, snap: Snapshot): MatchResolver {
  let resolver = snap.forgivingMatchResolvers[selectors];

  if (!resolver) {
    const parsed = parse(selectors, snap.re, true);

    if (snap.isDebug && snap.debugMatch) {
      snap.debugMatch.parsed = parsed;
    }

    resolver = snap.forgivingMatchResolvers[selectors] = buildForgivingMatchResolver(parsed, snap);
  }

  return resolver;
}

function buildStrictMatchResolver(selectors: string[], snap: Snapshot): MatchResolver {
  const lambdas: MatchLambda[] = [];
  snap.probe.matBuild++;

  for (let i = 0, l = selectors.length; i < l; ++i) {
    lambdas[i] = compile(selectors[i], false /*select/match mode*/, false /*cb*/, snap);
  }

  return {
    lambdas,
    usesScope: hasScopeSelector(selectors),
  };
}

function buildForgivingMatchResolver(selectors: string[], snap: Snapshot): MatchResolver {
  const lambdas: MatchLambda[] = [];
  snap.probe.matBuild++;

  for (let i = 0, l = selectors.length; i < l; ++i) {
    try {
      lambdas.push(compile(selectors[i], false, false, snap));
    } catch {
      // Invalid arm in a forgiving selector list.
    }
  }

  return {
    lambdas,
    usesScope: false, // forgiving match is only used for :is()/:where() arms, which are not entry points.
  };
}

// equivalent of w3c 'querySelectorAll' method
function selectRaw(sel: string, ctx: QueryContext, cb: QueryCallback | null, snap: Snapshot, isApiEntry = false): Element[] {
  snap.probe.select++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugSelect(snap, sel, cb, ctx, isApiEntry);

  // try to reuse cached resolver
  let resolver = snap.selectResolvers[sel];
  if (!resolver || resolver.hasCb !== !!cb) {
    const parsed = parse(sel, snap.re);
    resolver = buildSelectResolver(parsed, !!cb, snap);
    snap.selectResolvers[sel] = resolver;
  }

  updateSnapshot(snap, ctx, isApiEntry && resolver.usesScope);

  let results: Element[] = [];
  const cache: HashCache = {};
  const seeds = resolver.seeds;

  for (const seed of seeds) {
    const candidates = seed.getCandidates(ctx);
    const stopped = seed.lambda(candidates, cb, ctx, results, cache);

    if (isDebug) updateDebugSelectRun(snap, seed, candidates, results);
    if (stopped) break;
  }

  if (seeds.length > 1 && results.length > 1) {
    results = sortUnique(results);
  }

  return results;
}

function buildSelectResolver(selectors: string[], hasCb: boolean, snap: Snapshot): SelectResolver {
  const seeds: CandidateSeed[] = [];
  const usesScope = hasScopeSelector(selectors);

  snap.probe.selBuild++;

  for (const sel of selectors) {
    let { key, query, compileQuery } = getOptimizedPlan(sel, snap);

    // Normalize optimized DOM lookups so candidate seeds remain selector-equivalent.
    let getCandidates: GetCandidates;
    switch (key) {
      case '#': {
        query = cssIdentUnescape(query);
        getCandidates = (ctx) => getCandidatesById(query, ctx, snap);
        break;
      }
      case '.': {
        query = cssIdentUnescape(query);
        // classname lookup accepts whitespace queries that QSA class selectors do not.
        getCandidates = /[\t\n\f\r ]/.test(query)
          ? () => []
          : (ctx) => byClassRaw(query, ctx, snap);
        break;
      }
      case '*': {
        query = cssIdentUnescape(query);
        getCandidates = (ctx) => seedsByTag(query, ctx, snap);
        break;
      }
      default: assertNever(key);
    }

    if (snap.isDebug) {
      snap.debugSelect?.build.push({ selector: sel, seedKey: key, seedQuery: query, compileQuery });
    }

    seeds.push({
      key, query, compileQuery, getCandidates,
      lambda: compile(compileQuery, true, hasCb, snap),
    });
  }

  return {
    seeds, usesScope, hasCb,
  }
}

// function buildSelectRunner(seeds: CandidateSeed[], hasCb: boolean, snap: Snapshot): SelectRunner {
//   if (!hasCb && seeds.length === 1 && seeds[0].pass) {
//     const seed = seeds[0];
//     return (ctx) => seed.getCandidates(ctx);
//   }

//   return (ctx, cb) => {
//     let results: Element[] = [];
//     const cache: HashCache = {};
//     const isDebug = snap.isDebug;

//     for (const seed of seeds) {
//       const candidates = seed.getCandidates(ctx);
//       const stopped = seed.lambda(candidates, cb, ctx, results, cache);

//       // if (isDebug) updateDebugSelectRun(snap, seed, candidates, results);
//       if (stopped) break;
//     }

//     if (seeds.length > 1 && results.length > 1) {
//       results = sortUnique(results);
//     }

//     return results;
//   }
// }

function getOptimizedPlan(selector: string, snap: Snapshot): CandidatePlan {
  const token = selector.match(snap.re.optimizer);

  if (!token || token[1] === ':') {
    return {
      key: '*',
      query: '*',
      compileQuery: selector,
    };
  }

  const index = token.index;
  if (index === undefined) throw new Error('Invalid token: ' + token);

  const key = token[1] || '*';
  if (key !== '.' && key !== '#' && key !== '*') {
    throw new SyntaxError(`invalid selector for optimization '${selector}'`);
  }

  const length = token[1].length + token[2].length;
  const compileQuery =
    selector.slice(0, index) +
    (' >+~'.indexOf(selector.charAt(index - 1)) > -1
      ? (':['.indexOf(selector.charAt(index + length + 1)) > -1 ? '*' : '')
      : '') +
    selector.slice(index + length - (token[1] == '*' ? 1 : 0));

  return {
    key,
    query: token[2],
    compileQuery,
  };
}

// equivalent of w3c 'closest' method
function ancestorRaw(selectors: string, element: Element, snap: Snapshot): Element | null {
  let el: Element | null = element;
  updateSnapshot(snap, element, true);
  while (el) {
    if (matchStrict(selectors, el, snap, null)) break;
    el = el.parentElement;
  }
  return el;
}

const stopAfterFirst: QueryCallback = () => false;

// equivalent of w3c 'querySelector' method
function firstRaw(selectors: string, context: QueryContext, snap: Snapshot, isApiEntry = true): Element | null {
  return selectRaw(selectors, context, stopAfterFirst, snap, isApiEntry)[0] || null;
}

export function matchLogicalSelector(selector: string): RegExpMatchArray | null {
  const head = /^:(is|where|matches|not|has)\(/i.exec(selector);
  if (!head) return null;

  const open = head[0].length - 1;
  let close = findClosingParen(selector, open);

  // Browser-compatible tolerance: a missing final ")" on these functional
  // pseudos is treated as if the pseudo closed at EOF.
  if (close < 0) close = selector.length;

  const argStart = open + 1;
  const arg = selector.slice(argStart, close).trim();
  const tail = close < selector.length ? selector.slice(close + 1) : '';

  return Object.assign([selector, head[1], arg, tail], {
    index: 0,
    input: selector,
  }) as RegExpMatchArray;
}

function findClosingParen(input: string, openIndex: number): number {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  let inAttr = false;

  for (let i = openIndex + 1; i < input.length; i++) {
    const ch = input[i];

    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (inAttr) { if (ch === ']') inAttr = false; continue; }
    if (ch === '[') { inAttr = true; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }

  return -1;
}

// Scans selector chars that are top-level with respect to escapes, strings, attribute selectors, and parentheses.
// The visitor returns how many chars it consumed from `index`.
function scanTopLevel(source: string, visit: (index: number, ch: string) => number): void {
  let depth = 0;
  let quote = '';
  let inAttr = false;

  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === '\\') i += 2;
    else if (quote) { if (ch === quote) quote = ''; i++; }
    else if (ch === '"' || ch === "'") { quote = ch; i++; }
    else if (inAttr) { if (ch === ']') inAttr = false; i++; }
    else if (ch === '[') { inAttr = true; i++; }
    else if (ch === '(') { depth++; i++; }
    else if (ch === ')' && depth) { depth--; i++; }
    else if (depth !== 0) i++;
    else {
      const consumed = visit(i, ch);
      if (consumed <= 0) throw new Error('scanTopLevel visitor must consume at least one character');
      i += consumed;
    }
  }
}

export function splitSelectorGroups(selector: string): string[] {
  const out: string[] = [];
  let start = 0;

  scanTopLevel(selector, (index, ch) => {
    if (ch === ',') {
      out.push(selector.slice(start, index));
      start = index + 1;
    }

    return 1;
  });

  out.push(selector.slice(start));
  return out;
}

function findUnescapedPipe(str: string): number {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') { i++; continue; }
    if (str[i] === '|') return i;
  }
  return -1;
}

export function parseRelativeSelectorList(source: string): RelativeSelectorList {
  const selectors = splitSelectorGroups(source).map(raw => {
    const branch = raw.trim();
    return parseRelativeSelector(branch);
  });

  return {
    kind: 'relative-selector-list', source, selectors,
  };
}

function parseRelativeSelector(source: string): RelativeSelector {
  return {
    kind: 'relative', source, steps: parseRelativeSteps(source),
  };
}

function parseRelativeSteps(source: string): RelativeStep[] {
  const steps: RelativeStep[] = [];

  let combinator: SelectorCombinator = ' ';
  let start = skipSelectorSpaces(source, 0);

  const push = (end: number) => {
    const compound = source.slice(start, end).trim();

    if (!compound) {
      return false;
    }

    steps.push({
      kind: 'relative-step',
      combinator,
      compound: {
        kind: 'compound',
        source: compound,
      },
    });

    combinator = ' ';
    return true;
  };

  scanTopLevel(source, (index, ch) => {
    if (index < start) {
      return 1;
    }

    if (isExplicitCombinator(ch)) {
      push(index);
      combinator = ch;

      const next = skipSelectorSpaces(source, index + 1);
      start = next;

      return next - index;
    }

    if (isSelectorSpace(ch)) {
      const next = skipSelectorSpaces(source, index + 1);
      const nextChar = source[next];

      // Whitespace before explicit combinator is padding:
      // `.a   > .b`
      if (isExplicitCombinator(nextChar)) {
        return next - index;
      }

      // Trailing whitespace.
      if (next >= source.length) {
        return source.length - index;
      }

      // Otherwise whitespace is a descendant combinator.
      push(index);
      combinator = ' ';
      start = next;

      return next - index;
    }

    return 1;
  });

  push(source.length);

  return steps;
}

function isExplicitCombinator(ch: string): ch is '>' | '+' | '~' {
  return ch === '>' || ch === '+' || ch === '~';
}

function skipSelectorSpaces(source: string, index: number): number {
  while (index < source.length && isSelectorSpace(source[index])) {
    index++;
  }
  return index;
}

function isSelectorSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f';
}

function stripCssComments(s: string): string {
  let out = '';
  let quote = '';

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '\\') {
      out += ch;
      if (i + 1 < s.length) out += s[++i];
    } else if (quote) {
      out += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      if (i < s.length) i++;
      out += ' ';
    } else {
      out += ch;
    }
  }

  return out;
}

function normalizeNestingSelector(s: string): string {
  let out = '';
  let quote = '';
  let inAttr = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '\\') {
      out += ch + (s[++i] ?? '');
      continue;
    }

    if (quote) {
      out += ch;
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (inAttr) {
      if (ch === ']') inAttr = false;
      out += ch;
    } else if (ch === '[') {
      inAttr = true;
      out += ch;
    } else {
      out += ch === '&' ? ':scope' : ch;
    }
  }

  return out;
}

function hasScopeSelector(selectors: string[]) {
  return selectors.some(sel => /:scope\b/i.test(sel));
}

function getCachedRegex(source: string, flags: string, snap: Snapshot): RegExp {
  const key = flags + '\0' + source;
  return snap.regexCache[key] || (snap.regexCache[key] = new RegExp(source, flags));
}

export function trimSelectorSpaces(input: string): string {
  let start = 0;
  let end = input.length;

  while (start < end && isCssSpace(input.charCodeAt(start))) {
    start++;
  }

  while (end > start && isCssSpace(input.charCodeAt(end - 1))) {
    if (isEscapedAt(input, end - 1, start)) break;
    end--;
  }

  return input.slice(start, end);
}

function isEscapedAt(input: string, index: number, start = 0): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= start && input[i] === '\\'; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function selectLambdaKey(selector: string, hasCb: boolean): string {
  return `${hasCb ? '\x01' : '\x00'}${selector}`;
}

function initDebugMatch(snap: Snapshot, selectors: string, element: Element, isApiEntry: boolean): void {
  snap.debugStack.length = 0;
  const dbg: DebugMatch = {
    kind: 'match',
    isApiEntry,
    element: describeContext(element),
    selector: selectors,
  };

  snap.debugMatch = dbg;
  snap.debugStack.push(dbg);
}

function updateDebugMatch(snap: Snapshot, resolver: MatchResolver, result: boolean): void {
  if (snap.debugMatch) {
    snap.debugMatch.lambdaSource = resolver.lambdas.map(f => String(f));
    snap.debugMatch.result = result;
  }
}

function initDebugSelect(snap: Snapshot, sel: string, cb: QueryCallback | null, ctx: QueryContext, isApiEntry: boolean): void {
  if (isApiEntry) snap.debugStack.length = 0;
  const dbgSelect: DebugSelect = {
    kind: 'select',
    isApiEntry,
    selector: sel,
    callback: cb,
    context: describeContext(ctx),
    build: [],
    run: [],
  };
  snap.debugSelect = dbgSelect;
  snap.debugStack.push(dbgSelect);
}

function updateDebugSelectRun(snap: Snapshot, seed: CandidateSeed, candidates: Element[], results: Element[]): void {
  snap.debugSelect?.run.push({
    seedKey: seed.key,
    seedQuery: seed.query,
    compileQuery: seed.compileQuery,
    candidates: describeElements(candidates),
    lambdaSource: String(seed.lambda),
    results: describeElements(results),
  });
}
