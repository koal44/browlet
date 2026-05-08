function Factory(fGlobal: Glob, fExport: Function): DomApi {
  const _doc = fGlobal.document;
  const _snap = initSnapshot(_doc);

  // handlers needed for the :hover pseudo-class; track state change in browsers and headless
  _doc.addEventListener('mouseover', (e) => { _snap.hoverTarget = isElement(e.target) ? e.target : null; }, true);
  _doc.addEventListener('mouseout', () => { _snap.hoverTarget = null; }, true);

  // Track pointer-down state for :active. This approximates native activation for common HTML activatable/focusable elements;
  // full formal activation state is browser-internal and not modeled here.
  _doc.addEventListener('pointerdown', (e) => {
    const target = e.target;
    _snap.activeTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  }, true);
  _doc.addEventListener('pointerup', () => { _snap.activeTarget = null; }, true);
  _doc.addEventListener('pointercancel', () => { _snap.activeTarget = null; }, true);

  // handlers needed for the :focus pseudo-class; activeElement can fall back to body/html
  // even when no element actually matches :focus.
  _doc.addEventListener('focusin', (e) => {
    const target = e.target;
    _snap.focusTarget = isElement(target) ? target : isText(target) ? target.parentElement : null;
  }, true);

  _doc.addEventListener('focusout', (e) => {
    const target = e.target;
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

    first(sel, ctx, cb) {
      return _snap.first(sel, ctx, cb ?? null, true);
    },

    match(sel, ctx, cb) {
      return _snap.match(sel, ctx, cb ?? null, true);
    },

    select(sel, ctx, cb) {
      const result = _snap.select(sel, ctx, cb ?? null, true);
      return _snap.config.NODE_LIST ? toNodeList(result, _snap.doc) : result;
    },

    closest(sel, ctx, cb) {
      return _snap.ancestor(sel, ctx, cb ?? null, true);
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
        for (const k in _snap.matchResolvers) delete _snap.matchResolvers[k];
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
          if (!isIFrame(evTarget)) return;

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
        debugSelect: _snap.debugSelect,
        debugMatch: _snap.debugMatch,
      }, null, 2);
    },

  };

  updateSnapshot(_snap, _doc);

  return Dom;
}

export const DEFAULT_CONFIG: NwsConfig = {
  NODE_LIST: false,
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
    re: {} as Rex,

    isDebug: false,
    debugSelect: undefined as DebugSelect | undefined,
    debugMatch: undefined as DebugMatch | undefined,

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
    matchLambdas: {} as Partial<Record<string, MatchLambdaEntry>>,
    selectLambdas: {} as Partial<Record<string, SelectLambdaEntry>>,
    matchResolvers: {} as Partial<Record<string, MatchResolver>>,
    selectResolvers: {} as Partial<Record<string, SelectResolver>>,

    byId: (id: string, context?: QueryContext) => byId(id, context ?? snap.doc, snap),
    byTag: (tag: string, context?: QueryContext) => byTagRaw(tag, context ?? snap.doc, snap),
    byTagNs: (ns: string | null, local: string, context?: QueryContext) => byTagNsRaw(ns, local, context ?? snap.doc, snap),
    byClass: (cls: string, context?: QueryContext) => byClassRaw(cls, context ?? snap.doc, snap),
    first: (sel: string, context?: QueryContext, cb?: QueryCallback | null, updateScope = false) => {
      context ??= snap.doc;
      updateSnapshot(snap, context, updateScope);
      return firstRaw(sel, context, cb ?? null, snap);
    },
    match: (sel: string, context: Element, cb?: QueryCallback | null, updateScope = false) => {
      updateSnapshot(snap, context, updateScope);
      return matchRaw(sel, context, cb ?? null, snap);
    },
    select: (sel: string, context?: QueryContext, cb?: QueryCallback | null, updateScope = false) => {
      context ??= snap.doc;
      updateSnapshot(snap, context, updateScope);
      return selectRaw(sel, context, cb ?? null, snap);
    },
    ancestor: (sel: string, context: Element, cb?: QueryCallback | null, updateScope = false) => {
      updateSnapshot(snap, context, updateScope);
      return ancestorRaw(sel, context, cb ?? null, snap);
    },

    isType: isType,
    nthOfType: nthOfType,
    nthElement: nthElement,
    matchHas: (steps: [SelectorCombinator, string][], anchor: Element) => matchHasFrom(steps, 0, anchor, snap),
    matchDir: matchDir,
    matchLang: matchLang,
    defined: (element: Element) => isDefined(element, snap),
    isDisabled: isDisabled,
    isReadWrite: isReadWrite,
    isFormStateElement: isFormStateElement,
    isPlaceholderShown: isPlaceholderShown,
    isDefault: isDefault,
    isChecked: isChecked,
    isIndeterminate: isIndeterminate,
    isRequired: isRequired,
    isOptional: isOptional,
    isValid: (e: Element) => isValid(e, snap),
    isInvalid: (e: Element) => isInvalid(e, snap),
    isInRange: isInRange,
    isOutOfRange: isOutOfRange,
    isPlaying: isPlaying,
    isPaused: isPaused,
    isSeeking: isSeeking,
    isMuted: isMuted,
    matchAttribute: (e: Element, ns: string | null, local: string, pattern: string | null, flag: string | null) => matchAttribute(e, ns, local, pattern, flag, snap),
    attrValueCaseFlag: (e: Element, localName: string, attrFlag: string | undefined) => attrValueCaseFlag(e, localName, attrFlag, snap),
    isFocused: (node: Element) => isFocused(node, snap),
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

function updateSnapshot(snap: Snapshot, ctx: QueryContext, updateScope = false): Snapshot {
  const doc = ctx.ownerDocument ?? ctx;

  if (snap.doc !== doc) {
    snap.doc = doc;
    snap.root = doc.documentElement;
    snap.isHtml = isHtmlDoc(doc);
    snap.isQuirksMode = isQuirksMode(doc);
    snap.namespace = getNamespace(doc);
  }

  // Debug breadcrumb only
  snap.from = ctx;

  if (updateScope) {
    snap.scopeEl = isDocument(ctx) ? ctx.documentElement : isElement(ctx) ? ctx : null;
  }

  return snap;
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

// find duplicate ids using tree-order walk
function byIdRaw(id: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);
  if (!id) return [];

  const nodes: Element[] = [];
  walkElements(context, e => {
    if (e.getAttribute('id') === id) nodes.push(e);
  });

  return nodes;
}

// context-agnostic getElementById
function byId(id: string, context: QueryContext, snap: Snapshot): Element | null {
  updateSnapshot(snap, context);
  if (!id) return null;

  if (!isElement(context)) return context.getElementById(id);

  let found: Element | null = null;
  walkElements(context, e => {
    if (e.getAttribute('id') === id) {
      found = e;
      return false;
    }
  });

  return found;
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

function isType(e: Element, name: string): boolean {
  // console.error('isType', { e, name });
  // console.error('isHtmlElement', isHtmlElement(e));
  return isHtmlElement(e)
    ? e.localName === name.toLowerCase()
    : e.localName === name;
}

function hasAttribute(e: Element, nsPrefix: string | null, localName: string, snap: Snapshot): boolean {
  const attrs = e.attributes;
  const isHtml = snap.isHtml && isHtmlElement(e);

  if (nsPrefix === null) {
    const expected = isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.namespaceURI != null) continue;
      const actual = isHtml ? attr.localName.toLowerCase() : attr.localName;
      if (actual === expected) return true;
    }
    return false;
  }

  if (nsPrefix === '*') {
    const expected = isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const actual = isHtml ? attrs[i].localName.toLowerCase() : attrs[i].localName;
      if (actual === expected) return true;
    }
    return false;
  }

  if (nsPrefix === '') {
    return e.hasAttributeNS?.(null, localName) ?? false;
  }

  const uri = e.lookupNamespaceURI?.(nsPrefix) ?? snap.doc.lookupNamespaceURI?.(nsPrefix);
  return !!uri && e.hasAttributeNS(uri, localName);
}

function getAttribute(e: Element, nsPrefix: string | null, localName: string, snap: Snapshot): string | null {
  const attrs = e.attributes;
  const isHtml = snap.isHtml && isHtmlElement(e);

  if (nsPrefix === null) {
    const expected = isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.namespaceURI != null) continue;
      const actual = isHtml ? attr.localName.toLowerCase() : attr.localName;
      if (actual === expected) return attr.value;
    }
    return null;
  }

  if (nsPrefix === '*') {
    const expected = isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const actual = isHtml ? attrs[i].localName.toLowerCase() : attrs[i].localName;
      if (actual === expected) return attrs[i].value;
    }
    return null;
  }

  if (nsPrefix === '') {
    return e.getAttributeNS?.(null, localName) ?? null;
  }

  const uri = e.lookupNamespaceURI?.(nsPrefix) ?? snap.doc.lookupNamespaceURI?.(nsPrefix);
  return uri && e.getAttributeNS ? e.getAttributeNS(uri, localName) : null;
}

function attrValueCaseFlag(e: Element, localName: string, attrFlag: string | undefined, snap: Snapshot): string {
  if (attrFlag === 'i') return 'i';
  if (attrFlag === 's') return '';
  return snap.isHtml && isHtmlElement(e) && ATTR_INSENSITIVE.has(localName.toLowerCase()) ? 'i' : '';
}

function matchAttribute(e: Element, ns: string | null, local: string, pattern: string | null, flag: string | null, snap: Snapshot): boolean {
  const attrs = e.attributes;
  const isHtml = snap.isHtml && isHtmlElement(e);
  const expectedName = isHtml ? local.toLowerCase() : local;

  const insensitive =
    flag === 'i' ? true :
    flag === 's' ? false :
    isHtml && ATTR_INSENSITIVE.has(local.toLowerCase());

  const nsUri =
    ns && ns !== '*'
      ? e.lookupNamespaceURI?.(ns) ?? snap.doc.lookupNamespaceURI?.(ns)
      : null;

  if (ns && ns !== '*' && !nsUri) return false;

  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];

    if (ns === null || ns === '') {
      if (attr.namespaceURI !== null) continue;
    } else if (ns !== '*') {
      if (attr.namespaceURI !== nsUri) continue;
    }

    const actualName = isHtml ? attr.localName.toLowerCase() : attr.localName;
    if (actualName !== expectedName) continue;

    if (pattern === null) return true;
    if (matchAttrValue(attr.value, pattern, insensitive)) return true;
  }

  return false;
}

function matchAttrValue(value: string, pattern: string, insensitive: boolean): boolean {
  const source = insensitive ? asciiLower(pattern) : pattern;
  const actual = insensitive ? asciiLower(value) : value;
  return new RegExp(source).test(actual);
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 32));
}


type NthElementState = {
  idx: number; len: number; set: number; parent: Element | null | undefined; parents: (Element | null)[]; nodes: Element[][];
}
const nthState: NthElementState = {
  idx: 0, len: 0, set: 0, parent: undefined, parents: [], nodes: []
};
// fast resolver for the :nth-child() and :nth-last-child() pseudo-classes
function nthElement(element: Element, dir: boolean | 2): number {
  // ensure caches are emptied after each run, invoking with dir = 2
  if (dir == 2) {
    nthState.idx = 0; nthState.len = 0; nthState.set = 0; nthState.nodes.length = 0;
    nthState.parents.length = 0; nthState.parent = undefined;
    return -1;
  }
  let e: Element | null, i: number, j: number, k: number, l: number;
  if (nthState.parent === element.parentElement) {
    i = nthState.set; j = nthState.idx; l = nthState.len;
  } else {
    l = nthState.parents.length;
    nthState.parent = element.parentElement;
    for (i = -1, j = 0, k = l - 1; l > j; ++j, --k) {
      if (nthState.parents[j] === nthState.parent) { i = j; break; }
      if (nthState.parents[k] === nthState.parent) { i = k; break; }
    }
    if (i < 0) {
      nthState.parents[i = l] = nthState.parent;
      l = 0; nthState.nodes[i] = [];
      e = nthState.parent?.firstElementChild ?? element;
      while (e) { nthState.nodes[i][l] = e; if (e === element) j = l; e = e.nextElementSibling; ++l; }
      nthState.set = i; nthState.idx = 0; nthState.len = l;
      if (l < 2) return l;
    } else {
      l = nthState.nodes[i].length;
      nthState.set = i;
    }
  }
  if (element !== nthState.nodes[i][j] && element !== nthState.nodes[i][j = 0]) {
    for (j = 0, k = l - 1; l > j; ++j, --k) {
      const nodes = nthState.nodes[i]
      if (nodes[j] === element) { break; }
      if (nodes[k] === element) { j = k; break; }
    }
  }
  nthState.idx = j + 1; nthState.len = l;
  return dir ? l - j : nthState.idx;
};

type NthOfTypeState = {
  idx: number; len: number; set: number; parent: Element | null; parents: (Element | null)[]; nodes: Record<string, Element[]>[];
}
const nthOfTypeState: NthOfTypeState = {
  idx: 0, len: 0, set: 0, parent: null, parents: [], nodes: []
};

// fast resolver for the :nth-of-type() and :nth-last-of-type() pseudo-classes
const nthOfType: NthFn = function(element: Element, dir: boolean | 2): number {
  // ensure caches are emptied after each run, invoking with dir = 2
  if (dir == 2) {
    nthOfTypeState.idx = 0; nthOfTypeState.len = 0; nthOfTypeState.set = 0; nthOfTypeState.nodes.length = 0;
    nthOfTypeState.parents.length = 0; nthOfTypeState.parent = null;
    return -1;
  }

  let e: Element | null, i: number, j: number, k: number, l: number;
  const name = element.localName;
  const namespace = element.namespaceURI ?? '';
  const typeKey = `${namespace}\x00${name}`;

  if (nthOfTypeState.nodes[nthOfTypeState.set]?.[typeKey] && nthOfTypeState.parent === element.parentElement) {
    i = nthOfTypeState.set; j = nthOfTypeState.idx; l = nthOfTypeState.len;
  } else {
    l = nthOfTypeState.parents.length;
    nthOfTypeState.parent = element.parentElement;
    for (i = -1, j = 0, k = l - 1; l > j; ++j, --k) {
      if (nthOfTypeState.parents[j] === nthOfTypeState.parent) { i = j; break; }
      if (nthOfTypeState.parents[k] === nthOfTypeState.parent) { i = k; break; }
    }
    if (i < 0 || !nthOfTypeState.nodes[i]?.[typeKey]) {
      nthOfTypeState.parents[i = l] = nthOfTypeState.parent;
      nthOfTypeState.nodes[i] || (nthOfTypeState.nodes[i] = {});
      l = 0; nthOfTypeState.nodes[i][typeKey] = [];
      e = nthOfTypeState.parent?.firstElementChild ?? element;
      while (e) {
        if (e.localName === name && (e.namespaceURI ?? '') === namespace) {
          if (e === element) j = l;
          nthOfTypeState.nodes[i][typeKey][l] = e;
          ++l;
        }
        e = e.nextElementSibling;
      }
      nthOfTypeState.set = i; nthOfTypeState.idx = j; nthOfTypeState.len = l;
      if (l < 2) return l;
    } else {
      l = nthOfTypeState.nodes[i][typeKey].length;
      nthOfTypeState.set = i;
    }
  }

  if (element !== nthOfTypeState.nodes[i][typeKey][j] && element !== nthOfTypeState.nodes[i][typeKey][j = 0]) {
    const nodes = nthOfTypeState.nodes[i][typeKey];
    for (j = 0, k = l - 1; l > j; ++j, --k) {
      if (nodes[j] === element) { break; }
      if (nodes[k] === element) { j = k; break; }
    }
  }

  nthOfTypeState.idx = j + 1;
  nthOfTypeState.len = l;

  return dir ? l - j : nthOfTypeState.idx;
};

function isFocused(node: Element, snap: Snapshot): boolean {
  const doc = node.ownerDocument;

  if (!doc || !doc.hasFocus()) return false;
  if (isIFrame(node)) return false;

  if (node === doc.body || node === doc.documentElement) {
    return node === snap.focusTarget;
  }

  return node === doc.activeElement;
}

function matchHasFrom(steps: [SelectorCombinator, string][], index: number, base: Element, snap: Snapshot): boolean {
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
        if (snap.match(source, node) && matchHasFrom(steps, next, node, snap)) {
          return true;
        }
      }
      return false;

    case '>':
      for (let node = base.firstElementChild; node; node = node.nextElementSibling) {
        if (snap.match(source, node) && matchHasFrom(steps, next, node, snap)) {
          return true;
        }
      }
      return false;

    case '+': {
      const node = base.nextElementSibling;
      return !!node && snap.match(source, node) && matchHasFrom(steps, next, node, snap);
    }

    case '~':
      for (let node = base.nextElementSibling; node; node = node.nextElementSibling) {
        if (snap.match(source, node) && matchHasFrom(steps, next, node, snap)) {
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

function matchLang(value: string, element: Element): boolean {
  const wanted = value.toLowerCase();

  for (let node: Element | null = element; node; node = node.parentElement) {
    const actual = node.getAttribute('lang');

    if (actual) {
      const lang = actual.toLowerCase();
      return lang === wanted || lang.startsWith(wanted + '-');
    }
  }

  return false;
}

function matchDir(value: string, element: Element): boolean {
  const wanted = value.toLowerCase();

  if (wanted !== 'ltr' && wanted !== 'rtl') {
    return false;
  }

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
  if (!isFormStateElement(e)) return false;
  if (e.disabled) return true;

  if (isHtmlOption(e)) {
    const parent = e.parentElement;
    return !!parent && isHtmlOptGroup(parent) && parent.disabled;
  }

  if (isHtmlOptGroup(e)) return false;

  for (let n = e.parentElement; n; n = n.parentElement) {
    if (!isHtmlFieldSet(n) || !n.disabled) continue;

    for (const child of n.children) {
      if (isHtmlLegend(child)) {
        return !child.contains(e);
      }
    }

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

// function isFormValueElement(e: Element): e is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
//   return isHtmlInput(e) || isHtmlSelect(e) || isHtmlTextArea(e);
// }

// function isOptional(e: Element): boolean {
//   return isFormValueElement(e) && !isRequired(e);
// }

function isInvalid(e: Element, snap: Snapshot): boolean {
  if (isHtmlForm(e)) return !e.checkValidity();

  if (isHtmlFieldSet(e)) {
    return !!snap.first(':invalid', e);
  }

  if (isValidityElement(e)) {
    return e.willValidate && !e.checkValidity();
  }

  return false;
}

function isValid(e: Element, snap: Snapshot): boolean {
  if (isHtmlForm(e)) return e.checkValidity();

  if (isHtmlFieldSet(e)) {
    return !snap.first(':invalid', e);
  }

  if (isValidityElement(e)) {
    return e.willValidate && e.checkValidity();
  }

  return false;
}

type ValidityElement =
  HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLObjectElement |
  HTMLOutputElement | HTMLSelectElement | HTMLTextAreaElement;

function isValidityElement(e: Element): e is ValidityElement {
  return 'willValidate' in e && typeof (e as ValidityElement).checkValidity === 'function';
}

const RANGE_INPUT_TYPES = new Set(['date', 'datetime-local', 'month', 'number', 'range', 'time', 'week']);
function isRangeInput(e: Element): e is HTMLInputElement {
  return isHtmlInput(e) &&
    RANGE_INPUT_TYPES.has(e.type) &&
    (e.type === 'range' || e.hasAttribute('min') || e.hasAttribute('max'));
}

function isInRange(e: Element): boolean {
  return isRangeInput(e) &&
    e.willValidate &&
    !e.validity.rangeUnderflow &&
    !e.validity.rangeOverflow;
}

function isOutOfRange(e: Element): boolean {
  return isRangeInput(e) &&
    e.willValidate &&
    (e.validity.rangeUnderflow || e.validity.rangeOverflow);
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

function isNode(x: unknown): x is NodeLike {
  return !!x && typeof x === 'object' && 'nodeType' in x && 'nodeName' in x &&
    typeof (x as { nodeType?: unknown }).nodeType === 'number' &&
    typeof (x as { nodeName?: unknown }).nodeName === 'string';
}

function isElement(x: unknown): x is Element {
  return isNode(x) && x.nodeType === 1;
}

function isDocument(x: unknown): x is Document {
  return isNode(x) && x.nodeType === 9;
}

function isDocumentFragment(x: unknown): x is DocumentFragment {
  return isNode(x) && x.nodeType === 11;
}

function isComment(x: unknown): x is Comment {
  return isNode(x) && x.nodeType === 8;
}

function isText(x: unknown): x is Text {
  return isNode(x) && x.nodeType === 3;
}

function isHtmlMediaElement(x: unknown): x is HTMLMediaElement {
  return isElement(x) && 'currentTime' in x && 'paused' in x && 'ended' in x && 'readyState' in x;
}

function isIFrame(x: unknown): x is HTMLIFrameElement {
  return isElement(x) && x.nodeName.toUpperCase() === 'IFRAME';
}

function isHtmlDoc(doc: Document): doc is HTMLDocument {
  return doc.nodeType == 9 &&
    // contentType not in IE <= 11
    'contentType' in doc ?
      doc.contentType.includes('/html') :
      doc.createElement('DiV').localName == 'div';
}

function isQuirksMode(doc: Document): doc is HTMLDocument {
  return isHtmlDoc(doc) && doc.compatMode.indexOf('CSS') < 0;
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
function isHtmlElement(e: Element): e is HTMLElement {
  return e.namespaceURI === HTML_NS;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function isSvgElement(e: Element): e is SVGElement {
  return e.namespaceURI === SVG_NS;
}

const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
function isMathElement(e: Element): e is MathMLElement {
  return e.namespaceURI === MATH_NS;
}

function isHtmlSvgOrMathElement(e: Element): e is HTMLElement | SVGElement | MathMLElement {
  return isHtmlElement(e) || isSvgElement(e) || isMathElement(e);
}

function isHtmlInput(e: Element): e is HTMLInputElement {
  return e.localName === 'input' && isHtmlElement(e);
}

function isHtmlButton(e: Element): e is HTMLButtonElement {
  return e.localName === 'button' && isHtmlElement(e);
}

type FormStateElement = HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLOptGroupElement | HTMLOptionElement | HTMLSelectElement | HTMLTextAreaElement;
const FORM_STATE_ELEMENTS = new Set(['button', 'fieldset', 'input', 'optgroup', 'option', 'select', 'textarea']);
function isFormStateElement(e: Element): e is FormStateElement {
  return FORM_STATE_ELEMENTS.has(e.localName) && 'disabled' in e;
}

function isHtmlTextArea(e: Element): e is HTMLTextAreaElement {
  return e.localName === 'textarea' && isHtmlElement(e);
}

function isHtmlFieldSet(e: Element): e is HTMLFieldSetElement {
  return e.localName === 'fieldset' && isHtmlElement(e);
}

function isHtmlLegend(e: Element): e is HTMLLegendElement {
  return e.localName === 'legend' && isHtmlElement(e);
}

function isHtmlOptGroup(e: Element): e is HTMLOptGroupElement {
  return e.localName === 'optgroup' && isHtmlElement(e);
}

function isHtmlOption(e: Element): e is HTMLOptionElement {
  return e.localName === 'option' && 'disabled' in e;
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

const F_INIT = '"use strict";return function Resolver(c,f,x,r)';
const MACROS = {
  S: { // SELECT
    HEAD: 'var e,m,n,o,j=r.length-1,k=-1,p=false',
    LOOP: 'main:while((e=c[++k]))',
    BODY: 'r[++j]=c[k];',
    TAIL: 'continue main;',
    TEST: 'if(f(c[k])===false){p=true;break main;}',
    VARS: [] as string[],
  },

  M: { // MATCH
    HEAD: 'var e,m,n,o',
    LOOP: 'e=c;',
    BODY: '',
    TAIL: 'r=true;',
    TEST: 'f(c);',
    VARS: [] as string[],
  },

  N: { // NONE
    HEAD: 'var e,m,n,o,p=false',
    LOOP: 'main:while((e=c.item(++k)))',
    BODY: 'r[++j]=c.item(k);',
    TAIL: 'r=true;',
    TEST: 'if(f(c.item(k))===false){p=true;break main;}',
    VARS: [] as string[],
  },
} as const;

// compile groups or single selector strings into
// executable functions for matching or selecting
function compile(selector: string, mode: true, cb: QueryCallback | null, snap: Snapshot): SelectLambda;
function compile(selector: string, mode: false, cb: QueryCallback | null, snap: Snapshot): MatchLambda;
function compile(selector: string, mode: null, cb: QueryCallback | null, snap: Snapshot): SelectLambda;
function compile(selector: string, mode: boolean | null, cb: QueryCallback | null, snap: Snapshot): SelectLambda | MatchLambda {

  // 'mode' can be boolean or null
  // true = select / false = match
  // null to use collection.item()
  let [macro, head, loop] = ['', '', ''];
  switch (mode) {
    case true: {
      const cached = snap.selectLambdas[selector];
      if (cached && cached.hasCallback === !!cb) return cached.fn;
      macro = MACROS.S.BODY + (!!cb ? MACROS.S.TEST : '') + MACROS.S.TAIL;
      head = MACROS.S.HEAD;
      loop = MACROS.S.LOOP;
      break;
    }
    case false: {
      const cached = snap.matchLambdas[selector];
      if (cached && cached.hasCallback === !!cb) return cached.fn;
      macro = MACROS.M.BODY + (!!cb ? MACROS.M.TEST : '') + MACROS.M.TAIL;
      head = MACROS.M.HEAD;
      loop = MACROS.M.LOOP;
      break;
    }
    case null: {
      const cached = snap.selectLambdas[selector];
      if (cached && cached.hasCallback === !!cb) return cached.fn;
      macro = MACROS.N.BODY + (!!cb ? MACROS.N.TEST : '') + MACROS.N.TAIL;
      head = MACROS.N.HEAD;
      loop = MACROS.N.LOOP;
      break;
    }
    default: assertNever(mode);
  }

  const { source, post, modvar } = compileSelector(selector, macro, mode, cb, snap);
  const isSelectMode = mode === true || mode === null;

  loop += isSelectMode ? '{' + source + '}' : source;

  const vars = modvar.length ? ',' + modvar.join(',') : '';
  const returnValue = isSelectMode ? 'return p;' : 'return r;';
  const f = F_INIT + '{' + head + vars + ';' + loop + post + returnValue + '}';
  const factory = Function('s', f)(snap) as SelectLambda | MatchLambda;

  if (isSelectMode) {
    snap.selectLambdas[selector] = { hasCallback: !!cb, fn: factory as SelectLambda };
  } else {
    snap.matchLambdas[selector]  = { hasCallback: !!cb, fn: factory as MatchLambda };
  }

  return factory;
}

const ATTR_STD_OPS = new Set(['=', '^=', '$=', '|=', '*=', '~=']);

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
  expression: string, source: string, mode: boolean | null, cb: QueryCallback | null, snap: Snapshot
): CompileSelectorResult {
  const out: CompileSelectorResult = { source: '', post: '', modvar: [] };
  let k = 0;
  let selector: string | undefined = expression;

  // isolate selector combinators
  selector = selector.replace(snap.re.STD.combinator, '$1');

  // javascript needs a label to break
  // out of the while loops processing
  selector_recursion_label:

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

        const classPattern = `(^|\\s)${escapeRegExp(className)}(\\s|$)`;
        const classPatternLit = JSON.stringify(classPattern);
        const flagsLit = JSON.stringify(snap.isQuirksMode ? 'i' : '');

        source = `if((new RegExp(${classPatternLit},${flagsLit})).test(e.getAttribute("class")||"")){${source}}`;
        break;
      }

      // tag name resolver
      case '<tag>': {
        match = selector.match(snap.re.Patterns.tagName);
        if (!match) throw new Error('Invalid tag selector: ' + selector);

        const tagName = cssIdentUnescape(match[1]);
        source = `if(s.isType(e,${JSON.stringify(tagName)})){${source}}`;
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
        const attrOp = match[2] as string | undefined;
        const rawAttrVal = match[4] as string | undefined;
        const rawAttrFlag = match[5] as string | undefined;

        const pipe = findUnescapedPipe(attrName);
        const rawNsPrefix = pipe >= 0 ? attrName.slice(0, pipe) : null;
        const nsPrefix = rawNsPrefix === null ? null : cssIdentUnescape(rawNsPrefix);
        const rawLocalName = pipe >= 0 ? attrName.slice(pipe + 1) : attrName;
        const localName = cssIdentUnescape(rawLocalName);

        const attrVal = rawAttrVal === undefined ? undefined : cssIdentUnescape(rawAttrVal);

        if (nsPrefix !== null && nsPrefix !== '' && nsPrefix !== '*') {
          throw new Error(`Unsupported namespace prefix "${nsPrefix}" in attribute selector: ${selector}`);
        }

        const nsArg = nsPrefix === null ? 'null' : JSON.stringify(nsPrefix);
        const localArg = JSON.stringify(localName);
        const attrFlag = rawAttrFlag === undefined ? undefined : cssIdentUnescape(rawAttrFlag).toLowerCase();
        if (attrFlag !== undefined && attrFlag !== 'i' && attrFlag !== 's') throw new Error(`Invalid attribute selector flag: ${rawAttrFlag}`);
        const flagArg = attrFlag === undefined ? 'null' : JSON.stringify(attrFlag);

        const matchAttrExpr = (pattern: string | null, negate = false): string => {
          const patternArg = pattern === null ? 'null' : JSON.stringify(pattern);
          const match = `s.matchAttribute(e,${nsArg},${localArg},${patternArg},${flagArg})`;
          return negate ? `!${match}` : match;
        };

        let attrExpr: string;
        if (!attrOp) {
          attrExpr = matchAttrExpr(null);
        } else if (attrVal === undefined) {
          throw new Error(`Missing attribute value in selector: ${selector}`);
        } else if (attrOp === '~=' && /[\t\n\f\r ]/.test(attrVal)) {
          // [attr~="a b"] is syntactically valid but can never match a single whitespace-separated token.
          attrExpr = 'false';
        } else {
          const baseTest = snap.operators[attrOp];
          if (!baseTest) {
            throw new Error(`Unsupported attributes operator: ${attrOp}, in selector: ${expression}`);
          }

          const isStdOp = ATTR_STD_OPS.has(attrOp) && attrOp !== '~=';
          const test =
              attrVal === '' && attrOp === '~=' ? { p1: '^\\s', p2: '+$', p3: true }
            : attrVal === '' && isStdOp         ? { p1: '^',    p2: '$',  p3: true }
            : baseTest;

          const attrPattern = `${test.p1}${escapeRegExp(attrVal)}${test.p2}`;
          attrExpr = matchAttrExpr(attrPattern, !test.p3);
        }

        source = `if((${attrExpr})){${source}}`;
        break;
      }

      // *** General sibling combinator
      // E ~ F (F relative sibling of E)
      case '~': {
        match = selector.match(snap.re.Patterns.relative);
        if (!match) throw new Error('Invalid relative sibling combinator in selector: ' + selector);

        source = `var N${k}=e;while(e&&(e=e.previousElementSibling)){${source}}e=N${k};`;
        break;
      }

      // *** Adjacent sibling combinator
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
              source = `if((e===s.scopeEl)){${source}}`;
              break;
            // case 'scope' is bypassed by `prepareScope` method, which replaces :scope with a unique selector fingerpint
            case 'root':
              // there can only be one :root element, so exit the loop once found
              source = `if((e===s.root)){${source}${mode ? 'break main;' : ''}}`;
              break;
            case 'empty':
              // matches elements that don't contain elements or text nodes
              source = `n=e.firstChild;while(n&&n.nodeType!==1&&n.nodeType!==3){n=n.nextSibling}if(!n){${source}}`;
              break;

            // *** child-indexed pseudo-classes
            // :first-child, :last-child, :only-child
            case 'only-child':
              source = `if((!e.nextElementSibling&&!e.previousElementSibling)){${source}}`;
              break;
            case 'last-child':
              source = `if((!e.nextElementSibling)){${source}}`;
              break;
            case 'first-child':
              source = `if((!e.previousElementSibling)){${source}}`;
              break;

            // *** typed child-indexed pseudo-classes
            // :only-of-type, :last-of-type, :first-of-type
            case 'only-of-type':
              source =
                `o=e.localName;m=e.namespaceURI;` +
                `n=e;while((n=n.nextElementSibling)&&(n.localName!==o||n.namespaceURI!==m));if(!n){` +
                `n=e;while((n=n.previousElementSibling)&&(n.localName!==o||n.namespaceURI!==m));}if(!n){${source}}`;
              break;
            case 'last-of-type':
              source =
                `n=e;o=e.localName;m=e.namespaceURI;` +
                `while((n=n.nextElementSibling)&&(n.localName!==o||n.namespaceURI!==m));if(!n){${source}}`;
              break;
            case 'first-of-type':
              source =
                `n=e;o=e.localName;m=e.namespaceURI;` +
                `while((n=n.previousElementSibling)&&(n.localName!==o||n.namespaceURI!==m));if(!n){${source}}`;
              break;
            default:
              throw new Error(`Unsupported structural-tree pseudo-class: ${pseudo}, in selector: ${expression}`);
          }
        }

        // *** child-indexed & typed child-indexed pseudo-classes
        // :nth-child, :nth-of-type, :nth-last-child, :nth-last-of-type
        else if ((match = selector.match(snap.re.Patterns.treestruct))) {
          const pseudo = match[1].toLowerCase();
          let nthArg = match[2].toLowerCase().replace(/\s+/g, '');
          nthArg = nthArg.replace(/^[+-]?0n/, '') || '0';

          if (pseudo !== 'nth-child' && pseudo !== 'nth-last-child' && pseudo !== 'nth-of-type' && pseudo !== 'nth-last-of-type') {
            throw new Error(`Unsupported tree-structural pseudo-class: ${pseudo}, in selector: ${expression}`);
          }

          if (!nthArg) {
            throw new Error(`Missing argument for pseudo-class ${pseudo} in selector: ${expression}`);
          }

          const isOfType = pseudo.endsWith('-of-type');
          const isLast = pseudo.includes('last');

          if (nthArg === 'n') {
            source = `if(true){${source}}`;
            break;
          }

          let nthTest: string;
          if (nthArg === 'even' || nthArg === '2n0' || nthArg === '2n+0' || nthArg === '2n') {
            nthTest = 'n%2===0';
          } else if (nthArg === 'odd' || nthArg === '2n1' || nthArg === '2n+1') {
            nthTest = 'n%2===1';
          } else if (!nthArg.includes('n')) {
            const index = parseInt(nthArg, 10);
            nthTest = `n===${index}`;
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

          const nthCall = isOfType ? `s.nthOfType(e,${isLast})` : `s.nthElement(e,${isLast})`;
          source = `n=${nthCall};if((${nthTest})){${source}}`;

          const cleanup = isOfType ? `s.nthOfType(null, 2);` : `s.nthElement(null, 2);`;
          if (!out.post.includes(cleanup)) out.post += cleanup;
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
              const selectors = parse(expr, snap.re, true);
              const test = selectors.length
                ? selectors
                    .map(sel => `(function(){try{return s.match(${JSON.stringify(sel)},e);}catch(E){return false;}})()`)
                    .join('||')
                : 'false';
              source = `if(${test}){${source}}`;
              break;
            }
            case 'matches':
              throw new Error(`Unsupported pseudo-class :matches(); use :is()`);
            case 'not':
              source = `if(!s.match(${exprLit},e)){${source}}`;
              break;
            case 'has': {
              const list = parseRelativeSelectorList(expr);
              let hasSource = 'o=false;';

              for (const selector of list.selectors) {
                const steps = selector.steps.map(step => [
                  step.combinator,
                  step.compound.source,
                ]);

                hasSource += `if(!o){o=s.matchHas(${JSON.stringify(steps)},e);}`;
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
          const expr = match[2].replace(snap.re.TrimSpaces, '');
          const exprLit = JSON.stringify(expr);

          switch (pseudo) {
            case 'dir':
              source = `if(s.matchDir(${exprLit},e)){${source}}`;
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
              source = `if((/^(?:a|area)$/i.test(e.localName)&&e.hasAttribute("href"))){${source}}`;
              break;

            case 'visited':
              // Browser selector APIs do not expose history state to script.
              source = `if(false){${source}}`;
              break;

            case 'target':
              source = `if(((s.doc.compareDocumentPosition(e)&16)&&s.doc.location.hash&&e.id===s.doc.location.hash.slice(1))){${source}}`;
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
              source = `if(s.isFormStateElement(e)&&!s.isDisabled(e)){${source}}`;
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
              const result = snap.selectors[expr].Callback(match, source, mode, cb);
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
    .map(group => group.replace(re.TrimSpaces, ''));

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

function normalizeSelectorInput(selectors: string, re: Rex): string {
  let
  normalized = stripCssComments(selectors);
  normalized = normalizeNestingSelector(normalized);
  normalized = normalized
    .replace(/\x00|\\$/g, '\ufffd')
    .replace(re.CombineWSP, '\x20')
    .replace(re.PseudosWSP, '$1$2')
    .replace(re.TabCharWSP, '\t')
    .replace(re.CommaGroup, ',')
    .replace(re.TrimSpaces, '');
  return normalized;
}

// equivalent of w3c 'matches' method
function matchRaw(selectors: string, element: Element, cb: QueryCallback | null, snap: Snapshot): boolean {
  updateSnapshot(snap, element);

  if (!selectors) {
    throw new Error(`[match] Empty selector is not valid`);
  }

  if (snap.isDebug) {
    snap.debugMatch = {
      callback: cb,
      element: describeContext(element),
      selector: selectors,
    };
  }

  let resolver = snap.matchResolvers[selectors];
  if (!resolver || resolver.callback !== cb) {
    const parsed = parse(selectors, snap.re);

    if (snap.isDebug && snap.debugMatch) {
      snap.debugMatch.parsed = parsed;
    }

    resolver = snap.matchResolvers[selectors] = buildMatchResolver(parsed, cb, snap);
  }
  const result = resolver.lambdas.some(f => f(element, cb, null, false));

  if (snap.isDebug && snap.debugMatch) {
    snap.debugMatch.lambdaSource = resolver.lambdas.map(f => String(f));
    snap.debugMatch.result = result;
  }

  return result;
}

function buildMatchResolver(selectors: string[], cb: QueryCallback | null, snap: Snapshot): MatchResolver {
  const lambdas: MatchLambda[] = [];

  for (let i = 0, l = selectors.length; i < l; ++i) {
    lambdas[i] = compile(selectors[i], false, cb, snap);
  }

  return { callback: cb, lambdas };
}

// equivalent of w3c 'querySelectorAll' method
function selectRaw(sel: string, ctx: QueryContext, cb: QueryCallback | null, snap: Snapshot): Element[] {
  updateSnapshot(snap, ctx);

  let nodes: Element[] = [];
  if (!sel) {
    throw new Error(`[select] Empty selector is not valid`);
  }

  if (snap.isDebug) {
    snap.debugSelect = { callback: cb, context: describeContext(ctx), run: [] };
  }

  // try to reuse cached resolver
  let resolver = snap.selectResolvers[sel];
  if (!resolver || resolver.context !== ctx || resolver.callback !== cb) {
    const parsed = parse(sel, snap.re);
    resolver = buildResolver(parsed, ctx, cb, snap);
    snap.selectResolvers[sel] = resolver;
  }

  // execute resolver seeds and collect results
  for (const seed of resolver.seeds) {
    const candidates = seed.getCandidates();
    const stopped = seed.lambda(candidates, cb, ctx, nodes);

    if (snap.isDebug) {
      snap.debugSelect!.run!.push({
        seedKey: seed.key,
        seedQuery: seed.query,
        compileQuery: seed.compileQuery,
        candidates: describeElements(candidates),
        lambdaSource: String(seed.lambda),
        results: describeElements(nodes),
      });
    }

    if (stopped) break;
  }

  if (resolver.seeds.length > 1 && nodes.length > 1) {
    nodes = sortUnique(nodes);
  }

  return nodes;
}

function buildResolver(selectors: string[], ctx: QueryContext, cb: QueryCallback | null, snap: Snapshot): SelectResolver {
  const out: SelectResolver = {
    callback: cb,
    context: ctx,
    seeds: [],
  };

  if (snap.isDebug && snap.debugSelect) snap.debugSelect.build = [];

  for (const sel of selectors) {
    let { key, query, compileQuery } = getOptimizedPlan(sel, snap);

    // Normalize optimized DOM lookups so candidate seeds remain selector-equivalent.
    let getCandidates: GetCandidates;
    switch (key) {
      case '#': {
        query = cssIdentUnescape(query);
        getCandidates = () => byIdRaw(query, ctx, snap);
        break;
      }
      case '.': {
        query = cssIdentUnescape(query);
        // classname lookup accepts whitespace queries that QSA class selectors do not.
        getCandidates = /[\t\n\f\r ]/.test(query)
          ? () => []
          : () => byClassRaw(query, ctx, snap);
        break;
      }
      case '*': {
        query = cssIdentUnescape(query);
        getCandidates = () => seedsByTag(query, ctx, snap);
        break;
      }
      default: assertNever(key);
    }

    if (snap.isDebug) {
      snap.debugSelect?.build?.push({ selector: sel, seedKey: key, seedQuery: query, compileQuery });
    }

    out.seeds.push({
      key, query, compileQuery, getCandidates,
      lambda: compile(compileQuery, true, cb, snap),
    });
  }

  return out;
}

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
function ancestorRaw(selectors: string, element: Element, callback: QueryCallback | null, snap: Snapshot): Element | null {
  updateSnapshot(snap, element);

  let el: Element | null = element;
  while (el) {
    if (matchRaw(selectors, el, callback, snap)) break;
    el = el.parentElement;
  }
  return el;
}

const stopAfterFirst: QueryCallback = () => false;

// equivalent of w3c 'querySelector' method
function firstRaw(selectors: string, context: QueryContext, callback: QueryCallback | null, snap: Snapshot): Element | null {
  updateSnapshot(snap, context);

  // TODO: firstRaw wraps callbacks for early stop, which hurts resolver caching; future parser-level caching should make callbacks irrelevant.
  const cb = callback
    ? (e: Element) => { callback(e); return false; }
    : stopAfterFirst;

  return selectRaw(selectors, context, cb, snap)[0] || null;
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
