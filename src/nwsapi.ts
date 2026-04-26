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
      const l = combinator.length;
      let symbol;
      for (let i = 0; l > i; ++i) {
        if (combinator[i] != '=') {
          symbol = combinator[i];
          break;
        }
      }
      if (!symbol) throw new Error('Invalid combinator: ' + combinator);
      if (_snap.ext.combinators.indexOf(symbol) < 0) {
        _snap.ext.combinators = _snap.ext.combinators.replace('](', symbol + '](');
        _snap.ext.combinators = _snap.ext.combinators.replace('])', symbol + '])');
        _snap.combinators[combinator] = resolver;
        _snap.re = buildRex(_snap.ext);
      } else {
        console.warn('Warning: the \'' + combinator + '\' combinator is already registered.');
      }
    },

    // register a new attribute operator symbol and its related function resolver
    // NW.Dom.registerOperator( '!=', { p1: '^', p2: '$', p3: 'false' } );
    registerOperator(operator: string, resolver: AttrMatcherParts) {
      const l = operator.length;
      let symbol;
      for (let i = 0; l > i; ++i) {
        if (operator[i] != '=') {
          symbol = operator[i];
          break;
        }
      }
      if (!symbol) throw new Error('Invalid operator: ' + operator);
      if (_snap.ext.operators.indexOf(symbol) < 0 && !_snap.operators[operator]) {
        _snap.ext.operators = _snap.ext.operators.replace(']=', symbol + ']=');
        _snap.operators[operator] = resolver;
        _snap.re = buildRex(_snap.ext);
      } else {
        console.warn('Warning: the \'' + operator + '\' operator is already registered.');
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
      _snap.debugCompile = undefined;
      _snap.debugCollect = undefined;
    },

    printDebug() {
      const docDesc = describeQueryContext(_snap.doc);
      const fromDesc = describeQueryContext(_snap.from);
      return JSON.stringify({
        snapshot: {
          isHtml: _snap.isHtml,
          isQuirksMode: _snap.isQuirksMode,
          namespace: _snap.namespace,
          doc: docDesc,
          from: _snap.from === _snap.doc ? '(same as doc)' : fromDesc,
          root: { summary: describeElement(_snap.root) },
        },
        debugCollect: _snap.debugCollect,
        debugCompile: _snap.debugCompile,
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
  operators: '[~*^$|]=|=',
  combinators: '[\\x20\\t>+~](?=[^>+~])'
};

export function initSnapshot(doc: Document): SnapshotState {
  const snap = {
    doc: doc,
    from: doc,
    root: doc.documentElement,
    isHtml: isHtmlDoc(doc),
    isQuirksMode: isQuirksMode(doc),
    namespace: getNamespace(doc),
    re: undefined as any,

    isDebug: false,

    // special handling configuration flags
    config: { ...DEFAULT_CONFIG },
    ext: { ...DEFAULT_EXTENSIONS },
    selectors: {},
    combinators: {}, // TODO: ???
    operators: {
      '=':  { p1: '^',       p2: '$',       p3: 'true' },
      '^=': { p1: '^',       p2: '',        p3: 'true' },
      '$=': { p1: '',        p2: '$',       p3: 'true' },
      '*=': { p1: '',        p2: '',        p3: 'true' },
      '|=': { p1: '^',       p2: '(-|$)',   p3: 'true' },
      '~=': { p1: '(^|\\s)', p2: '(\\s|$)', p3: 'true' },
    },

    hoverTarget: null,

    // cached
    matchLambdas: {},
    selectLambdas: {},
    matchResolvers: {},
    selectResolvers: {},

    byTag: undefined as any,
    first: undefined as any,
    match: undefined as any,
    select: undefined as any,
    ancestor: undefined as any,

    nthOfType: nthOfType,
    nthElement: nthElement,

    isFocusable: isFocusable,
    isContentEditable: isContentEditable,
    hasAttributeNS: undefined as any,
  };

  snap.re = buildRex(snap.ext);
  snap.byTag = (tag: string, context?: QueryContext) => byTagRaw(tag, context ?? snap.doc, snap);
  snap.first = (sel: string, context?: QueryContext, cb?: QueryCallback | null) => firstRaw(sel, context ?? snap.doc, cb ?? null, snap);
  snap.match = (sel: string, context: Element, cb?: QueryCallback | null) => matchRaw(sel, context, cb ?? null, snap);
  snap.select = (sel: string, context?: QueryContext, cb?: QueryCallback | null) => selectRaw(sel, context ?? snap.doc, cb ?? null, snap);
  snap.ancestor = (sel: string, context: Element, cb?: QueryCallback | null) => ancestorRaw(sel, context, cb ?? null, snap);
  snap.hasAttributeNS = (e: Element, name: string) => hasAttributeNS(e, name, snap);

  return snap;
}

function concatCall(nodes: Element[], callback: QueryCallback): Element[] {
  const list: Element[] = [];
  for (let i = 0, l = nodes.length; i < l; ++i) {
    const node = nodes[i];
    list.push(node);
    if (callback(node) === false) break;
  }
  return list;
}

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
  return doc.documentElement ? doc.documentElement.namespaceURI : null;
}

function updateSnapshot(snap: SnapshotState, ctx: QueryContext, force = false): SnapshotState {
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

// convert single codepoint to UTF-16 encoding
export function codePointToUTF16(codePoint: number): string {
  // out of range, use replacement character
  if (codePoint < 1 || codePoint > 0x10ffff ||
    (codePoint > 0xd7ff && codePoint < 0xe000)) {
    return '\\ufffd';
  }
  // javascript strings are UTF-16 encoded
  if (codePoint < 0x10000) {
    var lowHex = '000' + codePoint.toString(16);
    return '\\u' + lowHex.substr(lowHex.length - 4);
  }
  // supplementary high + low surrogates
  return '\\u' + (((codePoint - 0x10000) >> 0x0a) + 0xd800).toString(16) +
         '\\u' + (((codePoint - 0x10000) % 0x400) + 0xdc00).toString(16);
}

// convert single codepoint to string
export function stringFromCodePoint(codePoint: number): string {
  // out of range, use replacement character
  if (codePoint < 1 || codePoint > 0x10ffff ||
    (codePoint > 0xd7ff && codePoint < 0xe000)) {
    return '\ufffd';
  }
  if (codePoint < 0x10000) {
    return String.fromCharCode(codePoint);
  }
  return String.fromCodePoint ?
    String.fromCodePoint(codePoint) :
    String.fromCharCode(
      ((codePoint - 0x10000) >> 0x0a) + 0xd800,
      ((codePoint - 0x10000) % 0x400) + 0xdc00);
}

export function decodeCssEscapes(ident: string, RE: Rex): string {
  return RE.HasEscapes.test(ident)
    ? ident.replace(RE.FixEscapes, (substring, p1, p2) =>
        // unescaped " or '
        p2 ? '\\' + p2 :
        // javascript strings are UTF-16 encoded
        RE.HexNumbers.test(p1) ? codePointToUTF16(parseInt(p1, 16)) :
        // \' \"
        RE.EscOrQuote.test(p1) ? substring :
        // \g \h \. \# etc
        p1)
    : ident;
}

// convert escape sequence in a CSS string or identifier
// to javascript string with characters representations
export function unescapeIdentifier(str: string, RE: Rex): string {
  return RE.HasEscapes.test(str) ?
    str.replace(RE.FixEscapes, (substring, p1, p2) =>
      // unescaped " or '
      p2 ? p2 :
      // javascript strings are UTF-16 encoded
      RE.HexNumbers.test(p1) ? stringFromCodePoint(parseInt(p1, 16)) :
      // \' \"
      RE.EscOrQuote.test(p1) ? substring :
      // \g \h \. \# etc
      p1
    ) : str;
}

// TODO: implement
export function cssEscape(str: string): string {
  return CSS?.escape ? CSS.escape(str) : str;
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
function byId(id: string, context: QueryContext, snap: SnapshotState): Element[] {
  updateSnapshot(snap, context);
  if (!snap.config.IDS_DUPES && 'getElementById' in context) {
    const e = context.getElementById(id);
    return e ? [e] : [];
  }

  return byIdRaw(id, context);
}

// TODO: namespace-aware tag lookup
// wrapped up namespaced TagName api calls
function byTagNSRaw(tag: string, context: QueryContext, snap: SnapshotState): Element[] {
  updateSnapshot(snap, context);
  return byTagRaw(tag, context, snap);
}

// context agnostic getElementsByTagName
function byTagRaw(tag: string, context: QueryContext, snap: SnapshotState): Element[] {
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
function byClassRaw(cls: string, context: QueryContext, snap: SnapshotState): Element[] {
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

// namespace aware hasAttribute
// helper for XML/XHTML documents
function hasAttributeNS(e: Element, name: string, snap: SnapshotState): boolean {
  const attr = e.getAttributeNames();
  const reName = new RegExp(':?' + escapeRegExp(name) + '$', snap.isHtml ? 'i' : '');
  for (let i = 0, l = attr.length; l > i; ++i) {
    if (reName.test(attr[i])) return true;
  }
  return false;
}

type NthElementState = {
  idx: number; len: number; set: number; parent: Element | null | undefined; parents: (Element | null)[]; nodes: Element[][];
}
const nthState: NthElementState = {
  idx: 0, len: 0, set: 0, parent: undefined, parents: [], nodes: []
};
// fast resolver for the :nth-child() and :nth-last-child() pseudo-classes
function nthElement(element: Element, dir: number): number {
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
const nthOfType: NthFn = function(element: Element, dir: number): number {
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

function describeQueryContext(ctx: QueryContext): QueryContextDescription {
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

function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildRex(ext: NwsExtensions): Rex {
  const WSH = '[\\x20\\t]';
  const WSV = '[\\r\\n\\f]';
  const WSP = '[\\x20\\t\\r\\n\\f]';
  const HAS = {
    nestedself: ':has\\x28(?::has\\x28|.*)\\x29)\\x29',
  };
  const NOT = {
    // not enclosed in double/single/parens/square
    double_enc: '(?=(?:[^"]*["][^"]*["])*[^"]*$)',
    single_enc: "(?=(?:[^']*['][^']*['])*[^']*$)",
    parens_enc: '(?![^\\x28]*\\x29)',
    square_enc: '(?![^\\x5b]*\\x5d)'
  };
  const GROUPS = {
    // pseudo-classes requiring parameters
    linguistic: '(dir|lang)(?:\\x28\\s?([-\\w]{2,})\\s?\\x29)',
    logicalsel: '(is|where|matches|not|has)(?:\\x28\\s?(' + '[^()]*|.*' + ')\\s?\\x29)',
    treestruct: '(nth(?:-last)?(?:-child|-of\\-type))(?:\\x28\\s?(even|odd|(?:[-+]?\\d*)(?:n\\s?[-+]?\\s?\\d*)?)\\s?\\x29)',
    // pseudo-classes not requiring parameters
    locationpc: '(any\\-link|link|visited|target|defined)\\b',
    useraction: '(hover|active|focus\\-within|focus\\-visible|focus)\\b',
    structural: '(scope|root|empty|(?:(?:first|last|only)(?:-child|\\-of\\-type)))\\b',
    inputstate: '(enabled|disabled|read\\-only|read\\-write|placeholder\\-shown|default)\\b',
    inputvalue: '(checked|indeterminate|required|optional|valid|invalid|in\\-range|out\\-of\\-range)\\b',
    // pseudo-classes not requiring parameters and describing functional state
    rsrc_state: '(playing|paused|seeking|buffering|stalled|muted|volume-locked)\\b',
    disp_state: '(open|closed|modal|fullscreen|picture-in-picture)\\b',
    time_state: '(current|past|future)\\b',
    // pseudo-classes for parsing only selectors
    pseudo_nop: '(autofill|-webkit\\-autofill)\\b',
    // pseudo-elements starting with single colon (:)
    pseudo_sng: '(after|before|first\\-letter|first\\-line)\\b',
    // pseudo-elements starting with double colon (::)
    pseudo_dbl: ':(after|before|first\\-letter|first\\-line|selection|placeholder|-webkit-[-a-zA-Z0-9]{2,})\\b'
  };

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

  // non-ascii chars
  const noascii = '[^\\x00-\\x9f]';
  // escaped chars
  const escaped = '\\\\[^\\r\\n\\f0-9a-fA-F]';
  // unicode chars
  const unicode = '\\\\[0-9a-fA-F]{1,6}(?:\\r\\n|\\s)?';

  // can start with single/double dash
  // but it can not start with a digit
  const identifier = '-?(?:[a-zA-Z_-]|' + noascii + '|' + escaped + '|' + unicode + ')' +
      '(?:-{2}|[0-9]|[a-zA-Z_-]|' + noascii + '|' + escaped + '|' + unicode + ')*';

  const pseudonames = '[-\\w]+';
  const pseudoparms = '(?:[-+]?\\d*)(?:n\\s?[-+]?\\s?\\d*)';
  const doublequote = '"[^"\\\\]*(?:\\\\.[^"\\\\]*)*(?:"|$)';
  const singlequote = "'[^'\\\\]*(?:\\\\.[^'\\\\]*)*(?:'|$)";

  const attrparser = identifier + '|' + doublequote + '|' + singlequote;

  const attrvalues = '([\\x22\\x27]?)((?!\\3)*|(?:\\\\?.)*?)(?:\\3|$)';

  const attributes =
    '\\[' +
      // attribute presence
      '(?:\\*\\|)?' +
      WSP + '?' +
      '(' + identifier + '(?::' + identifier + ')?)' +
      WSP + '?' +
      '(?:' +
        '(' + ext.operators + ')' + WSP + '?' +
        '(?:' + attrparser + ')' +
      ')?' +
      // attribute case sensitivity
      '(?:' + WSP + '?\\b(i))?' + WSP + '?' +
    '(?:\\]|$)';

  const attrmatcher = attributes.replace(attrparser, attrvalues);

  const pseudoclass =
    '(?:\\x28' + WSP + '*' +
      '(?:' + pseudoparms + '?)?|' +
      // universal * &
      // namespace *|*
      '(?:\\*|\\*\\|)|' +
      '(?:' +
        '(?::' + pseudonames +
          '(?:\\x28' + pseudoparms + '?(?:\\x29|$))?|' +
        ')|' +
        '(?:[.#]?' + identifier + ')|' +
        '(?:' + attributes + ')' +
      ')+|' +
      '(?:' + WSP + '?[>+~][^>+~]' + WSP + '?)|' +
      '(?:' + WSP + '?,' + WSP + '?)|' +
      '(?:' + WSP + '?)|' +
      '(?:\\x29|$)' +
    ')*';

  const standardValidator =
    '(?=' + WSP + '?[^>+~(){}<>])' +
    '(?:' +
      // universal * &
      // namespace *|*
      '(?:\\*|\\*\\|)|' +
      '(?:[.#]?' + identifier + ')+|' +
      '(?:' + attributes + ')+|' +
      '(?:::?' + pseudonames + pseudoclass + ')|' +
      '(?:' + WSP + '?' + ext.combinators + WSP + '?)|' +
      '(?:' + WSP + '?,' + WSP + '?)|' +
      '(?:' + WSP + '?)' +
    ')+';

  // the following global RE is used to return the
  // deepest localName in selector strings and then
  // use it to retrieve all possible matching nodes
  // that will be filtered by compiled resolvers
  const reOptimizer = RegExp(
    '(?:([.:#*]?)' +
    '(' + identifier + ')' +
    '(?:' +
      ':[-\\w]+|' +
      '\\[[^\\]]+(?:\\]|$)|' +
      '\\x28[^\\x29]+(?:\\x29|$)' +
    ')*)$');

  // global
  const reValidator = RegExp(standardValidator, 'g');

  const rex: Rex = {
    // regular expressions
    HasEscapes: RegExp('\\\\'),
    HexNumbers: RegExp('^[0-9a-fA-F]'),
    EscOrQuote: RegExp('^\\\\|[\\x22\\x27]'),
    RegExpChar: RegExp('(?!\\\\)[\\\\^$.,*+?()[\\]{}|\\/]', 'g'),
    TrimSpaces: RegExp('^' + WSP + '+|' + WSP + '+$|' + WSV, 'g'),
    SplitGroup: RegExp('(\\([^)]*\\)|\\[[^[]*\\]|\\\\.|[^,])+', 'g'),
    CommaGroup: RegExp('(\\s*,\\s*)' + NOT.square_enc + NOT.parens_enc, 'g'),
    FixEscapes: RegExp('\\\\([0-9a-fA-F]{1,6}' + WSP + '?|.)|([\\x22\\x27])', 'g'),
    CombineWSP: RegExp('[\\n\\r\\f\\x20]+' + NOT.single_enc + NOT.double_enc, 'g'),
    TabCharWSP: RegExp('(\\x20?\\t+\\x20?)' + NOT.single_enc + NOT.double_enc, 'g'),
    PseudosWSP: RegExp('\\s+([-+])\\s+' + NOT.square_enc, 'g'),
    STD: {
      combinator: RegExp('\\s?([>+~])\\s?', 'g'),
      apimethods: RegExp('^(?:\\w+|\\*)\\|'),
      namespaces: RegExp('(\\*|\\w+)\\|[\\w-]+')
    },
    Patterns: {
      // pseudo-classes
      treestruct: RegExp('^:(?:' + GROUPS.treestruct + ')(.*)', 'i'),
      structural: RegExp('^:(?:' + GROUPS.structural + ')(.*)', 'i'),
      linguistic: RegExp('^:(?:' + GROUPS.linguistic + ')(.*)', 'i'),
      useraction: RegExp('^:(?:' + GROUPS.useraction + ')(.*)', 'i'),
      inputstate: RegExp('^:(?:' + GROUPS.inputstate + ')(.*)', 'i'),
      inputvalue: RegExp('^:(?:' + GROUPS.inputvalue + ')(.*)', 'i'),
      rsrc_state: RegExp('^:(?:' + GROUPS.rsrc_state + ')(.*)', 'i'),
      disp_state: RegExp('^:(?:' + GROUPS.disp_state + ')(.*)', 'i'),
      time_state: RegExp('^:(?:' + GROUPS.time_state + ')(.*)', 'i'),
      locationpc: RegExp('^:(?:' + GROUPS.locationpc + ')(.*)', 'i'),
      logicalsel: RegExp('^:(?:' + GROUPS.logicalsel + ')(.*)', 'i'),
      pseudo_nop: RegExp('^:(?:' + GROUPS.pseudo_nop + ')(.*)', 'i'),
      pseudo_sng: RegExp('^:(?:' + GROUPS.pseudo_sng + ')(.*)', 'i'),
      pseudo_dbl: RegExp('^:(?:' + GROUPS.pseudo_dbl + ')(.*)', 'i'),
      // combinator symbols
      children: RegExp('^' + WSP + '?\\>' + WSP + '?(.*)'),
      adjacent: RegExp('^' + WSP + '?\\+' + WSP + '?(.*)'),
      relative: RegExp('^' + WSP + '?\\~' + WSP + '?(.*)'),
      ancestor: RegExp('^' + WSP + '+(.*)'),
      // universal & namespace
      universal: RegExp('^(\\*)(.*)'),
      namespace: RegExp('^(\\*|[\\w-]+)?\\|(.*)'),
      // id, class, tag
      id: RegExp('^#(' + identifier + ')(.*)'),
      tagName: RegExp('^(' + identifier + ')(.*)'),
      className: RegExp('^\\.(' + identifier + ')(.*)'),
      attribute: RegExp('^(?:' + attrmatcher + ')(.*)'),
    },

    // regexp to better aproximate detection of RTL languages (Arabic)
    RTL: RegExp('^(?:[\\u0627-\\u064a]|[\\u0591-\\u08ff]|[\\ufb1d-\\ufdfd]|[\\ufe70-\\ufefc])+$'),

    // detect structural pseudo-classes in selectors
    nthElem: RegExp('(:nth(?:-last)?-child)', 'i'),
    nthType: RegExp('(:nth(?:-last)?-of-type)', 'i'),

    optimizer: reOptimizer,
    validator: reValidator,
  };

  return rex;
}

// type Rex = ReturnType<typeof buildRex>;

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
    HEAD: 'var e,n,o,j=r.length-1,k=-1',
    LOOP: 'main:while((e=c[++k]))',
    BODY: 'r[++j]=c[k];',
    TAIL: 'continue main;',
    TEST: 'if(f(c[k])){break main;}',
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
    HEAD: 'var e,n,o',
    LOOP: 'main:while((e=c.item(++k)))',
    BODY: 'r[++j]=c.item(k);',
    TAIL: 'r=true;',
    TEST: 'if(f(c.item(k))){break main;}',
    VARS: [] as string[],
  },
} as const;

// compile groups or single selector strings into
// executable functions for matching or selecting
function compile(selector: string, mode: boolean | null, cb: QueryCallback | null, snap: SnapshotState): SelectLambda | MatchLambda {

  // 'mode' can be boolean or null
  // true = select / false = match
  // null to use collection.item()
  let [macro, head, loop] = ['', '', ''];
  switch (mode) {
    case true:
      if (snap.selectLambdas[selector]) { return snap.selectLambdas[selector]; }
      macro = MACROS.S.BODY + (!!cb ? MACROS.S.TEST : '') + MACROS.S.TAIL;
      head = MACROS.S.HEAD;
      loop = MACROS.S.LOOP;
      break;
    case false:
      if (snap.matchLambdas[selector]) { return snap.matchLambdas[selector]; }
      macro = MACROS.M.BODY + (!!cb ? MACROS.M.TEST : '') + MACROS.M.TAIL;
      head = MACROS.M.HEAD;
      loop = MACROS.M.LOOP;
      break;
    case null:
      if (snap.selectLambdas[selector]) { return snap.selectLambdas[selector]; }
      macro = MACROS.N.BODY + (!!cb ? MACROS.N.TEST : '') + MACROS.N.TAIL;
      head = MACROS.N.HEAD;
      loop = MACROS.N.LOOP;
      break;
    default: assertNever(mode);
  }

  const source = compileSelector(selector, macro, mode, cb, snap);

  loop += mode || mode === null ? '{' + source + '}' : source;

  if (mode || mode === null && selector.includes(':nth')) {
    loop += snap.re.nthElem.test(selector) ? 's.nthElement(null, 2);' : '';
    loop += snap.re.nthType.test(selector) ? 's.nthOfType(null, 2);' : '';
  }

  let vars = '';
  if (MACROS.S.VARS[0] || MACROS.M.VARS[0] || MACROS.N.VARS[0]) {
    vars = ',' + (MACROS.S.VARS.join(',') || MACROS.M.VARS.join(',') || MACROS.N.VARS[0]);
    MACROS.S.VARS.length = 0;
    MACROS.M.VARS.length = 0;
    MACROS.N.VARS.length = 0;
  }

  const f = F_INIT + '{' + head + vars + ';' + loop + 'return r;}';
  if (snap.isDebug) snap.debugCompile = f;
  const factory = Function('s', f)(snap);

  if (mode || mode === null) snap.selectLambdas[selector] = factory;
  if (!mode) snap.matchLambdas[selector] = factory;

  return factory;
}

// build conditional code to check components of selector strings
function compileSelector(expression: string, source: string, mode: boolean | null, cb: QueryCallback | null, snap: SnapshotState): string {
  const ATTR_STD_OPS = {
    '=': 1, '^=': 1, '$=': 1, '|=': 1, '*=': 1, '~=': 1
  };
  const HTML_TABLE: Record<string, number> = {
    'accept': 1, 'accept-charset': 1, 'align': 1, 'alink': 1, 'axis': 1,
    'bgcolor': 1, 'charset': 1, 'checked': 1, 'clear': 1, 'codetype': 1, 'color': 1,
    'compact': 1, 'declare': 1, 'defer': 1, 'dir': 1, 'direction': 1, 'disabled': 1,
    'enctype': 1, 'face': 1, 'frame': 1, 'hreflang': 1, 'http-equiv': 1, 'lang': 1,
    'language': 1, 'link': 1, 'media': 1, 'method': 1, 'multiple': 1, 'nohref': 1,
    'noresize': 1, 'noshade': 1, 'nowrap': 1, 'readonly': 1, 'rel': 1, 'rev': 1,
    'rules': 1, 'scope': 1, 'scrolling': 1, 'selected': 1, 'shape': 1, 'target': 1,
    'text': 1, 'type': 1, 'valign': 1, 'valuetype': 1, 'vlink': 1
  };

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
    const symbol = snap.re.STD.apimethods.test(selector) ? '|' : selector[0];

    let test: AttrMatcherParts | undefined;
    let match: RegExpMatchArray | null = null;
    switch (symbol) {

      // universal resolver
      case '*':
        match = selector.match(snap.re.Patterns.universal);
        if (!match) throw new Error('Invalid universal selector: ' + selector);
        break;

      // id resolver
      case '#':
        match = selector.match(snap.re.Patterns.id);
        if (!match) throw new Error('Invalid ID selector: ' + selector);
        source = 'if((/^' + match[1] + '$/.test(e.getAttribute("id")))){' + source + '}';
        break;

      // class name resolver
      case '.':
        match = selector.match(snap.re.Patterns.className);
        if (!match) throw new Error('Invalid class selector: ' + selector);

        const compat = (snap.isQuirksMode ? 'i' : '') + '.test(e.getAttribute("class"))';
        source = 'if((/(^|\\s)' + match[1] + '(\\s|$)/' + compat + ')){' + source + '}';
        break;

      // tag name resolver
      case (/[_a-z]/i.test(symbol) ? symbol : undefined):
        match = selector.match(snap.re.Patterns.tagName);
        if (!match) throw new Error('Invalid tag selector: ' + selector);

        source = 'if((e.localName=="' + match[1] + '")){' + source + '}';
        break;

      // namespace resolver
      case '|':
        match = selector.match(snap.re.Patterns.namespace);
        if (!match) throw new Error('Invalid namespace selector: ' + selector);

        if (match[1] == '*') {
          source = 'if(true){' + source + '}';
        } else if (!match[1]) {
          source = 'if((!e.namespaceURI)){' + source + '}';
        } else if (typeof match[1] == 'string' && snap.root.prefix == match[1]) {
          source = 'if((e.namespaceURI=="' + snap.namespace + '")){' + source + '}';
        } else {
          emit(`Unresolvable namespace prefix "${match[1]}" in selector: ${expression}`, snap.config);
        }
        break;

      // attributes resolver
      case '[': {
        match = selector.match(snap.re.Patterns.attribute);
        if (!match) throw new Error('Invalid attribute selector: ' + selector);

        const ns = match[0].match(snap.re.STD.namespaces);
        const name = match[1];
        const splitName = name.split(':');
        const localName = splitName.length == 2 ? splitName[1] : splitName[0];
        if (match[2] && !(test = snap.operators[match[2]])) {
          emit(`Unsupported attributes operator: ${match[2]}, in selector: ${expression}`, snap.config);
          return '';
        }
        if (match[4] === '') {
          test = match[2] == '~=' ?
            { p1: '^\\s', p2: '+$', p3: 'true' } :
              match[2] in ATTR_STD_OPS && match[2] != '~=' ?
            { p1: '^',    p2: '$',  p3: 'true' } : test;
        } else if (match[2] == '~=' && match[4].includes(' ')) {
          // whitespace separated list but value contains space
          break;
        } else if (match[4]) {
          match[4] = decodeCssEscapes(match[4], snap.re).replace(snap.re.RegExpChar, '\\$&');
        }
        const sensitivity = match[5] == 'i' || (snap.isHtml && HTML_TABLE[localName.toLowerCase()]) ? 'i' : '';
        let attrExpr: string;
        if (!match[2]) {
          attrExpr = ns
            ? 's.hasAttributeNS(e,"' + name + '")'
            : 'e.hasAttribute&&e.hasAttribute("' + name + '")';
        } else if (!match[4] && match[2] in ATTR_STD_OPS && match[2] != '~=') {
          attrExpr = 'e.getAttribute&&e.getAttribute("' + name + '")==""';
        } else {
          if (!test) throw new Error(`test wasn't defined for attribute selector: ${selector}`);
          attrExpr =
            '(/' + test.p1 + match[4] + test.p2 + '/' + sensitivity + ').test(e.getAttribute&&e.getAttribute("' + name + '"))==' + test.p3;
        }
        source = 'if((' + attrExpr + ')){' + source + '}';
        break;
      }

      // *** General sibling combinator
      // E ~ F (F relative sibling of E)
      case '~':
        match = selector.match(snap.re.Patterns.relative);
        source = 'var N' + k + '=e;while(e&&(e=e.previousElementSibling)){' + source + '}e=N' + k + ';';
        break;

      // *** Adjacent sibling combinator
      // E + F (F adiacent sibling of E)
      case '+':
        match = selector.match(snap.re.Patterns.adjacent);
        source = 'var N' + k + '=e;if(e&&(e=e.previousElementSibling)){' + source + '}e=N' + k + ';';
        break;

      // *** Descendant combinator
      // E F (E ancestor of F)
      case '\x09':
      case '\x20':
        match = selector.match(snap.re.Patterns.ancestor);
        source = 'var N' + k + '=e;while(e&&(e=e.parentElement)){' + source + '}e=N' + k + ';';
        break;

      // *** Child combinator
      // E > F (F children of E)
      case '>':
        match = selector.match(snap.re.Patterns.children);
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
                const expr = isOfType ? 'OfType' : 'Element';
                const type = isLastType ? 'true' : 'false';
                source = 'n=s.nth' + expr + '(e,' + type + ');if((' + test + ')){' + source + '}';
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
        else if ((match = selector.match(snap.re.Patterns.logicalsel))) {
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
              if ('match' in result) { match = result.match; }
              const vars = result.modvar;
              if (mode) {
                  // add extra select() vars
                  vars && MACROS.S.VARS.indexOf(vars) < 0 && (MACROS.S.VARS[MACROS.S.VARS.length] = vars);
              } else {
                  // add extra match() vars
                  vars && MACROS.M.VARS.indexOf(vars) < 0 && (MACROS.M.VARS[MACROS.M.VARS.length] = vars);
              }
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
              return '';
            }
            emit(`Unrecognized selector component: ${selector} in selector: ${expression}`, snap.config);
            return '';
          }

          if (!expr) {
            if (snap.config.FORGIVING &&
              selector.match(/(:(?:is|where)\x28)/)) {
              return '';
            }
            emit('Unknown token in selector: ' + selector + ' in selector: ' + expression, snap.config);
            return '';
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
        return '';
      }
      emit(`Failed to parse selector component: ${selector} in selector: ${expression}`, snap.config);
      return '';
    }

    // pop last component
    selector = match.pop();
  }
  // end of while selector

  return source;
}

// equivalent of w3c 'closest' method
function ancestorRaw(selectors: string, element: Element, callback: QueryCallback | null, snap: SnapshotState): Element | null {
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

function match_collect(selectors: string[], cb: QueryCallback | null, snap: SnapshotState): { factory: MatchLambda[] } {
  for (var i = 0, l = selectors.length, f = [ ]; l > i; ++i)
    f[i] = compile(selectors[i], false, cb, snap) as MatchLambda; // FIXME: type assertion to MatchLambda[] is not safe, but compile() can return either MatchLambda or SelectLambda
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
  const parsed = selectors.
    replace(/\x00|\\$/g, '\ufffd').
    replace(re.CombineWSP, '\x20').
    replace(re.PseudosWSP, '$1').
    replace(re.TabCharWSP, '\t').
    replace(re.CommaGroup, ',').
    replace(re.TrimSpaces, '');

  // parse, validate and split possible compound selectors
  const validated = parsed.match(re.validator);
  if (validated?.join('') == parsed) {
    if (parsed[parsed.length - 1] == ',') {
      emit(`[parse] Selector cannot end with a comma: '${selectors}'`, config);
      return [];
    }
    return parsed.match(re.SplitGroup) ?? [];
  } else {
    if (config.FORGIVING) {
      // forgiving pseudos allow to continue even after parse errors
      if (!(parsed.includes(':is(') || parsed.includes(':where('))) {
        emit(`[parse] Failed to parse selector: '${selectors}'`, config);
        return [];
      }
    }
    return [];
  }
}

// equivalent of w3c 'matches' method
function matchRaw(selectors: string, element: Element, cb: QueryCallback | null, snap: SnapshotState): boolean {
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
function firstRaw(selectors: string, context: QueryContext, callback: QueryCallback | null, snap: SnapshotState): Element | null {
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

const compat: Record<CompatKey, CompatFactory> = {
  '#': (c, n, s) => () => byId(n, c, s),
  '*': (c, n, s) => () => byTagRaw(n, c, s),
  '|': (c, n, s) => () => byTagNSRaw(n, c, s),
  '.': (c, n, s) => () => byClassRaw(n, c, s),
};

// equivalent of w3c 'querySelectorAll' method
function selectRaw(selectors: string, context: QueryContext, callback: QueryCallback | null, snap: SnapshotState): Element[] {
  let nodes: Element[] = [];
  let resolver;

  updateSnapshot(snap, context);

  if (!selectors) {
    emit(`[select] Empty selector is not valid`, snap.config);
    return [];
  }

  const scoped = prepareScope(selectors, context);

  try {
    if (!scoped.selectors) return nodes;
    if ((resolver = snap.selectResolvers[scoped.selectors])) {
      if (resolver.context === context && resolver.callback === callback) {
        const { factory: f, htmlset: h, nodeset: n } = resolver;
        const len = n.length;
        if (n.length > 1) {
          for (let i = 0; len > i; ++i) {
            const compatFact = compat[n[i][0] as CompatKey];
            const list = compatFact(context, n[i].slice(1), snap)();
            const lambda = f[i];
            if (lambda) {
              lambda(list, callback, context, nodes);
            } else {
              nodes = nodes.concat(list);
            }
          }
          if (len > 1 && nodes.length > 1) {
            nodes = sortUnique(nodes);
          }
        } else {
          if (f[0]) {
            nodes = f[0](h[0](), callback, context, nodes);
          } else {
            nodes = h[0]();
          }
        }
        if (typeof callback == 'function') {
          nodes = concatCall(nodes, callback);
        }
        return nodes;
      }
    }

    // save/reuse factory and closure collection
    const parsed = parse(scoped.selectors, snap.re, snap.config);
    const r = collect(parsed, context, callback, snap);
    nodes = r.results;
    snap.selectResolvers[scoped.selectors] = r;
    if (typeof callback == 'function') {
      nodes = concatCall(nodes, callback);
    }
    return nodes;
  } finally {
    scoped.cleanup();
  }
}

// optimize selectors avoiding duplicated checks
function optimize(selector: string, token: RegExpMatchArray): string {
  const index = token.index;
  if (index === undefined) throw new Error('Invalid token: ' + token);

  const length = token[1].length + token[2].length;
  return selector.slice(0, index) +
    (' >+~'.indexOf(selector.charAt(index - 1)) > -1 ?
      (':['.indexOf(selector.charAt(index + length + 1)) > -1 ?
      '*' : '') : '') + selector.slice(index + length - (token[1] == '*' ? 1 : 0));
}

// prepare factory resolvers and closure collections
function collect(
  selectors: string[],
  context: QueryContext,
  cb: QueryCallback | null,
  snap: SnapshotState
): {
  callback: QueryCallback | null,
  context: QueryContext,
  factory: SelectLambda[],
  htmlset: CompatThunk[],
  nodeset: CompatSeed[],
  results: Element[]
} {
  const nodeset: CompatSeed[] = [];
  const htmlset: CompatThunk[] = [];
  const factory: SelectLambda[] = [];
  const optimized = selectors.slice();
  const seen: Record<string, boolean> = {};
  const token: [string, '.' | '#' | '*', string] = ['', '*', '*'];
  let results: Element[] = [];

  if (snap.isDebug) {
    snap.debugCollect = { callback: cb, context: describeQueryContext(context), steps: [] };
  }

  for (let i = 0, l = selectors.length; i < l; ++i) {
    const original = selectors[i];
    const seenBefore = seen[original];

    if (!seenBefore) {
      seen[original] = true;
      const type = original.match(snap.re.optimizer);
      if (type && type[1] != ':') {
        token[0] = type[0];
        const t1 = type[1] || '*';
        if (t1 !== '.' && t1 !== '#' && t1 !== '*') {
          throw new SyntaxError(`invalid selector for optimization '${original}'`);
        }
        token[1] = t1;
        token[2] = type[2];
        optimized[i] = optimize(original, type);
      } else {
        token[0] = '';
        token[1] = '*';
        token[2] = '*';
        optimized[i] = original;
      }
    }

    const rawTokenValue = token[2];
    nodeset[i] = `${token[1]}${rawTokenValue}`;

    const unescapedTokenValue = unescapeIdentifier(rawTokenValue, snap.re);
    htmlset[i] = compat[token[1]](context, unescapedTokenValue, snap);
    // htmlset[i] = compat[token[1]](context, rawTokenValue, snap);
    const factoryInput = htmlset[i]();

    if (snap.isDebug) snap.debugCompile = undefined;
    factory[i] = compile(optimized[i], true, null, snap) as SelectLambda;

    results = factory[i](factoryInput, cb, context, results);

    if (snap.isDebug) {
      snap.debugCollect!.steps.push({
        index: i,
        original,
        optimized: optimized[i],
        seenBefore,
        token: [token[0], token[1], token[2]],
        rawTokenValue,
        unescapedTokenValue,
        nodeset: nodeset[i],
        factoryInput: describeElements(factoryInput),
        factorySource: snap.debugCompile ?? String(factory[i]),
        factoryResults: describeElements(results),
      });
    }
  }

  if (selectors.length > 1) {
    results = sortUnique(results);
  }

  return {
    callback: cb,
    context: context,
    factory: factory,
    htmlset: htmlset,
    nodeset: nodeset,
    results: results
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
