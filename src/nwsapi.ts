function Factory(fGlobal: Glob, fExport: Function): DomApi {
  const _doc = fGlobal.document;

  // handlers needed for the :hover pseudo-class; track state change in browsers and headless
  _doc.addEventListener('mouseover', (e) => { _snap.hoverTarget = isElement(e.target) ? e.target : null; }, true);
  _doc.addEventListener('mouseout', (_e) => { _snap.hoverTarget = null; }, true);

  // QSA placeholders to native references
  const _qsaStore: Partial<Record<QsaKey, any>> = {};
  const _qsaHooks: { type: string, listener: EventListenerOrEventListenerObject }[] = [];

  const _snap = initSnapshot(_doc);

  // public exported methods/objects
  const Dom: DomApi = {
    // Version, Config, CFG, Snapshot -- previous names
    version: 'nwsapi-__VERSION__',
    config: _snap.config,
    extensions: _snap.ext,
    snapshot: _snap,

    // exported engine methods
    byId(id, ctx) {
      ctx ??= _snap.doc;
      return _snap.config.NODE_LIST ? toNodeList(byId(id, ctx, _snap), _snap.doc) : byId(id, ctx, _snap);
    },

    byTag(tag, ctx) {
      ctx ??= _snap.doc;
      return _snap.config.NODE_LIST ? toNodeList(byTagRaw(tag, ctx, _snap), _snap.doc) : byTagRaw(tag, ctx, _snap);
    },

    byClass(cls, ctx) {
      ctx ??= _snap.doc;
      return _snap.config.NODE_LIST ? toNodeList(byClassRaw(cls, ctx, _snap), _snap.doc) : byClassRaw(cls, ctx, _snap);
    },

    first(sel, ctx, cb) {
      ctx ??= _snap.doc;
      return firstRaw(sel, ctx, cb ?? null, _snap);
    },

    match(sel, ctx, cb) {
      return matchRaw(sel, ctx, cb ?? null, _snap);
    },

    select(sel, ctx, cb) {
      ctx ??= _snap.doc;
      return _snap.config.NODE_LIST ? toNodeList(selectRaw(sel, ctx, cb ?? null, _snap), _snap.doc) : selectRaw(sel, ctx, cb ?? null, _snap);
    },

    closest(sel, ctx, cb) {
      return ancestorRaw(sel, ctx, cb ?? null, _snap);
    },

    // configure the engine to use special handling
    configure(
      opt?: ConfigKey | Partial<Record<ConfigKey, boolean>>,
      clear = false
    ) {
      if (typeof opt == 'string') { return !!_snap.config[opt]; }
      if ((typeof opt != 'object') || opt == null) { return _snap.config; }

      for (let i in opt) {
        _snap.config[i as ConfigKey] = !!opt[i as ConfigKey];
      }

      // clear cache
      const clearObject = (obj: Record<string, unknown>) => { for (const k in obj) delete obj[k]; };
      if (clear) {
        clearObject(_snap.matchResolvers);
        clearObject(_snap.selectResolvers);
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
    registerCombinator(combinator: string, resolver: string) {
      if ([...combinator].length !== 1) {
        throw new Error('Invalid combinator: ' + combinator);
      }

      if (!_snap.ext.combinators.includes(combinator)) {
        _snap.ext.combinators.push(combinator);
        _snap.combinators[combinator] = resolver;
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
          root: { summary: describeElement(_snap.root) },
        },
        debugCollect: _snap.debugSelect,
      }, null, 2);
    },

  };

  updateSnapshot(_snap, _doc, true)

  return Dom;
}

export const DEFAULT_CONFIG: NwsConfig = {
  IDS_DUPES: true,
  FORGIVING: true,
  NODE_LIST: false,
  LOGERRORS: true,
  USR_EVENT: true,
  VERBOSITY: true,
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
    isHtml: isHtmlDoc(doc),
    isQuirksMode: isQuirksMode(doc),
    namespace: getNamespace(doc) as string | null,
    re: {} as Rex,

    isDebug: false,
    debugSelect: undefined as DebugSelect | undefined,

    // special handling configuration flags
    config: { ...DEFAULT_CONFIG } as NwsConfig,
    ext: {
      operators: [...DEFAULT_EXTENSIONS.operators],
      combinators: [...DEFAULT_EXTENSIONS.combinators],
    } as NwsExtensions,
    selectors: {} as Record<string, SelectorExtension>,
    combinators: {} as Record<string, string>, // TODO: ???
    operators: {
      '=':  { p1: '^',       p2: '$',       p3: 'true' },
      '^=': { p1: '^',       p2: '',        p3: 'true' },
      '$=': { p1: '',        p2: '$',       p3: 'true' },
      '*=': { p1: '',        p2: '',        p3: 'true' },
      '|=': { p1: '^',       p2: '(-|$)',   p3: 'true' },
      '~=': { p1: '(^|\\s)', p2: '(\\s|$)', p3: 'true' },
    } as Record<string, AttrMatcherParts>,

    hoverTarget: null as EventTarget | null,

    // cached
    matchLambdas: {} as Partial<Record<string, MatchLambdaEntry>>,
    selectLambdas: {} as Partial<Record<string, SelectLambdaEntry>>,
    matchResolvers: {} as Partial<Record<string, MatchResolver>>,
    selectResolvers: {} as Partial<Record<string, SelectResolver>>,

    byTag: (() => nr('byTag')) as ByTagFn,
    first: (() => nr('first')) as FirstFn,
    match: (() => nr('match')) as MatchFn,
    select: (() => nr('select')) as SelectFn,
    ancestor: (() => nr('ancestor')) as AncestorFn,

    nthOfType: nthOfType,
    nthElement: nthElement,

    isFocusable: isFocusable,
    isContentEditable: isContentEditable,
    hasAttribute: (() => nr('hasAttribute')) as HasAttributeFn,
    getAttribute: (() => nr('getAttribute')) as GetAttributeFn,
  };

  function nr(name: string): never { throw new Error(`Snapshot member used before initialization: ${name}`); };

  snap.re = buildRex(snap.ext);
  snap.byTag = (tag: string, context?: QueryContext) => byTagRaw(tag, context ?? snap.doc, snap);
  snap.first = (sel: string, context?: QueryContext, cb?: QueryCallback | null) => firstRaw(sel, context ?? snap.doc, cb ?? null, snap);
  snap.match = (sel: string, context: Element, cb?: QueryCallback | null) => matchRaw(sel, context, cb ?? null, snap);
  snap.select = (sel: string, context?: QueryContext, cb?: QueryCallback | null) => selectRaw(sel, context ?? snap.doc, cb ?? null, snap);
  snap.ancestor = (sel: string, context: Element, cb?: QueryCallback | null) => ancestorRaw(sel, context, cb ?? null, snap);
  snap.hasAttribute = (element: Element, ns: string | null, local: string) => hasAttribute(element, ns, local, snap);
  snap.getAttribute = (element: Element, ns: string | null, local: string) => getAttribute(element, ns, local, snap);

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

function updateSnapshot(snap: Snapshot, ctx: QueryContext, force = false): Snapshot {
  const doc = ctx.ownerDocument ?? ctx;

  if (force || snap.doc !== doc) {
    snap.doc = doc;
    snap.root = doc.documentElement;
    snap.isHtml = isHtmlDoc(doc);
    snap.isQuirksMode = isQuirksMode(doc);
    snap.namespace = getNamespace(doc);
  }

  snap.from = ctx;
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
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// find duplicate ids using iterative walk
function byIdRaw(id: string, context: QueryContext): Element[] {
  const nodes = [ ]
  let node: QueryContext | null = context;
  let next = node.firstElementChild;
  while ((node = next)) {
    if (node.getAttribute('id') === id) nodes.push(node);
    if ((next = node.firstElementChild || node.nextElementSibling)) continue;
    while (!next && (node = node.parentElement) && node !== context) {
      next = node.nextElementSibling;
    }
  }
  return nodes;
}

// context agnostic getElementById
function byId(id: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);
  if (!snap.config.IDS_DUPES && 'getElementById' in context) {
    const e = context.getElementById(id);
    return e ? [e] : [];
  }

  return byIdRaw(id, context);
}

// context agnostic getElementsByTagName
function byTagRaw(tag: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);
  let el: Element | null
  let nodes: Element[];
  // DOCUMENT_NODE (9) & ELEMENT_NODE (1)
  if ('getElementsByTagName' in context) {
    return Array.from(context.getElementsByTagName(tag));
  } else {
    // DOCUMENT_FRAGMENT_NODE (11)
    if (snap.isHtml) tag = tag.toLowerCase();
    if ((el = context.firstElementChild)) {
      if (!(el.nextElementSibling || tag == '*' || el.localName == tag)) {
        return Array.from(el.getElementsByTagName(tag));
      } else {
        nodes = [ ];
        do {
          if (tag == '*' || el.localName == tag) nodes[nodes.length] = el;
          concatList(nodes, el.getElementsByTagName(tag));
        } while ((el = el.nextElementSibling));
      }
    } else nodes = [];
  }
  return nodes;
}

// context agnostic getElementsByClassName
function byClassRaw(cls: string, context: QueryContext, snap: Snapshot): Element[] {
  updateSnapshot(snap, context);

  let el: Element | null;
  let nodes: Element[];
  // DOCUMENT_NODE (9) & ELEMENT_NODE (1)
  if ('getElementsByClassName' in context) {
    return Array.from(context.getElementsByClassName(cls));
  } else {
    // DOCUMENT_FRAGMENT_NODE (11)
    if ((el = context.firstElementChild)) {
      const reCls = RegExp('(^|\\s)' + escapeRegExp(cls) + '(\\s|$)', snap.isQuirksMode ? 'i' : '');
      if (!(el.nextElementSibling || reCls.test(el.className))) {
        return Array.from(el.getElementsByClassName(cls));
      } else {
        nodes = [ ];
        do {
          if (reCls.test(el.className)) nodes[nodes.length] = el;
          concatList(nodes, el.getElementsByClassName(cls));
        } while ((el = el.nextElementSibling));
      }
    } else nodes = [];
  }
  return nodes;
}

function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`);
}

function hasAttribute(e: Element, nsPrefix: string | null, localName: string, snap: Snapshot): boolean {
  const attrs = e.attributes;

  if (nsPrefix === null) {
    const expected = snap.isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.namespaceURI != null) continue;
      const actual = snap.isHtml ? attr.localName.toLowerCase() : attr.localName;
      if (actual === expected) return true;
    }
    return false;
  }

  if (nsPrefix === '*') {
    const expected = snap.isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const actual = snap.isHtml ? attrs[i].localName.toLowerCase() : attrs[i].localName;
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

  if (nsPrefix === null) {
    const expected = snap.isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.namespaceURI != null) continue;
      const actual = snap.isHtml ? attr.localName.toLowerCase() : attr.localName;
      if (actual === expected) return attr.value;
    }
    return null;
  }

  if (nsPrefix === null || nsPrefix === '*') {
    const expected = snap.isHtml ? localName.toLowerCase() : localName;
    for (let i = 0; i < attrs.length; i++) {
      const actual = snap.isHtml ? attrs[i].localName.toLowerCase() : attrs[i].localName;
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

  if (nthOfTypeState.nodes[nthOfTypeState.set]?.[name] && nthOfTypeState.parent === element.parentElement) {
    i = nthOfTypeState.set; j = nthOfTypeState.idx; l = nthOfTypeState.len;
  } else {
    l = nthOfTypeState.parents.length;
    nthOfTypeState.parent = element.parentElement;
    for (i = -1, j = 0, k = l - 1; l > j; ++j, --k) {
      if (nthOfTypeState.parents[j] === nthOfTypeState.parent) { i = j; break; }
      if (nthOfTypeState.parents[k] === nthOfTypeState.parent) { i = k; break; }
    }
    if (i < 0 || !nthOfTypeState.nodes[i]?.[name]) {
      nthOfTypeState.parents[i = l] = nthOfTypeState.parent;
      nthOfTypeState.nodes[i] || (nthOfTypeState.nodes[i] = {});
      l = 0; nthOfTypeState.nodes[i][name] = [];
      e = nthOfTypeState.parent?.firstElementChild ?? element;
      while (e) { if (e === element) j = l; if (e.localName == name) { nthOfTypeState.nodes[i][name][l] = e; ++l; } e = e.nextElementSibling; }
      nthOfTypeState.set = i; nthOfTypeState.idx = j; nthOfTypeState.len = l;
      if (l < 2) return l;
    } else {
      l = nthOfTypeState.nodes[i][name].length;
      nthOfTypeState.set = i;
    }
  }

  if (element !== nthOfTypeState.nodes[i][name][j] && element !== nthOfTypeState.nodes[i][name][j = 0]) {
    const nodes = nthOfTypeState.nodes[i][name];
    for (j = 0, k = l - 1; l > j; ++j, --k) {
      if (nodes[j] === element) { break; }
      if (nodes[k] === element) { j = k; break; }
    }
  }

  nthOfTypeState.idx = j + 1; nthOfTypeState.len = l;
  return dir ? l - j : nthOfTypeState.idx;
};

// return node if node is focusable
// or false if node isn't focusable
function isFocusable(node: HTMLElement): HTMLElement | false {
  const doc = node.ownerDocument;
  if (!doc) return false;

  if ('contentDocument' in node && node.localName == 'iframe') {
    return false;
  }

  if (doc.hasFocus() && node === doc.activeElement) {
    if ('type' in node || 'href' in node || typeof node.tabIndex == 'number') {
      return node;
    }
  }

  return false;
}

// check if node content is editable
function isContentEditable(el: HTMLElement): boolean {
  let attrValue: string | null = 'inherit';
  if (el.hasAttribute('contenteditable')) {
    attrValue = el.getAttribute('contenteditable');
  }
  switch (attrValue) {
    case '':
    case 'plaintext-only':
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      const parent = el.parentElement;
      if (parent && parent.nodeType === 1) {
        return isContentEditable(parent);
      }
      return false;
  }
}

// check media resources is playing
function isPlaying(el: Element): boolean {
  // for <audio>, <video>, <source> and <track> elements
  const media = isHtmlMediaElement(el) ? el : isHtmlMediaElement(el.parentElement) ? el.parentElement : null;
  if (!media) return false;
  return media.currentTime > 0 && !media.paused && !media.ended && media.readyState > 2;
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

export function buildRex(ext: NwsExtensions) {
  // NOTE: SPECIAL CASES IN CSS SYNTAX PARSING RULES
  //
  // The <EOF-token> https://drafts.csswg.org/css-syntax/#typedef-eof-token
  // allow mangled|unclosed selector syntax at the end of selectors strings
  //
  // Literal equivalent hex representations of the characters: " ' ` ] )
  //
  //     \\x22 = " - double quotes    \\x5b = [ - open square bracket
  //     \\x27 = ' - single quote     \\x5d = ] - closed square bracket
  //     \\x60 = ` - back tick        \\x28 = ( - open round parens
  //     \\x5c = \ - back slash       \\x29 = ) - closed round parens
  //
  // using hex format prevents false matches of opened/closed instances
  // pairs, coloring breakage and other editors highlightning problems.

  const SP = `\\x20`; // space
  const HT = `\\t`;   // horizontal tab
  const LF = `\\n`;   // line feed
  const CR = `\\r`;   // carriage return
  const FF = `\\f`;   // form feed
  const DQ = `\\x22`; // "
  const SQ = `\\x27`; // '
  const BT = `\\x60`; // `
  const BS = `\\x5c`; // backslash
  const LP = `\\x28`; // (
  const RP = `\\x29`; // )
  const LB = `\\x5b`; // [
  const RB = `\\x5d`; // ]

  const WSH = `[${SP}${HT}]`;
  const WSV = `[${CR}${LF}${FF}]`;
  const WSP = `[${SP}${HT}${CR}${LF}${FF}]`;
  const HAS = {
    nestedself: `:has${LP}(?::has${LP}|.*)${RP})${RP}`,
  };
  const NOT = {
    // not enclosed in double/single/parens/square
    double_enc: `(?=(?:[^"]*["][^"]*["])*[^"]*$)`,
    single_enc: `(?=(?:[^']*['][^']*['])*[^']*$)`,
    parens_enc: `(?![^${LP}]*${RP})`,
    square_enc: `(?![^${LB}]*${RB})`,
  };
  const GROUPS = {
    // pseudo-classes requiring parameters
    linguistic: `(dir|lang)(?:${LP}\\s?([-\\w]{2,})\\s?${RP})`,
    logicalsel: `(is|where|matches|not|has)(?:${LP}\\s?([^()]*|.*)\\s?${RP})`,
    treestruct: `(nth(?:-last)?(?:-child|-of\\-type))(?:${LP}\\s?(even|odd|(?:[-+]?\\d*)(?:n\\s?[-+]?\\s?\\d*)?)\\s?${RP})`,
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
    pseudo_dbl: `:(after|before|first\\-letter|first\\-line|selection|placeholder|-webkit-[-a-zA-Z0-9]{2,})\\b`,
  };

  const universal = `\\*`;
  // non-ascii chars
  const noascii = `[^\\x00-\\x9f]`;
  // escaped chars
  const escaped = `\\\\[^${CR}${LF}${FF}0-9a-fA-F]`;
  // unicode chars
  const unicode = `\\\\[0-9a-fA-F]{1,6}(?:${CR}${LF}|\\s)?`;

  // can start with single/double dash
  // but it can not start with a digit
  const identifier = `-?(?:[a-zA-Z_-]|${noascii}|${escaped}|${unicode})` +
      `(?:-{2}|[0-9]|[a-zA-Z_-]|${noascii}|${escaped}|${unicode})*`;

  const pseudonames = `[-\\w]+`;
  const pseudoparms = `(?:[-+]?\\d*)(?:n\\s?[-+]?\\s?\\d*)`;
  const doublequote = `"[^"\\\\]*(?:\\\\.[^"\\\\]*)*(?:"|$)`;
  const singlequote = `'[^'\\\\]*(?:\\\\.[^'\\\\]*)*(?:'|$)`;

  const attrparser = `${identifier}|${doublequote}|${singlequote}`;
  const attrvalues = `([${DQ}${SQ}]?)((?!\\3)*|(?:\\\\?.)*?)(?:\\3|$)`;

  const combinatorRaw = ext.combinators.map(escapeRegExp).join('');
  const combinator = `[${combinatorRaw}]${WSP}?(?=[^${combinatorRaw}])`;
  const operators = ext.operators.map(escapeRegExp).join('|');

  const namespaceName = `(?:${universal}|${identifier})`;
  const namespacePrefix = `(?:${namespaceName})?`;
  const namespaceType = `(?:${namespacePrefix}\\|${namespaceName})`;
  const attrName = `(?:(?:${namespacePrefix}\\|)?${identifier})`;

  const attributes =
    `\\[` +
      // attribute presence
      // `(?:${universal}\\|)?` +
      `${WSP}?` +
      // `(${identifier}(?::${identifier})?)` +
      `(${attrName})` +
      `${WSP}?` +
      `(?:` +
        `(${operators})${WSP}?` +
        `(?:${attrparser})` +
      `)?` +
      // attribute case sensitivity
      `(?:${WSP}?\\b(i))?${WSP}?` +
    `(?:\\]|$)`;

  const attrmatcher = attributes.replace(attrparser, attrvalues);

  const pseudoclass =
    `(?:${LP}${WSP}*` +
      `(?:${pseudoparms}?)?|` +
      `(?:${namespaceType}|${universal})|` +
      `(?:` +
        `(?::${pseudonames}` +
          `(?:${LP}${pseudoparms}?(?:${RP}|$))?|` +
        `)|` +
        `(?:[.#]?${identifier})|` +
        `(?:${attributes})` +
      `)+|` +
      `(?:${WSP}?${combinator})|` +
      `(?:${WSP}?,${WSP}?)|` +
      `(?:${WSP}?)|` +
      `(?:${RP}|$)` +
    `)*`;

  const standardValidator =
    `(?=${WSP}?[^>+~(){}<>])` +
    `(?:` +
      `(?:${namespaceType})|` +
      `(?:${universal})|` +
      `(?:[.#]?${identifier})+|` +
      `(?:${attributes})+|` +
      `(?:::?${pseudonames}${pseudoclass})|` +
      `(?:${WSP}?${combinator}${WSP}?)|` +
      `(?:${WSP}?,${WSP}?)|` +
      `(?:${WSP}?)` +
    `)+`;

  // the following global RE is used to return the
  // deepest localName in selector strings and then
  // use it to retrieve all possible matching nodes
  // that will be filtered by compiled resolvers
  const reOptimizer = RegExp(
    `(?:([.:#*]?)` +
    `(${identifier})` +
    `(?:` +
      `:[-\\w]+|` +
      `\\[[^\\]]+(?:\\]|$)|` +
      `${LP}[^${RP}]+(?:${RP}|$)` +
    `)*)$`);

  // global
  const reValidator = RegExp(standardValidator, 'g');

  const rex = {
    // regular expressions
    HasEscapes: RegExp(`\\\\`),
    HexNumbers: RegExp(`^[0-9a-fA-F]`),
    EscOrQuote: RegExp(`^\\\\|[${DQ}${SQ}]`),
    RegExpChar: RegExp(`(?!\\\\)[\\\\^$.,*+?()[\\]{}|\\/]`, 'g'),
    TrimSpaces: RegExp(`^${WSP}+|${WSP}+$`, 'g'),
    SplitGroup: RegExp(`(\\([^)]*\\)|\\[[^[]*\\]|\\\\.|[^,])+`, 'g'),
    CommaGroup: RegExp(`(\\s*,\\s*)${NOT.square_enc}${NOT.parens_enc}`, 'g'),
    FixEscapes: RegExp(`\\\\([0-9a-fA-F]{1,6}${WSP}?|.)|([${DQ}${SQ}])`, 'g'),
    CombineWSP: RegExp(`[${LF}${CR}${FF}${SP}]+${NOT.single_enc}${NOT.double_enc}`, 'g'),
    TabCharWSP: RegExp(`(${SP}?${HT}+${SP}?)${NOT.single_enc}${NOT.double_enc}`, 'g'),
    PseudosWSP: RegExp(`([0-9n])\\s*([-+])\\s*(?=[0-9n])${NOT.square_enc}`, 'gi'),
    STD: {
      combinator: RegExp(`\\s?([>+~])\\s?`, 'g'),
      apimethods: RegExp(`^${namespacePrefix}\\|`),
      namespaces: RegExp(`(${namespacePrefix})\\|` + namespaceName),
    },
    Patterns: {
      // pseudo-classes
      treestruct: RegExp(`^:(?:${GROUPS.treestruct})(.*)`, 'i'),
      structural: RegExp(`^:(?:${GROUPS.structural})(.*)`, 'i'),
      linguistic: RegExp(`^:(?:${GROUPS.linguistic})(.*)`, 'i'),
      useraction: RegExp(`^:(?:${GROUPS.useraction})(.*)`, 'i'),
      inputstate: RegExp(`^:(?:${GROUPS.inputstate})(.*)`, 'i'),
      inputvalue: RegExp(`^:(?:${GROUPS.inputvalue})(.*)`, 'i'),
      rsrc_state: RegExp(`^:(?:${GROUPS.rsrc_state})(.*)`, 'i'),
      disp_state: RegExp(`^:(?:${GROUPS.disp_state})(.*)`, 'i'),
      time_state: RegExp(`^:(?:${GROUPS.time_state})(.*)`, 'i'),
      locationpc: RegExp(`^:(?:${GROUPS.locationpc})(.*)`, 'i'),
      logicalsel: RegExp(`^:(?:${GROUPS.logicalsel})(.*)`, 'i'),
      pseudo_nop: RegExp(`^:(?:${GROUPS.pseudo_nop})(.*)`, 'i'),
      pseudo_sng: RegExp(`^:(?:${GROUPS.pseudo_sng})(.*)`, 'i'),
      pseudo_dbl: RegExp(`^:(?:${GROUPS.pseudo_dbl})(.*)`, 'i'),
      // combinator symbols
      children: RegExp(`^${WSP}?\\>${WSP}?(.*)`),
      adjacent: RegExp(`^${WSP}?\\+${WSP}?(.*)`),
      relative: RegExp(`^${WSP}?\\~${WSP}?(.*)`),
      ancestor: RegExp(`^${WSP}+(.*)`),
      // universal & namespace
      universal: RegExp(`^(${universal})(.*)`),
      namespace: RegExp(`^(${namespacePrefix})\\|(.*)`),
      // id, class, tag
      id: RegExp(`^#(${identifier})(.*)`),
      tagName: RegExp(`^(${identifier})(.*)`),
      className: RegExp(`^\\.(${identifier})(.*)`),
      attribute: RegExp(`^(?:${attrmatcher})(.*)`),
    },

    // regexp to better aproximate detection of RTL languages (Arabic)
    RTL: RegExp(`^(?:[\\u0627-\\u064a]|[\\u0591-\\u08ff]|[\\ufb1d-\\ufdfd]|[\\ufe70-\\ufefc])+$`),

    // detect structural pseudo-classes in selectors
    nthElem: RegExp(`(:nth(?:-last)?-child)`, 'i'),
    nthType: RegExp(`(:nth(?:-last)?-of-type)`, 'i'),

    optimizer: reOptimizer,
    validator: reValidator,
  };

  return rex;
}

type Rex = ReturnType<typeof buildRex>;

// centralized error and exceptions handling
function emit(message: string, config: NwsConfig, proto?: typeof Error): void {
  if (config.VERBOSITY) {
    if (proto) throw new proto(message);
    throw new DOMException(message, 'SyntaxError');
  }
  if (config.LOGERRORS && typeof console?.log === 'function') {
    console.log(message);
  }
}

const F_INIT = '"use strict";return function Resolver(c,f,x,r)';
const MACROS = {
  S: { // SELECT
    HEAD: 'var e,n,o,j=r.length-1,k=-1,p=false',
    LOOP: 'main:while((e=c[++k]))',
    BODY: 'r[++j]=c[k];',
    TAIL: 'continue main;',
    TEST: 'if(f(c[k])===false){p=true;break main;}',
    VARS: [] as string[],
  },

  M: { // MATCH
    HEAD: 'var e,n,o',
    LOOP: 'e=c;',
    BODY: '',
    TAIL: 'r=true;',
    TEST: 'f(c);',
    VARS: [] as string[],
  },

  N: { // NONE
    HEAD: 'var e,n,o,p=false',
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
    const symbol = snap.re.STD.apimethods.test(selector) ? '|'
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
        const localName = snap.isHtml ? tagName.toLowerCase() : tagName;
        const localNameLit = JSON.stringify(localName);

        source = `if((e.localName===${localNameLit})){${source}}`;
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
          emit(`Namespace prefix "${nsPrefix}" is declared in this document but cannot be used in DOM selector APIs: ${expression}`, snap.config);
          return out;
        } else {
          emit(`Unresolvable namespace prefix "${nsPrefix}" in selector: ${expression}`, snap.config);
          return out;
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
        const attrFlag = match[5] as string | undefined;

        const pipe = findUnescapedPipe(attrName);
        const rawNsPrefix = pipe >= 0 ? attrName.slice(0, pipe) : null;
        const nsPrefix = rawNsPrefix === null ? null : cssIdentUnescape(rawNsPrefix);
        const rawLocalName = pipe >= 0 ? attrName.slice(pipe + 1) : attrName;
        const localName = cssIdentUnescape(rawLocalName);

        const attrVal = rawAttrVal === undefined ? undefined : cssIdentUnescape(rawAttrVal);

        if (nsPrefix !== null && nsPrefix !== '' && nsPrefix !== '*') {
          emit(`Unsupported namespace prefix "${nsPrefix}" in attribute selector: ${selector}`, snap.config);
          return out;
        }

        const nsArg = nsPrefix === null ? 'null' : JSON.stringify(nsPrefix);
        const localArg = JSON.stringify(localName);
        const hasExpr = `s.hasAttribute(e,${nsArg},${localArg})`;
        const getExpr = `s.getAttribute(e,${nsArg},${localArg})`;

        let attrExpr: string;
        if (!attrOp) {
          attrExpr = hasExpr;
        } else if (attrVal === undefined) {
          emit(`Missing attribute value in selector: ${selector}`, snap.config);
          return out;
        } else if (attrOp === '~=' && /[\t\n\f\r ]/.test(attrVal)) {
          emit(`Invalid attribute selector: value for ~= operator cannot contain whitespace in selector: ${selector}`, snap.config);
          return out;
        } else {
          const baseTest = snap.operators[attrOp];
          if (!baseTest) {
            emit(`Unsupported attributes operator: ${attrOp}, in selector: ${expression}`, snap.config);
            return out;
          }

          const isStdOp = ATTR_STD_OPS.has(attrOp) && attrOp !== '~=';
          const test =
              attrVal === '' && attrOp === '~=' ? { p1: '^\\s', p2: '+$', p3: 'true' }
            : attrVal === '' && isStdOp        ? { p1: '^',    p2: '$',  p3: 'true' }
            : baseTest;

          if (attrVal === '' && isStdOp) {
            attrExpr = `${hasExpr}&&${getExpr}===""`;
          } else {
            const sensitivity = attrFlag === 'i' || (snap.isHtml && ATTR_INSENSITIVE.has(localName.toLowerCase())) ? 'i' : '';
            const attrPattern = `${test.p1}${escapeRegExp(attrVal)}${test.p2}`;
            const attrPatternLit = JSON.stringify(attrPattern);
            const sensitivityLit = JSON.stringify(sensitivity);

            attrExpr = `${hasExpr}&&((new RegExp(${attrPatternLit},${sensitivityLit})).test(${getExpr})===${test.p3})`;
          }
        }

        source = `if((${attrExpr})){${source}}`;
        break;
      }

      // *** General sibling combinator
      // E ~ F (F relative sibling of E)
      case '~':
        match = selector.match(snap.re.Patterns.relative);
        if(!match) throw new Error('Invalid relative sibling combinator in selector: ' + selector);
        source = 'var N' + k + '=e;while(e&&(e=e.previousElementSibling)){' + source + '}e=N' + k + ';';
        break;

      // *** Adjacent sibling combinator
      // E + F (F adiacent sibling of E)
      case '+':
        match = selector.match(snap.re.Patterns.adjacent);
        if(!match) throw new Error('Invalid adjacent sibling combinator in selector: ' + selector);
        source = 'var N' + k + '=e;if(e&&(e=e.previousElementSibling)){' + source + '}e=N' + k + ';';
        break;

      // *** Descendant combinator
      // E F (E ancestor of F)
      case '\x09':
      case '\x20':
        match = selector.match(snap.re.Patterns.ancestor);
        if(!match) throw new Error('Invalid descendant combinator in selector: ' + selector);
        source = 'var N' + k + '=e;while(e&&(e=e.parentElement)){' + source + '}e=N' + k + ';';
        break;

      // *** Child combinator
      // E > F (F children of E)
      case '>':
        match = selector.match(snap.re.Patterns.children);
        if(!match) throw new Error('Invalid child combinator in selector: ' + selector);
        source = 'var N' + k + '=e;if(e&&(e=e.parentElement)){' + source + '}e=N' + k + ';';
        break;

      // *** user supplied combinators extensions
      case (symbol in snap.combinators ? symbol : undefined):
        // for other registered combinators extensions
        throw new Error('FIXME: custom combinators are not supported yet'); // TODO: implement custom combinators
        // match[match.length - 1] = '*';
        // source = Combinators[symbol](match) + source;
        // break;

      // *** tree-structural pseudo-classes
      // :root, :empty, :first-child, :last-child, :only-child, :first-of-type, :last-of-type, :only-of-type
      case ':':
        if ((match = selector.match(snap.re.Patterns.structural))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'scope':
              // use the root (documentElement) when comparing against a document
              source = 'if(e===(s.from.nodeType===9?s.root:s.from)){' + source + '}';
              break;
            case 'root':
              // there can only be one :root element, so exit the loop once found
              source = 'if((e===s.root)){' + source + (mode ? 'break main;' : '') + '}';
              break;
            case 'empty':
              // matches elements that don't contain elements or text nodes
              source = 'n=e.firstChild;while(n&&!(/1|3/).test(n.nodeType)){n=n.nextSibling}if(!n){' + source + '}';
              break;

            // *** child-indexed pseudo-classes
            // :first-child, :last-child, :only-child
            case 'only-child':
              source = 'if((!e.nextElementSibling&&!e.previousElementSibling)){' + source + '}';
              break;
            case 'last-child':
              source = 'if((!e.nextElementSibling)){' + source + '}';
              break;
            case 'first-child':
              source = 'if((!e.previousElementSibling)){' + source + '}';
              break;

            // *** typed child-indexed pseudo-classes
            // :only-of-type, :last-of-type, :first-of-type
            case 'only-of-type':
              source = 'o=e.localName;' +
                'n=e;while((n=n.nextElementSibling)&&n.localName!=o);if(!n){' +
                'n=e;while((n=n.previousElementSibling)&&n.localName!=o);}if(!n){' + source + '}';
              break;
            case 'last-of-type':
              source = 'n=e;o=e.localName;while((n=n.nextElementSibling)&&n.localName!=o);if(!n){' + source + '}';
              break;
            case 'first-of-type':
              source = 'n=e;o=e.localName;while((n=n.previousElementSibling)&&n.localName!=o);if(!n){' + source + '}';
              break;
            default:
              emit(`Unsupported structural-tree pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // *** child-indexed & typed child-indexed pseudo-classes
        // :nth-child, :nth-of-type, :nth-last-child, :nth-last-of-type
        else if ((match = selector.match(snap.re.Patterns.treestruct))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'nth-child':
            case 'nth-of-type':
            case 'nth-last-child':
            case 'nth-last-of-type': {
              const isOfType = /-of-type/i.test(match[1]);
              let test: string;
              if (match[1] && match[2]) {
                const isLastType = /last/i.test(match[1]);
                if (match[2] == 'n') {
                  source = 'if(true){' + source + '}';
                  break;
                } else if (match[2] == '1') {
                  test = isLastType ? 'next' : 'previous';
                  source = isOfType ? 'n=e;o=e.localName;' +
                    'while((n=n.' + test + 'ElementSibling)&&n.localName!=o);if(!n){' + source + '}' :
                    'if(!e.' + test + 'ElementSibling){' + source + '}';
                  break;
                } else if (match[2] == 'even' || match[2] == '2n0' || match[2] == '2n+0' || match[2] == '2n') {
                  test = 'n%2==0';
                } else if (match[2] == 'odd'  || match[2] == '2n1' || match[2] == '2n+1') {
                  test = 'n%2==1';
                } else {
                  const f = /n/i.test(match[2]);
                  const n = match[2].split('n');
                  let a = parseInt(n[0], 10) || 0;
                  const b = parseInt(n[1], 10) || 0;
                  if (n[0] == '-') { a = -1; }
                  if (n[0] == '+') { a = +1; }
                  test = (b ? '(n' + (b > 0 ? '-' : '+') + Math.abs(b) + ')' : 'n') + '%' + a + '==0' ;
                  test =
                    a >= +1 ? (f ? 'n>' + (b - 1) + (Math.abs(a) != 1 ? '&&' + test : '') : 'n==' + a) :
                    a <= -1 ? (f ? 'n<' + (b + 1) + (Math.abs(a) != 1 ? '&&' + test : '') : 'n==' + a) :
                    a === 0 ? (n[0] ? 'n==' + b : 'n>' + (b - 1)) : 'false';
                }
                const nthCall = isOfType ? `s.nthOfType(e,${isLastType})` : `s.nthElement(e,${isLastType})`;
                source = `n=${nthCall};if((${test})){${source}}`;

                const cleanup = isOfType ? `s.nthOfType(null, 2);` : `s.nthElement(null, 2);`;
                if (!out.post.includes(cleanup)) out.post += cleanup;
              } else {
                emit(`Invalid syntax for child-indexed pseudo-class ${match[2] != null ? `:${match[1]}(${match[2]})` : `:${match[1]}`} in selector: ${expression}`, snap.config);
              }
              break;
            }
            default:
              emit(`Unsupported child-indexed pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // *** logical combination pseudo-classes
        // :is( s1, [ s2, ... ]), :not( s1, [ s2, ... ]),
        // :has( s1, [ s2, ... ]) no nesting is allowed for
        // :where( s1, [ s2, ... ]), :matches( s1, [ s2, ... ]),
        // else if ((match = selector.match(snap.re.Patterns.logicalsel))) {
        else if ((match = matchLogicalSelector(selector))) {
          match[1] = match[1].toLowerCase();
          const expr = match[2]
            .replace(snap.re.CommaGroup, ',')
            .replace(snap.re.TrimSpaces, '')
            .replace(/\x22/g, '\\"');
          switch (match[1]) {
            case 'is':
            case 'where':
              if (snap.config.FORGIVING) {
                source =
                  'try{' +
                    'if(s.match("' + expr + '",e)){' + source + '}' +
                  '}catch(E){}';
              } else {
                source = 'if(s.match("' + expr + '",e)){' + source + '}';
              }
              break;
            case 'matches':
              source = 'if(s.match("' + expr + '",e)){' + source + '}';
              break;
            case 'not':
              source = 'if(!s.match("' + expr + '",e)){' + source + '}';
              break;
            case 'has':
              if (/^\s*(\+|\~)/.test(match[2])) {
                source = 'if(e.parentElement&&Array.from(e.parentElement' +
                  (/^\s*[+]/.test(match[2]) ?
                    '.querySelectorAll("*' + expr + '")' : '.children') +
                    ').includes(e.nextElementSibling)){' + source + '}';
              } else {
                source = 'if(s.first(":scope ' + expr + '",e)){' + source + '}';
              }
              break;
            default:
              emit(`Unsupported combinator pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // *** linguistic pseudo-classes
        // :dir( ltr / rtl ), :lang( en )
        else if ((match = selector.match(snap.re.Patterns.linguistic))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'dir':
              source = 'var p;if((' +
                '(/' + match[2] + '/i.test(e.dir))||(p=s.ancestor("[dir]", e))&&' +
                '(/' + match[2] + '/i.test(p.dir))||(e.dir==""||e.dir=="auto")&&' +
                '(' + (match[2] == 'ltr' ? '!':'')+ snap.re.RTL +'.test(e.textContent)))' +
                '){' + source + '};';
              break;
            case 'lang': {
              const expr = '(?:^|-)' + match[2] + '(?:-|$)';
              source = 'var p;if((' +
                '(e.isConnected&&(e.lang==""&&(p=s.ancestor("[lang]",e)))&&' +
                '(p.lang=="' + match[2] + '")||/'+ expr +'/i.test(e.lang)))' +
                '){' + source + '};';
              break;
            }
            default:
              emit(`Unsupported linguistic pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // *** location pseudo-classes
        // :any-link, :link, :visited, :target, :defined
        else if ((match = selector.match(snap.re.Patterns.locationpc))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'any-link':
              source = 'if((/^a|area$/i.test(e.localName)&&e.hasAttribute("href")||e.visited)){' + source + '}';
              break;
            case 'link':
              source = 'if((/^a|area$/i.test(e.localName)&&e.hasAttribute("href"))){' + source + '}';
              break;
            case 'visited':
              source = 'if((/^a|area$/i.test(e.localName)&&e.hasAttribute("href")&&e.visited)){' + source + '}';
              break;
            case 'target':
              source = 'if(((s.doc.compareDocumentPosition(e)&16)&&s.doc.location.hash&&e.id==s.doc.location.hash.slice(1))){' + source + '}';
              break;
            case 'defined':
              source = 'n=s.doc.defaultView.customElements.get(e.localName);if(n&&e instanceof n){' + source + '}';
              break;
            default:
              emit(`Unsupported location pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // *** user actions pseudo-classes
        // :hover, :active, :focus, :focus-visible, :focus-within
        else if ((match = selector.match(snap.re.Patterns.useraction))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'hover':
              source = 'if(e===s.hoverTarget){' + source + '}';
              break;
            case 'active':
              source = 'if(e===s.doc.activeElement){' + source + '}';
              break;
            case 'focus':
              source = 'if(s.isFocusable(e)){' + source + '}';
              break;
            case 'focus-visible':
              source = 'if(n=s.isFocusable(e)){' +
                'if(e!==n){while(e){e=e.parentElement;if(e===n)break;}}}' +
                'if((e===n||e.autofocus)){' + source + '}';
              break;
            case 'focus-within':
              source = 'if(n=s.isFocusable(e)){' +
                'if(n!==e){while(n){n=n.parentElement;if(n===e)break;}}}' +
                'if((n===e||n.autofocus)){' + source + '}';
              break;
            default:
              emit(`Unsupported user action pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // *** user interface and form pseudo-classes
        // :enabled, :disabled, :read-only, :read-write, :placeholder-shown, :default
        else if ((match = selector.match(snap.re.Patterns.inputstate))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'enabled':
              source = 'if((("form" in e||/^optgroup$/i.test(e.localName))&&"disabled" in e &&e.disabled===false' +
                ')){' + source + '}';
              break;
            case 'disabled':
              // https://html.spec.whatwg.org/#enabling-and-disabling-form-controls:-the-disabled-attribute
              source = 'if((("form" in e||/^optgroup$/i.test(e.localName))&&"disabled" in e)){' +
                // F is true if any of the fieldset elements in the ancestry chain has the disabled attribute specified
                // L is true if the first legend element of the fieldset contains the element
                'var x=0,N=[],F=false,L=false;' +
                'if(!(/^(optgroup|option)$/i.test(e.localName))){' +
                  'n=e.parentElement;' +
                  'while(n){' +
                    'if(n.localName=="fieldset"){' +
                      'N[x++]=n;' +
                      'if(n.disabled===true){' +
                        'F=true;' +
                        'break;' +
                      '}' +
                    '}' +
                    'n=n.parentElement;' +
                  '}' +
                  'for(var x=0;x<N.length;x++){' +
                    'if((n=s.first("legend",N[x]))&&n.contains(e)){' +
                      'L=true;' +
                      'break;' +
                    '}' +
                  '}' +
                '}' +
                'if(e.disabled===true||(F&&!L)){' + source + '}}';
              break;
            case 'read-only':
              source =
                'if(' +
                  '(/^textarea$/i.test(e.localName)&&(e.readOnly||e.disabled))||' +
                  '(/^input$/i.test(e.localName)&&("|date|datetime-local|email|month|number|password|search|tel|text|time|url|week|".includes("|"+e.type+"|")?(e.readOnly||e.disabled):true))||' +
                  '(!/^(?:input|textarea)$/i.test(e.localName) && !s.isContentEditable(e))' +
                '){' + source + '}';
              break;
            case 'read-write':
              source =
                'if(' +
                  '(/^textarea$/i.test(e.localName)&&!e.readOnly&&!e.disabled)||' +
                  '(/^input$/i.test(e.localName)&&"|date|datetime-local|email|month|number|password|search|tel|text|time|url|week|".includes("|"+e.type+"|")&&!e.readOnly&&!e.disabled)||' +
                  '(!/^(?:input|textarea)$/i.test(e.localName) && s.isContentEditable(e))' +
                '){' + source + '}';
              break;
            case 'placeholder-shown':
              source =
                'if((' +
                  '(/^input|textarea$/i.test(e.localName))&&e.hasAttribute("placeholder")&&' +
                  '("|textarea|password|number|search|email|text|tel|url|".includes("|"+e.type+"|"))&&' +
                  '(!s.match(":focus",e))' +
                ')){' + source + '}';
              break;
            case 'default':
              source =
                'if(("form" in e && e.form)){' +
                  'var x=0;n=[];' +
                  'if(e.type=="image")n=e.form.getElementsByTagName("input");' +
                  'if(e.type=="submit")n=e.form.elements;' +
                  'while(n[x]&&e!==n[x]){' +
                    'if(n[x].type=="image")break;' +
                    'if(n[x].type=="submit")break;' +
                    'x++;' +
                  '}' +
                '}' +
                'if((e.form&&(e===n[x]&&"|image|submit|".includes("|"+e.type+"|"))||' +
                  '((/^option$/i.test(e.localName))&&e.defaultSelected)||' +
                  '(("|radio|checkbox|".includes("|"+e.type+"|"))&&e.defaultChecked)' +
                ')){' + source + '}';
              break;
            default:
              emit(`Unsupported ui/form pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // *** input pseudo-classes (for form validation)
        // :checked, :indeterminate, :valid, :invalid, :in-range, :out-of-range, :required, :optional
        else if ((match = selector.match(snap.re.Patterns.inputvalue))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'checked':
              source = 'if((/^input$/i.test(e.localName)&&' +
                '("|radio|checkbox|".includes("|"+e.type+"|")&&e.checked)||' +
                '(/^option$/i.test(e.localName)&&(e.selected||e.checked))' +
                ')){' + source + '}';
              break;
            case 'indeterminate':
              source =
                'if((/^progress$/i.test(e.localName)&&!e.hasAttribute("value"))||' +
                  '(/^input$/i.test(e.localName)&&("checkbox"==e.type&&e.indeterminate)||' +
                  '("radio"==e.type&&e.name&&!s.first("input[name="+e.name+"]:checked",e.form))' +
                ')){' + source + '}';
              break;
            case 'required':
              source =
                'if((/^input|select|textarea$/i.test(e.localName)&&e.required)' +
                '){' + source + '}';
              break;
            case 'optional':
              source =
                'if((/^input|select|textarea$/i.test(e.localName)&&!e.required)' +
                '){' + source + '}';
              break;
            case 'invalid':
              source =
                'if(((' +
                  '(/^form$/i.test(e.localName)&&!e.noValidate)||' +
                  '(e.willValidate&&!e.formNoValidate))&&!e.checkValidity())||' +
                  '(/^fieldset$/i.test(e.localName)&&s.first(":invalid",e))' +
                '){' + source + '}';
              break;
            case 'valid':
              source =
                'if(((' +
                  '(/^form$/i.test(e.localName)&&!e.noValidate)||' +
                  '(e.willValidate&&!e.formNoValidate))&&e.checkValidity())||' +
                  '(/^fieldset$/i.test(e.localName)&&s.first(":valid",e))' +
                '){' + source + '}';
              break;
            case 'in-range':
              source =
                'if((/^input$/i.test(e.localName))&&' +
                  '(e.willValidate&&!e.formNoValidate)&&' +
                  '(!e.validity.rangeUnderflow&&!e.validity.rangeOverflow)&&' +
                  '("|date|datetime-local|month|number|range|time|week|".includes("|"+e.type+"|"))&&' +
                  '("range"==e.type||e.getAttribute("min")||e.getAttribute("max"))' +
                '){' + source + '}';
              break;
            case 'out-of-range':
              source =
                'if((/^input$/i.test(e.localName))&&' +
                  '(e.willValidate&&!e.formNoValidate)&&' +
                  '(e.validity.rangeUnderflow||e.validity.rangeOverflow)&&' +
                  '("|date|datetime-local|month|number|range|time|week|".includes("|"+e.type+"|"))&&' +
                  '("range"==e.type||e.getAttribute("min")||e.getAttribute("max"))' +
                '){' + source + '}';
              break;
            default:
              emit(`Unsupported input pseudo-class: ${match[1]}, in selector: ${expression}`, snap.config);
              break;
          }
        }

        // resources state pseudo-classes (multimedia state)
        // :playing, :paused, :seeking, :buffering, :stalled, :muted, :volume-locked
        else if ((match = selector.match(snap.re.Patterns.rsrc_state))) {
          match[1] = match[1].toLowerCase();
          switch (match[1]) {
            case 'playing':
              source = 'if(s.isPlaying(e)){' + source + '}';
              break;
            case 'paused':
              source = 'if(!s.isPlaying(e)){' + source + '}';
              break;
            case 'seeking':
              source = 'if(!s.isPlaying(e)){' + source + '}';
              break;
            case 'buffering':
              break;
            case 'stalled':
              break;
            case 'muted':
              source = 'if(e.localName=="audio"&&e.getAttribute("muted")){' + source + '}';
              break;
            case 'volume-locked':
              break;
            default:
              break;
          }
        }

        // placeholder for parse only no-op selectors
        else if ((match = selector.match(snap.re.Patterns.pseudo_nop))) {
          break;
        }

        // allow pseudo-elements starting with single colon (:)
        // :after, :before, :first-letter, :first-line
        // assert: e.type is in double-colon format, like ::after
        else if ((match = selector.match(snap.re.Patterns.pseudo_sng))) {
          source = 'if(e.element&&e.type.toLowerCase()=="' +
            ':' + match[0].toLowerCase() + '"){e=e.element;' + source + '}';
        }

        // allow pseudo-elements starting with double colon (::)
        // ::after, ::before, ::marker, ::placeholder, ::inactive-selection, ::selection, ::-webkit-<foo-bar>
        // assert: e.type is in double-colon format, like ::after
        else if ((match = selector.match(snap.re.Patterns.pseudo_dbl))) {
          source = 'if(e.element&&e.type.toLowerCase()=="' +
            match[0].toLowerCase() + '"){e=e.element;' + source + '}';
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
            if (snap.config.FORGIVING &&
              selector.match(/(:(?:is|where)\x28)/)) {
              return out;
            }
            emit(`Unrecognized selector component: ${selector} in selector: ${expression}`, snap.config);
            return out;
          }

          if (!expr) {
            if (snap.config.FORGIVING &&
              selector.match(/(:(?:is|where)\x28)/)) {
              return out;
            }
            emit('Unknown token in selector: ' + selector + ' in selector: ' + expression, snap.config);
            return out;
          }

        }
        break;

    default:
      emit(`Unexpected token '${symbol}' in selector: ${expression}`, snap.config);
      break selector_recursion_label;

    }
    // end of switch symbol

    if (!match) {
      if (snap.config.FORGIVING &&
        selector.match(/(:(?:is|where)\x28)/)) {
        return out;
      }
      emit(`Failed to parse selector component: ${selector} in selector: ${expression}`, snap.config);
      return out;
    }

    // pop last component
    selector = match.pop();
  }
  // end of while selector

  out.source = source;
  return out;
}

// equivalent of w3c 'closest' method
function ancestorRaw(selectors: string, element: Element, callback: QueryCallback | null, snap: Snapshot): Element | null {
  updateSnapshot(snap, element);

  const scoped = prepareScope(selectors, element);
  try {
    let el: Element | null = element;
    while (el) {
      if (matchRaw(scoped.selectors, el, callback, snap)) break;
      el = el.parentElement;
    }
    return el;
  } finally {
    scoped.cleanup();
  }
}

function match_collect(selectors: string[], cb: QueryCallback | null, snap: Snapshot): { factory: MatchLambda[] } {
  const f: MatchLambda[] = [];
  for (let i = 0, l = selectors.length; l > i; ++i)
    f[i] = compile(selectors[i], false, cb, snap);
  return { factory: f };
}

// unique parser entry point for all
// methods (type matching/selecting)
export function parse(selectors: string, re: Rex, config: NwsConfig): string[] {
  // arguments validation
  if (arguments.length === 0) {
    throw new Error('[parse] Missing argument: selector');
  } else if (arguments[0] === '') {
    emit(`[parse] '' is not a valid selector`, config);
    return [];
  }

  // input NULL or UNDEFINED
  if (typeof selectors != 'string') {
    selectors = '' + selectors;
  }

  // normalize input string
  const normalized = selectors
    .replace(/\x00|\\$/g, '\ufffd')
    .replace(re.CombineWSP, '\x20')
    .replace(re.PseudosWSP, '$1$2')
    .replace(re.TabCharWSP, '\t')
    .replace(re.CommaGroup, ',')
    .replace(re.TrimSpaces, '');

  // parse, validate and split possible compound selectors
  const validated = normalized.match(re.validator);
  if (validated?.join('') == normalized) {
    if (normalized[normalized.length - 1] == ',') {
      emit(`[parse] Selector cannot end with a comma: '${selectors}'`, config);
      return [];
    }
    return splitSelectorGroups(normalized);
  } else {
    if (config.FORGIVING) {
      // forgiving pseudos allow to continue even after parse errors
      if (!(normalized.includes(':is(') || normalized.includes(':where('))) {
        emit(`[parse] Failed to validate selector: '${normalized}'`, config);
        return [];
      }
    }
    return [];
  }
}

// equivalent of w3c 'matches' method
function matchRaw(selectors: string, element: Element, cb: QueryCallback | null, snap: Snapshot): boolean {
  updateSnapshot(snap, element);

  if (!selectors) {
    emit(`[match] Empty selector is not valid`, snap.config);
    return false;
  }

  const scoped = prepareScope(selectors, element);
  try {
    let resolver = snap.matchResolvers[selectors];
    if (!resolver) {
      const parsed = parse(scoped.selectors, snap.re, snap.config);
      resolver = snap.matchResolvers[selectors] = match_collect(parsed, cb, snap);
    }
    return resolver.factory.some(f => f(element, cb, null, false));
  } finally {
    scoped.cleanup();
  }
}

// equivalent of w3c 'querySelector' method
function firstRaw(selectors: string, context: QueryContext, callback: QueryCallback | null, snap: Snapshot): Element | null {
  updateSnapshot(snap, context);
  return selectRaw(selectors, context,
    typeof callback == 'function' ?
    function firstMatch(element) {
      callback(element);
      return false;
    } :
    function firstMatch() {
      return false;
    },
    snap,
  )[0] || null;
}

// equivalent of w3c 'querySelectorAll' method
function selectRaw(sel: string, ctx: QueryContext, cb: QueryCallback | null, snap: Snapshot): Element[] {
  updateSnapshot(snap, ctx);

  let nodes: Element[] = [];
  if (!sel) {
    emit(`[select] Empty selector is not valid`, snap.config);
    return [];
  }

  const scoped = prepareScope(sel, ctx);

  try {
    if (!scoped.selectors) return nodes;
    if (snap.isDebug) {
      snap.debugSelect = { callback: cb, context: describeContext(ctx), run: [] };
    }

    // try to reuse cached resolver
    let resolver = snap.selectResolvers[scoped.selectors];
    if (!resolver || resolver.context !== ctx || resolver.callback !== cb) {
      const parsed = parse(scoped.selectors, snap.re, snap.config);
      resolver = buildResolver(parsed, ctx, cb, snap);
      snap.selectResolvers[scoped.selectors] = resolver;
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
  } catch (e) {
    if (snap.isDebug) {
      if (!snap.debugSelect) snap.debugSelect = {};
      snap.debugSelect.error = e instanceof Error ? e.message : String(e);
    }
    throw e;
  } finally {
    scoped.cleanup();
  }
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
        getCandidates = () => byId(query, ctx, snap);
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
        if (!snap.isHtml && query !== '*') {
          // XML type selectors are not equivalent to DOM tag-name lookup.
          query = '*';
          compileQuery = sel;
        } else {
          query = cssIdentUnescape(query);
        }
        getCandidates = () => byTagRaw(query, ctx, snap);
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

function prepareScope(selectors: string, context: QueryContext) {
  const SCOPE_ATTR = 'data-nwsapi-scope';
  const HAS_SCOPE = /:scope\b/i;
  const RE_SCOPE = /:scope\b/gi;

  if (!HAS_SCOPE.test(selectors)) {
    return { selectors, cleanup: () => {} };
  }

  const element = isDocument(context) ? context.documentElement
    : isElement(context) ? context
    : null;

  const oldValue = element?.getAttribute(SCOPE_ATTR);
  element?.setAttribute(SCOPE_ATTR, '');

  return {
    selectors: selectors.replace(RE_SCOPE, `[${SCOPE_ATTR}]`),
    cleanup: () => oldValue == null
      ? element?.removeAttribute(SCOPE_ATTR)
      : element?.setAttribute(SCOPE_ATTR, oldValue),
  };
}

export function matchLogicalSelector(selector: string): RegExpMatchArray | null {
  const head = /^:(is|where|matches|not|has)\(/i.exec(selector);
  if (!head) return null;

  const open = head[0].length - 1;
  const close = findClosingParen(selector, open);
  if (close < 0) return null;

  const argStart = open + 1;
  const arg = selector.slice(argStart, close).trim();
  const tail = selector.slice(close + 1);

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

export function splitSelectorGroups(selector: string): string[] {
  const out: string[] = [];
  let start = 0, depth = 0, quote = '', inAttr = false;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];

    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (inAttr) { if (ch === ']') inAttr = false; continue; }
    if (ch === '[') { inAttr = true; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { if (depth) depth--; continue; }

    if (ch === ',' && depth === 0) {
      out.push(selector.slice(start, i));
      start = i + 1;
    }
  }

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
