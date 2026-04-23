const HSP = '[\\x20\\t]';
const VSP = '[\\r\\n\\f]';
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

const REX = {
  // regular expressions
  HasEscapes: RegExp('\\\\'),
  HexNumbers: RegExp('^[0-9a-fA-F]'),
  EscOrQuote: RegExp('^\\\\|[\\x22\\x27]'),
  RegExpChar: RegExp('(?!\\\\)[\\\\^$.,*+?()[\\]{}|\\/]', 'g'),
  TrimSpaces: RegExp('^' + WSP + '+|' + WSP + '+$|' + VSP, 'g'),
  SplitGroup: RegExp('(\\([^)]*\\)|\\[[^[]*\\]|\\\\.|[^,])+', 'g'),
  CommaGroup: RegExp('(\\s*,\\s*)' + NOT.square_enc + NOT.parens_enc, 'g'),
  FixEscapes: RegExp('\\\\([0-9a-fA-F]{1,6}' + WSP + '?|.)|([\\x22\\x27])', 'g'),
  CombineWSP: RegExp('[\\n\\r\\f\\x20]+' + NOT.single_enc + NOT.double_enc, 'g'),
  TabCharWSP: RegExp('(\\x20?\\t+\\x20?)' + NOT.single_enc + NOT.double_enc, 'g'),
  PseudosWSP: RegExp('\\s+([-+])\\s+' + NOT.square_enc, 'g')
};

const STD = {
  combinator: RegExp('\\s?([>+~])\\s?', 'g'),
  apimethods: RegExp('^(?:\\w+|\\*)\\|'),
  namespaces: RegExp('(\\*|\\w+)\\|[\\w-]+')
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

function Factory(factGlob: Glob, factExport: Function) {

  const version = 'nwsapi-__VERSION__';

  var
  _doc = factGlob.document,
  _root = _doc.documentElement,

  _CFG = {
    // extensions
    operators: '[~*^$|]=|=',
    combinators: '[\\x20\\t>+~](?=[^>+~])'
  },

  Patterns = {
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
    id: RegExp(''),
    tagName: RegExp(''),
    className: RegExp(''),
    attribute: RegExp(''),
  },

  // regexp to better aproximate detection of RTL languages (Arabic)
  RTL = RegExp('^(?:[\\u0627-\\u064a]|[\\u0591-\\u08ff]|[\\ufb1d-\\ufdfd]|[\\ufe70-\\ufefc])+$'),

  // emulate firefox error strings
  qsNotArgs = 'Not enough arguments',
  qsInvalid = ' is not a valid selector',

  // detect structural pseudo-classes in selectors
  reNthElem = RegExp('(:nth(?:-last)?-child)', 'i'),
  reNthType = RegExp('(:nth(?:-last)?-of-type)', 'i'),

  // placeholder for global regexp
  reOptimizer: RegExp,
  reValidator: RegExp,

  // special handling configuration flags
  _config: NwsConfig = {
    IDS_DUPES: true,
    FORGIVING: true,
    NODE_LIST: false,
    LOGERRORS: true,
    USR_EVENT: true,
    VERBOSITY: true
  },

  ATTR_STD_OPS = {
    '=': 1, '^=': 1, '$=': 1, '|=': 1, '*=': 1, '~=': 1
  },

  HTML_TABLE: Record<string, number> = {
    'accept': 1, 'accept-charset': 1, 'align': 1, 'alink': 1, 'axis': 1,
    'bgcolor': 1, 'charset': 1, 'checked': 1, 'clear': 1, 'codetype': 1, 'color': 1,
    'compact': 1, 'declare': 1, 'defer': 1, 'dir': 1, 'direction': 1, 'disabled': 1,
    'enctype': 1, 'face': 1, 'frame': 1, 'hreflang': 1, 'http-equiv': 1, 'lang': 1,
    'language': 1, 'link': 1, 'media': 1, 'method': 1, 'multiple': 1, 'nohref': 1,
    'noresize': 1, 'noshade': 1, 'nowrap': 1, 'readonly': 1, 'rel': 1, 'rev': 1,
    'rules': 1, 'scope': 1, 'scrolling': 1, 'selected': 1, 'shape': 1, 'target': 1,
    'text': 1, 'type': 1, 'valign': 1, 'valuetype': 1, 'vlink': 1
  },

  _combinators: Record<string, string> = { },

  _selectors: Record<string, SelectorExtension> = { },

  _operators: Record<string, AttrMatcherParts> = {
     '=': { p1: '^',       p2: '$',       p3: 'true' },
    '^=': { p1: '^',       p2: '',        p3: 'true' },
    '$=': { p1: '',        p2: '$',       p3: 'true' },
    '*=': { p1: '',        p2: '',        p3: 'true' },
    '|=': { p1: '^',       p2: '(-|$)',   p3: 'true' },
    '~=': { p1: '(^|\\s)', p2: '(\\s|$)', p3: 'true' }
  },

  method = {
    '#': 'getElementById',
    '*': 'getElementsByTagName',
    '|': 'getElementsByTagNameNS',
    '.': 'getElementsByClassName'
  }

  const compat: Record<CompatKey, CompatFactory> = {
    '#': (c, n, s) => () => byId(n, c, s),
    '*': (c, n, _s) => () => byTagRaw(n, c),
    '|': (c, n, _s) => () => byTagNSRaw(n, c),
    '.': (c, n, _s) => () => byClassRaw(n, c),
  }

  var

  // fast resolver for the :nth-of-type() and :nth-last-of-type() pseudo-classes
  nthOfType: NthFn = (function() {
    var idx = 0, len = 0, set = 0, parent: Element | null = null, parents = Array(), nodes = Array();
    return function(element: Element, dir: number) {
      // ensure caches are emptied after each run, invoking with dir = 2
      if (dir == 2) {
        idx = 0; len = 0; set = 0; nodes.length = 0;
        parents.length = 0; parent = null;
        return -1;
      }
      var e, i, j, k, l, name = element.localName;
      if (nodes[set] && nodes[set][name] && parent === element.parentElement) {
        i = set; j = idx; l = len;
      } else {
        l = parents.length;
        parent = element.parentElement;
        for (i = -1, j = 0, k = l - 1; l > j; ++j, --k) {
          if (parents[j] === parent) { i = j; break; }
          if (parents[k] === parent) { i = k; break; }
        }
        if (i < 0 || !nodes[i][name]) {
          parents[i = l] = parent;
          nodes[i] || (nodes[i] = Object());
          l = 0; nodes[i][name] = Array();
          e = parent && parent.firstElementChild || element;
          while (e) { if (e === element) j = l; if (e.localName == name) { nodes[i][name][l] = e; ++l; } e = e.nextElementSibling; }
          set = i; idx = j; len = l;
          if (l < 2) return l;
        } else {
          l = nodes[i][name].length;
          set = i;
        }
      }
      if (element !== nodes[i][name][j] && element !== nodes[i][name][j = 0]) {
        for (j = 0, e = nodes[i][name], k = l - 1; l > j; ++j, --k) {
          if (e[j] === element) { break; }
          if (e[k] === element) { j = k; break; }
        }
      }
      idx = j + 1; len = l;
      return dir ? l - j : idx;
    };
  })(),

  // return node if node is focusable
  // or false if node isn't focusable
  isFocusable: IsFocusableFn =
    function(node: HTMLElement): HTMLElement | false {
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
    },

  // check if node content is editable
  isContentEditable: IsContentEditableFn =
    function(el: HTMLElement): boolean {
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
    },

  // // check media resources is playing
  // isPlaying =
  //   function(media) {
  //     // for <audio>, <video>, <source> and <track> elements
  //     var parent = media instanceof HTMLMediaElement ? null : media.parentElement;
  //     return (
  //       !!( media &&  media.currentTime > 0 &&  !media.paused &&  !media.ended &&  media.readyState > 2) ||
  //       !!(parent && parent.currentTime > 0 && !parent.paused && !parent.ended && parent.readyState > 2));
  //   },

  // configure the engine to use special handling
  configure =
    function(option?: ConfigKey | Partial<Record<ConfigKey, boolean>>, clear = false) {
      if (typeof option == 'string') { return !!_config[option]; }
      if (typeof option != 'object') { return _config; }

      for (let i in option) {
        _config[i as ConfigKey] = !!option[i as ConfigKey];
      }
      // clear lambda cache
      if (clear) {
        _matchResolvers = { };
        _selectResolvers = { };
      }
      setIdentifierSyntax();
      return true;
    },

  // centralized error and exceptions handling
  emit =
    function(message: string, proto?: typeof Error) {
      var err;
      if (_config.VERBOSITY) {
        if (proto) {
          err = new proto(message);
        } else {
          err = new factGlob.DOMException(message, 'SyntaxError');
        }
        throw err;
      }
      if (_config.LOGERRORS && console && console.log) {
        console.log(message);
      }
    },

  // execute the engine initialization code
  initialize =
    function(docArg: Document) {
      setIdentifierSyntax();
      // doc = docArg;
      _lastContext = updateSnapshot(_snapshot, docArg, true).from;
    },

  // build validation regexps used by the engine
  setIdentifierSyntax =
    function() {

      //
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
      //

      var

      // non-ascii chars
      noascii = '[^\\x00-\\x9f]',
      // escaped chars
      escaped = '\\\\[^\\r\\n\\f0-9a-fA-F]',
      // unicode chars
      unicode = '\\\\[0-9a-fA-F]{1,6}(?:\\r\\n|\\s)?',

      // can start with single/double dash
      // but it can not start with a digit
      identifier = '-?(?:[a-zA-Z_-]|' + noascii + '|' + escaped + '|' + unicode + ')' +
          '(?:-{2}|[0-9]|[a-zA-Z_-]|' + noascii + '|' + escaped + '|' + unicode + ')*',

      pseudonames = '[-\\w]+',
      pseudoparms = '(?:[-+]?\\d*)(?:n\\s?[-+]?\\s?\\d*)',
      doublequote = '"[^"\\\\]*(?:\\\\.[^"\\\\]*)*(?:"|$)',
      singlequote = "'[^'\\\\]*(?:\\\\.[^'\\\\]*)*(?:'|$)",

      attrparser = identifier + '|' + doublequote + '|' + singlequote,

      attrvalues = '([\\x22\\x27]?)((?!\\3)*|(?:\\\\?.)*?)(?:\\3|$)',

      attributes =
        '\\[' +
          // attribute presence
          '(?:\\*\\|)?' +
          WSP + '?' +
          '(' + identifier + '(?::' + identifier + ')?)' +
          WSP + '?' +
          '(?:' +
            '(' + _CFG.operators + ')' + WSP + '?' +
            '(?:' + attrparser + ')' +
          ')?' +
          // attribute case sensitivity
          '(?:' + WSP + '?\\b(i))?' + WSP + '?' +
        '(?:\\]|$)',

      attrmatcher = attributes.replace(attrparser, attrvalues),

      pseudoclass =
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
        ')*',

      standardValidator =
        '(?=' + WSP + '?[^>+~(){}<>])' +
        '(?:' +
          // universal * &
          // namespace *|*
          '(?:\\*|\\*\\|)|' +
          '(?:[.#]?' + identifier + ')+|' +
          '(?:' + attributes + ')+|' +
          '(?:::?' + pseudonames + pseudoclass + ')|' +
          '(?:' + WSP + '?' + _CFG.combinators + WSP + '?)|' +
          '(?:' + WSP + '?,' + WSP + '?)|' +
          '(?:' + WSP + '?)' +
        ')+';

      // the following global RE is used to return the
      // deepest localName in selector strings and then
      // use it to retrieve all possible matching nodes
      // that will be filtered by compiled resolvers
      reOptimizer = RegExp(
        '(?:([.:#*]?)' +
        '(' + identifier + ')' +
        '(?:' +
          ':[-\\w]+|' +
          '\\[[^\\]]+(?:\\]|$)|' +
          '\\x28[^\\x29]+(?:\\x29|$)' +
        ')*)$');

      // global
      reValidator = RegExp(standardValidator, 'g');

      Patterns.id = RegExp('^#(' + identifier + ')(.*)');
      Patterns.tagName = RegExp('^(' + identifier + ')(.*)');
      Patterns.className = RegExp('^\\.(' + identifier + ')(.*)');
      Patterns.attribute = RegExp('^(?:' + attrmatcher + ')(.*)');
    },

  F_INIT = '"use strict";return function Resolver(c,f,x,r)',

  /*
  // S - M - N
  //
  // SELECT
  // MATCH
  // NONE
  //
  */

  S_HEAD = 'var e,n,o,j=r.length-1,k=-1',
  M_HEAD = 'var e,n,o',
  N_HEAD = 'var e,n,o',

  S_LOOP = 'main:while((e=c[++k]))',
  M_LOOP = 'e=c;',
  N_LOOP = 'main:while((e=c.item(++k)))',

  S_BODY = 'r[++j]=c[k];',
  M_BODY = '',
  N_BODY = 'r[++j]=c.item(k);',

  S_TAIL = 'continue main;',
  M_TAIL = 'r=true;',
  N_TAIL = 'r=true;',

  S_TEST = 'if(f(c[k])){break main;}',
  M_TEST = 'f(c);',
  N_TEST = 'if(f(c.item(k))){break main;}',

  S_VARS: string[] = [ ],
  M_VARS: string[] = [ ],
  N_VARS: string[] = [ ],

  // compile groups or single selector strings into
  // executable functions for matching or selecting
  compile: CompileFn =
    function(selector: string, mode: boolean | null, cb: QueryCallback | null, snap: SnapshotState): SelectLambda | MatchLambda {

      // 'mode' can be boolean or null
      // true = select / false = match
      // null to use collection.item()
      let [macro, head, loop] = ['', '', ''];
      switch (mode) {
        case true:
          if (_selectLambdas[selector]) { return _selectLambdas[selector]; }
          macro = S_BODY + (!!cb ? S_TEST : '') + S_TAIL;
          head = S_HEAD;
          loop = S_LOOP;
          break;
        case false:
          if (_matchLambdas[selector]) { return _matchLambdas[selector]; }
          macro = M_BODY + (!!cb ? M_TEST : '') + M_TAIL;
          head = M_HEAD;
          loop = M_LOOP;
          break;
        case null:
          if (_selectLambdas[selector]) { return _selectLambdas[selector]; }
          macro = N_BODY + (!!cb ? N_TEST : '') + N_TAIL;
          head = N_HEAD;
          loop = N_LOOP;
          break;
        default: assertNever(mode);
      }

      const source = compileSelector(selector, macro, mode, cb, snap);

      loop += mode || mode === null ? '{' + source + '}' : source;

      if (mode || mode === null && selector.includes(':nth')) {
        loop += reNthElem.test(selector) ? 's.nthElement(null, 2);' : '';
        loop += reNthType.test(selector) ? 's.nthOfType(null, 2);' : '';
      }

      let vars = '';
      if (S_VARS[0] || M_VARS[0] || N_VARS[0]) {
        vars = ',' + (S_VARS.join(',') || M_VARS.join(',') || N_VARS[0]);
        S_VARS.length = 0;
        M_VARS.length = 0;
        N_VARS.length = 0;
      }

      const f = F_INIT + '{' + head + vars + ';' + loop + 'return r;}';
      if (snap.isDebug) snap.debugCompile = f;
      const factory = Function('s', f)(snap);

      return mode || mode === null ? (_selectLambdas[selector] = factory) : (_matchLambdas[selector] = factory);
    },

  // build conditional code to check components of selector strings
  compileSelector =
    function(expression: string, source: string, mode: boolean | null, cb: QueryCallback | null, snap: SnapshotState) {

      var a, b, n, f, k = 0, name, NS, referenceElement,
      compat, expr, result, status, symbol,
      type, vars;

      let selector: string | undefined = expression;

      // isolate selector combinators
      selector = selector.replace(STD.combinator, '$1');

      // javascript needs a label to break
      // out of the while loops processing
      selector_recursion_label:

      while (selector) {

        ++k;

        // get namespace prefix if present or get first char of selector
        symbol = STD.apimethods.test(selector) ? '|' : selector[0];

        let test: AttrMatcherParts | undefined;
        // let match: RegExpMatchArray | null = null;
        let match: string[] | null = null;
        switch (symbol) {

          // universal resolver
          case '*':
            match = selector.match(Patterns.universal);
            if (!match) throw new Error('Invalid universal selector: ' + selector);
            break;

          // id resolver
          case '#':
            match = selector.match(Patterns.id);
            if (!match) throw new Error('Invalid ID selector: ' + selector);
            source = 'if((/^' + match[1] + '$/.test(e.getAttribute("id")))){' + source + '}';
            break;

          // class name resolver
          case '.':
            match = selector.match(Patterns.className);
            if (!match) throw new Error('Invalid class selector: ' + selector);

            compat = (snap.isQuirksMode ? 'i' : '') + '.test(e.getAttribute("class"))';
            source = 'if((/(^|\\s)' + match[1] + '(\\s|$)/' + compat + ')){' + source + '}';
            break;

          // tag name resolver
          case (/[_a-z]/i.test(symbol) ? symbol : undefined):
            match = selector.match(Patterns.tagName);
            if (!match) throw new Error('Invalid tag selector: ' + selector);

            source = 'if((e.localName=="' + match[1] + '")){' + source + '}';
            break;

          // namespace resolver
          case '|':
            match = selector.match(Patterns.namespace);
            if (!match) throw new Error('Invalid namespace selector: ' + selector);

            if (match[1] == '*') {
              source = 'if(true){' + source + '}';
            } else if (!match[1]) {
              source = 'if((!e.namespaceURI)){' + source + '}';
            } else if (typeof match[1] == 'string' && _root.prefix == match[1]) {
              source = 'if((e.namespaceURI=="' + snap.namespace + '")){' + source + '}';
            } else {
              emit('\'' + expression + '\'' + qsInvalid);
            }
            break;

          // attributes resolver
          case '[':
            match = selector.match(Patterns.attribute);
            if (!match) throw new Error('Invalid attribute selector: ' + selector);

            NS = match[0].match(STD.namespaces);
            name = match[1];
            expr = name.split(':');
            expr = expr.length == 2 ? expr[1] : expr[0];
            if (match[2] && !(test = _operators[match[2]])) {
              emit('\'' + expression + '\'' + qsInvalid);
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
              match[4] = decodeCssEscapes(match[4]).replace(REX.RegExpChar, '\\$&');
            }
            type = match[5] == 'i' || (snap.isHtml && HTML_TABLE[expr.toLowerCase()]) ? 'i' : '';
            let attrExpr: string;
            if (!match[2]) {
              attrExpr = NS
                ? 's.hasAttributeNS(e,"' + name + '")'
                : 'e.hasAttribute&&e.hasAttribute("' + name + '")';
            } else if (!match[4] && match[2] in ATTR_STD_OPS && match[2] != '~=') {
              attrExpr = 'e.getAttribute&&e.getAttribute("' + name + '")==""';
            } else {
              if (!test) throw new Error(`test wasn't defined for attribute selector: ${selector}`);
              attrExpr =
                '(/' + test.p1 + match[4] + test.p2 + '/' + type + ').test(e.getAttribute&&e.getAttribute("' + name + '"))==' + test.p3;
            }
            source = 'if((' + attrExpr + ')){' + source + '}';
            break;

          // *** General sibling combinator
          // E ~ F (F relative sibling of E)
          case '~':
            match = selector.match(Patterns.relative);
            source = 'var N' + k + '=e;while(e&&(e=e.previousElementSibling)){' + source + '}e=N' + k + ';';
            break;

          // *** Adjacent sibling combinator
          // E + F (F adiacent sibling of E)
          case '+':
            match = selector.match(Patterns.adjacent);
            source = 'var N' + k + '=e;if(e&&(e=e.previousElementSibling)){' + source + '}e=N' + k + ';';
            break;

          // *** Descendant combinator
          // E F (E ancestor of F)
          case '\x09':
          case '\x20':
            match = selector.match(Patterns.ancestor);
            source = 'var N' + k + '=e;while(e&&(e=e.parentElement)){' + source + '}e=N' + k + ';';
            break;

          // *** Child combinator
          // E > F (F children of E)
          case '>':
            match = selector.match(Patterns.children);
            source = 'var N' + k + '=e;if(e&&(e=e.parentElement)){' + source + '}e=N' + k + ';';
            break;

          // *** user supplied combinators extensions
          case (symbol in _combinators ? symbol : undefined):
            // for other registered combinators extensions
            throw new Error('FIXME: custom combinators are not supported yet'); // TODO: implement custom combinators
            // match[match.length - 1] = '*';
            // source = Combinators[symbol](match) + source;
            // break;

          // *** tree-structural pseudo-classes
          // :root, :empty, :first-child, :last-child, :only-child, :first-of-type, :last-of-type, :only-of-type
          case ':':
            if ((match = selector.match(Patterns.structural))) {
              match[1] = match[1].toLowerCase();
              switch (match[1]) {
                case 'scope':
                  // use the root (documentElement) when comparing against a document
                  source = 'if(e===(s.from.nodeType===9?s.root:s.from)){' + source + '}';
                  break;
                case 'root':
                  // there can only be one :root element, so exit the loop once found
                  source = 'if((e===s.root)){' + source + (mode ? 'break main;' : '') + '}';
                  // throw new Error(source);
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
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // *** child-indexed & typed child-indexed pseudo-classes
            // :nth-child, :nth-of-type, :nth-last-child, :nth-last-of-type
            else if ((match = selector.match(Patterns.treestruct))) {
              match[1] = match[1].toLowerCase();
              switch (match[1]) {
                case 'nth-child':
                case 'nth-of-type':
                case 'nth-last-child':
                case 'nth-last-of-type':
                  expr = /-of-type/i.test(match[1]);
                  let test: string;
                  if (match[1] && match[2]) {
                    type = /last/i.test(match[1]);
                    if (match[2] == 'n') {
                      source = 'if(true){' + source + '}';
                      break;
                    } else if (match[2] == '1') {
                      test = type ? 'next' : 'previous';
                      source = expr ? 'n=e;o=e.localName;' +
                        'while((n=n.' + test + 'ElementSibling)&&n.localName!=o);if(!n){' + source + '}' :
                        'if(!e.' + test + 'ElementSibling){' + source + '}';
                      break;
                    } else if (match[2] == 'even' || match[2] == '2n0' || match[2] == '2n+0' || match[2] == '2n') {
                      test = 'n%2==0';
                    } else if (match[2] == 'odd'  || match[2] == '2n1' || match[2] == '2n+1') {
                      test = 'n%2==1';
                    } else {
                      f = /n/i.test(match[2]);
                      n = match[2].split('n');
                      a = parseInt(n[0], 10) || 0;
                      b = parseInt(n[1], 10) || 0;
                      if (n[0] == '-') { a = -1; }
                      if (n[0] == '+') { a = +1; }
                      test = (b ? '(n' + (b > 0 ? '-' : '+') + Math.abs(b) + ')' : 'n') + '%' + a + '==0' ;
                      test =
                        a >= +1 ? (f ? 'n>' + (b - 1) + (Math.abs(a) != 1 ? '&&' + test : '') : 'n==' + a) :
                        a <= -1 ? (f ? 'n<' + (b + 1) + (Math.abs(a) != 1 ? '&&' + test : '') : 'n==' + a) :
                        a === 0 ? (n[0] ? 'n==' + b : 'n>' + (b - 1)) : 'false';
                    }
                    expr = expr ? 'OfType' : 'Element';
                    type = type ? 'true' : 'false';
                    source = 'n=s.nth' + expr + '(e,' + type + ');if((' + test + ')){' + source + '}';
                  } else {
                    emit('\'' + expression + '\'' + qsInvalid);
                  }
                  break;
                default:
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // *** logical combination pseudo-classes
            // :is( s1, [ s2, ... ]), :not( s1, [ s2, ... ]),
            // :has( s1, [ s2, ... ]) no nesting is allowed for
            // :where( s1, [ s2, ... ]), :matches( s1, [ s2, ... ]),
            else if ((match = selector.match(Patterns.logicalsel))) {
              match[1] = match[1].toLowerCase();
              expr = match[2]
                .replace(REX.CommaGroup, ',')
                .replace(REX.TrimSpaces, '')
                .replace(/\x22/g, '\\"');
              switch (match[1]) {
                case 'is':
                case 'where':
                  if (_config.FORGIVING) {
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
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // *** linguistic pseudo-classes
            // :dir( ltr / rtl ), :lang( en )
            else if ((match = selector.match(Patterns.linguistic))) {
              match[1] = match[1].toLowerCase();
              switch (match[1]) {
                case 'dir':
                  source = 'var p;if((' +
                    '(/' + match[2] + '/i.test(e.dir))||(p=s.ancestor("[dir]", e))&&' +
                    '(/' + match[2] + '/i.test(p.dir))||(e.dir==""||e.dir=="auto")&&' +
                    '(' + (match[2] == 'ltr' ? '!':'')+ RTL +'.test(e.textContent)))' +
                    '){' + source + '};';
                  break;
                case 'lang':
                  expr = '(?:^|-)' + match[2] + '(?:-|$)';
                  source = 'var p;if((' +
                    '(e.isConnected&&(e.lang==""&&(p=s.ancestor("[lang]",e)))&&' +
                    '(p.lang=="' + match[2] + '")||/'+ expr +'/i.test(e.lang)))' +
                    '){' + source + '};';
                  break;
                default:
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // *** location pseudo-classes
            // :any-link, :link, :visited, :target, :defined
            else if ((match = selector.match(Patterns.locationpc))) {
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
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // *** user actions pseudo-classes
            // :hover, :active, :focus, :focus-visible, :focus-within
            else if ((match = selector.match(Patterns.useraction))) {
              match[1] = match[1].toLowerCase();
              switch (match[1]) {
                case 'hover':
                  source = 'if(e===s.HOVER){' + source + '}';
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
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // *** user interface and form pseudo-classes
            // :enabled, :disabled, :read-only, :read-write, :placeholder-shown, :default
            else if ((match = selector.match(Patterns.inputstate))) {
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
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // *** input pseudo-classes (for form validation)
            // :checked, :indeterminate, :valid, :invalid, :in-range, :out-of-range, :required, :optional
            else if ((match = selector.match(Patterns.inputvalue))) {
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
                  emit('\'' + expression + '\'' + qsInvalid);
                  break;
              }
            }

            // resources state pseudo-classes (multimedia state)
            // :playing, :paused, :seeking, :buffering, :stalled, :muted, :volume-locked
            else if ((match = selector.match(Patterns.rsrc_state))) {
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
            else if ((match = selector.match(Patterns.pseudo_nop))) {
              break;
            }

            // allow pseudo-elements starting with single colon (:)
            // :after, :before, :first-letter, :first-line
            // assert: e.type is in double-colon format, like ::after
            else if ((match = selector.match(Patterns.pseudo_sng))) {
              source = 'if(e.element&&e.type.toLowerCase()=="' +
                ':' + match[0].toLowerCase() + '"){e=e.element;' + source + '}';
            }

            // allow pseudo-elements starting with double colon (::)
            // ::after, ::before, ::marker, ::placeholder, ::inactive-selection, ::selection, ::-webkit-<foo-bar>
            // assert: e.type is in double-colon format, like ::after
            else if ((match = selector.match(Patterns.pseudo_dbl))) {
              source = 'if(e.element&&e.type.toLowerCase()=="' +
                match[0].toLowerCase() + '"){e=e.element;' + source + '}';
            }

            else {

              // reset
              expr = false;
              status = false;

              // process registered selector extensions
              for (expr in _selectors) {
                if ((match = selector.match(_selectors[expr].Expression))) {
                  result = _selectors[expr].Callback(match, source, mode, cb);
                  if ('match' in result) { match = result.match; }
                  vars = result.modvar;
                  if (mode) {
                     // add extra select() vars
                     vars && S_VARS.indexOf(vars) < 0 && (S_VARS[S_VARS.length] = vars);
                  } else {
                     // add extra match() vars
                     vars && M_VARS.indexOf(vars) < 0 && (M_VARS[M_VARS.length] = vars);
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
                if (_config.FORGIVING &&
                  selector.match(/(:(?:is|where)\x28)/)) {
                  return '';
                }
                emit('unknown pseudo-class selector \'' + selector + '\'');
                return '';
              }

              if (!expr) {
                if (_config.FORGIVING &&
                  selector.match(/(:(?:is|where)\x28)/)) {
                  return '';
                }
                emit('unknown token in selector \'' + selector + '\'');
                return '';
              }

            }
            break;

        default:
          emit('\'' + expression + '\'' + qsInvalid);
          break selector_recursion_label;

        }
        // end of switch symbol

        if (!match) {
          if (_config.FORGIVING &&
            selector.match(/(:(?:is|where)\x28)/)) {
            return '';
          }
          emit('\'' + expression + '\'' + qsInvalid);
          return '';
        }

        // pop last component
        selector = match.pop();
      }
      // end of while selector

      return source;
    },

  isDocument =
    function(element: QueryContext): element is Document {
      return element.nodeType === 9;
    },
  isDocumentFragment =
    function(element: QueryContext): element is DocumentFragment {
      return element.nodeType === 11;
    },


  // TODO: `makeref()` is a non-unique `:scope` rewrite and cannot represent 
  // `DocumentFragment`; needs resolver-based handling.

  // replace :scope context element as a
  // a reference in the selector string
  makeref =
    function(selectors: string, element: QueryContext) {
      // replace DOCUMENT with first element (root)
      if (isDocument(element)) {
          element = element.documentElement;
      }
      if (isDocumentFragment(element)) {
        throw new Error(':scope replacement for DocumentFragment is not supported');
      }

      return selectors.replace(/:scope/i,
        (element.localName) +
        (element.id ? '#' + cssEscape(element.id, factGlob) : '') +
        (element.className ? '.' + cssEscape(element.classList[0], factGlob) : ''));
    },

  // equivalent of w3c 'closest' method
  ancestorRaw: RawAncestorFn =
    function _closest(selectors: string, element: Element, callback: QueryCallback | null = null, snap: SnapshotState) {
      parse(selectors);
      selectors = makeref(selectors, element);
      let el: Element | null = element;
      while (el) {
        if (matchRaw(selectors, el, callback, snap)) break;
        el = el.parentElement;
      }
      return el;
    },

  match_assert =
    function(f: MatchLambda[], element: Element, callback: QueryCallback | null) {
      for (var i = 0, l = f.length, r = false; l > i; ++i)
        f[i](element, callback, null, false) && (r = true);
      return r;
    },

  match_collect =
    function(selectors: string[], cb: QueryCallback | null) {
      for (var i = 0, l = selectors.length, f = [ ]; l > i; ++i)
        f[i] = compile(selectors[i], false, cb, _snapshot) as MatchLambda; // FIXME: type assertion to MatchLambda[] is not safe, but compile() can return either MatchLambda or SelectLambda
      return { factory: f };
    },

  // unique parser entry point for all
  // methods (type matching/selecting)
  parse =
    function(selectors: string): string[] {

      // arguments validation
      if (arguments.length === 0) {
        emit(qsNotArgs, TypeError);
        if (_config.VERBOSITY) throw new TypeError(qsNotArgs);
        return [];
      } else if (arguments[0] === '') {
        emit('\'\'' + qsInvalid);
        if (_config.VERBOSITY) throw new SyntaxError('\'' + qsInvalid);
        return [];
      }

      // input NULL or UNDEFINED
      if (typeof selectors != 'string') {
        selectors = '' + selectors;
      }

      if ((/:scope/i).test(selectors)) {
        selectors = makeref(selectors, _snapshot.from);
      }

      // normalize input string
      const parsed = selectors.
        replace(/\x00|\\$/g, '\ufffd').
        replace(REX.CombineWSP, '\x20').
        replace(REX.PseudosWSP, '$1').
        replace(REX.TabCharWSP, '\t').
        replace(REX.CommaGroup, ',').
        replace(REX.TrimSpaces, '');

      // parse, validate and split possible compound selectors
      const validated = parsed.match(reValidator);
      if (validated?.join('') == parsed) {
        if (parsed[parsed.length - 1] == ',') {
          emit(qsInvalid);
          if (_config.VERBOSITY) throw new SyntaxError(qsInvalid);
          return [];
        }
        return parsed.match(REX.SplitGroup) ?? [];
      } else {
        if (_config.FORGIVING) {
          // forgiving pseudos allow to continue even after parse errors
          if (!(parsed.includes(':is(') || parsed.includes(':where('))) {
            emit('\'' + selectors + '\'' + qsInvalid);
            if (_config.VERBOSITY) throw new SyntaxError('\'' + selectors + '\'' + qsInvalid);
            return [];
          }
        }
        return [];
      }
    },

  // equivalent of w3c 'matches' method
  matchRaw: RawMatchFn =
    function _matches(selectors: string, element: Element, callback: QueryCallback | null = null, snap: SnapshotState) {

      if (element && _matchResolvers[selectors]) {
        return match_assert(_matchResolvers[selectors].factory, element, callback);
      }

      _matchResolvers[selectors] = match_collect(parse(selectors), callback);

      return match_assert(_matchResolvers[selectors].factory, element, callback);
    },

  // equivalent of w3c 'querySelector' method
  firstRaw: RawFirstFn =
    function _querySelector(selectors: string, context: QueryContext, callback: QueryCallback | null = null, snap: SnapshotState) {
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
    },

  // equivalent of w3c 'querySelectorAll' method
  selectRaw: RawSelectFn =
    function _querySelectorAll(selectors: string, context: QueryContext, callback: QueryCallback | null, snap: SnapshotState) {
      let nodes: Element[] = [];
      let resolver;

      if (_lastContext !== context) {
        updateSnapshot(snap, context);
        _lastContext = context;
      }

      if (selectors) {
        if ((resolver = _selectResolvers[selectors])) {
          if (resolver.context === context &&
            resolver.callback === callback) {
            let list: Element[];
            const f = resolver.factory;
            const h = resolver.htmlset;
            const n = resolver.nodeset;
            let len = n.length;
            if (n.length > 1) {
              for (let i = 0; len > i; ++i) {
                const compatFact = compat[n[i][0] as CompatKey];
                list = compatFact(context, n[i].slice(1), snap)();
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
      }

      // save/reuse factory and closure collection
      const r = collect(parse(selectors), context, callback, snap);
      nodes = r.results;
      _selectResolvers[selectors] = r;

      if (typeof callback == 'function') {
        nodes = concatCall(nodes, callback);
      }
      return nodes;
    },

  // optimize selectors avoiding duplicated checks
  optimize =
    function(selector: string, token: RegExpMatchArray) {
      const index = token.index;
      if (index === undefined) throw new Error('Invalid token: ' + token);

      const length = token[1].length + token[2].length;
      return selector.slice(0, index) +
        (' >+~'.indexOf(selector.charAt(index - 1)) > -1 ?
          (':['.indexOf(selector.charAt(index + length + 1)) > -1 ?
          '*' : '') : '') + selector.slice(index + length - (token[1] == '*' ? 1 : 0));
    },

  // prepare factory resolvers and closure collections
  collect =
    function(selectors: string[], context: QueryContext, cb: QueryCallback | null, snap: SnapshotState) {
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
          const type = original.match(reOptimizer);
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

        const unescapedTokenValue = unescapeIdentifier(rawTokenValue);
        htmlset[i] = compat[token[1]](context, unescapedTokenValue, snap);
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
    },

  // handlers needed for the :hover pseudo-class
  // track state change in browsers and headless
  initEnv =
    (function() {
      _doc.addEventListener('mouseover', function(e) { _snapshot.HOVER = e.target; }, true);
      _doc.addEventListener('mouseout', function(e) { _snapshot.HOVER = null; }, true);
    })(),

  // QSA placeholders to native references
  _closest: any,
  _matches: any,
  _querySelector: any,
  _querySelectorAll: any,
  _querySelectorDoc: any,
  _querySelectorAllDoc: any,

  // overrides QSA methods (only for browsers)
  install =
    function(all?: boolean) {
      // save references
      _closest = Element.prototype.closest;
      _matches = Element.prototype.matches;

      _querySelector = Element.prototype.querySelector;
      _querySelectorAll = Element.prototype.querySelectorAll;

      _querySelectorDoc = Document.prototype.querySelector;
      _querySelectorAllDoc = Document.prototype.querySelectorAll;

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
        _doc.addEventListener('load', function (e) {
          const evTarget = e.target;
          if (!isIFrame(evTarget)) return;

          const iife = '(' + factExport + ')(this, ' + Factory + ');';
          const doc = evTarget.ownerDocument;
          const script = doc.createElement('script');
          script.textContent = iife + 'NW.Dom.install(true)';
          const root = doc.documentElement;
          root.removeChild(root.insertBefore(script, root.firstChild));
        }, true);
      }

    },

  isIFrame = function(x: unknown): x is HTMLIFrameElement {
    // TODO: rework iframe target check; avoid realm-specific instanceof narrowing.
    return typeof HTMLIFrameElement !== 'undefined' && x instanceof HTMLIFrameElement;
  },

  // restore QSA methods (only for browsers)
  uninstall =
    function() {
      // restore references
      if (_closest) {
        Element.prototype.closest = _closest;
        HTMLElement.prototype.closest = _closest;
      }
      if (_matches) {
        Element.prototype.matches = _matches;
        HTMLElement.prototype.matches = _matches;
      }
      if (_querySelector) {
        Element.prototype.querySelector =
        HTMLElement.prototype.querySelector = _querySelector;
        Element.prototype.querySelectorAll =
        HTMLElement.prototype.querySelectorAll = _querySelectorAll;
      }
      if (_querySelectorAllDoc) {
        Document.prototype.querySelector =
        DocumentFragment.prototype.querySelector = _querySelectorDoc;
        Document.prototype.querySelectorAll =
        DocumentFragment.prototype.querySelectorAll = _querySelectorAllDoc;
      }
    },

  // context
  _lastContext: QueryContext,

  // cached lambdas
  _matchLambdas: Record<string, MatchLambda> = { },
  _selectLambdas: Record<string, SelectLambda> = { },

  // cached resolvers
  _matchResolvers: Record<string, MatchResolver> = { },
  _selectResolvers: Record<string, SelectResolver> = { },

  // passed to resolvers
  _snapshot: SnapshotState = {
    doc: _doc,
    from: _doc,
    root: _root,
    isHtml: isHTML(_doc),
    isQuirksMode: isQuirksMode(_doc),
    namespace: getNamespace(_doc),
    config: _config,

    byTag: (tag: string, context?: QueryContext) => byTagRaw(tag, context ?? _snapshot.doc),
    first: (sel: string, context?: QueryContext, cb?: QueryCallback | null) => firstRaw(sel, context ?? _snapshot.doc, cb ?? null, _snapshot),
    match: (sel: string, context: Element, cb?: QueryCallback | null) => matchRaw(sel, context, cb ?? null, _snapshot),
    select: (sel: string, context?: QueryContext, cb?: QueryCallback | null) => selectRaw(sel, context ?? _snapshot.doc, cb ?? null, _snapshot),
    ancestor: (sel: string, context: Element, cb?: QueryCallback | null) => ancestorRaw(sel, context, cb ?? null, _snapshot),

    nthOfType: nthOfType,
    nthElement: nthElement,

    isFocusable: isFocusable,
    isContentEditable: isContentEditable,
    hasAttributeNS: (e: Element, name: string) => hasAttributeNS(e, name, _snapshot.isHtml),

    HOVER: null,

    isDebug: false,
  },

  // public exported methods/objects
  Dom: DomApi = {

    // exported cache objects

    matchLambdas: _matchLambdas,
    selectLambdas: _selectLambdas,

    matchResolvers: _matchResolvers,
    selectResolvers: _selectResolvers,

    // exported compiler macros

    CFG: _CFG,

    S_BODY: S_BODY,
    M_BODY: M_BODY,
    N_BODY: N_BODY,

    S_TEST: S_TEST,
    M_TEST: M_TEST,
    N_TEST: N_TEST,

    // exported engine methods
    byId: (id, ctx) => {
      ctx ??= _snapshot.doc;
      return _config.NODE_LIST ? toNodeList(byId(id, ctx, _snapshot), _snapshot.doc) : byId(id, ctx, _snapshot);
    },

    byTag: (tag, ctx) => {
      ctx ??= _snapshot.doc;
      return _config.NODE_LIST ? toNodeList(byTagRaw(tag, ctx), _snapshot.doc) : byTagRaw(tag, ctx);
    },

    byClass: (cls, ctx) => {
      ctx ??= _snapshot.doc;
      return _config.NODE_LIST ? toNodeList(byClassRaw(cls, ctx), _snapshot.doc) : byClassRaw(cls, ctx);
    },

    first: (sel, ctx, cb) => {
      ctx ??= _snapshot.doc;
      return firstRaw(sel, ctx, cb ?? null, _snapshot);
    },

    match: (sel, ctx, cb) => {
      return matchRaw(sel, ctx, cb ?? null, _snapshot);
    },

    select: (sel, ctx, cb) => {
      ctx ??= _snapshot.doc;
      return _config.NODE_LIST ? toNodeList(selectRaw(sel, ctx, cb ?? null, _snapshot), _snapshot.doc) : selectRaw(sel, ctx, cb ?? null, _snapshot);
    },

    closest: (sel, ctx, cb) => {
      return ancestorRaw(sel, ctx, cb ?? null, _snapshot);
    },

    compile: compile,
    configure: configure,

    emit: emit,
    Config: _config,
    Snapshot: _snapshot,

    Version: version,

    install: install,
    uninstall: uninstall,

    Operators: _operators,
    Selectors: _selectors,

    // register a new selector combinator symbol and its related function resolver
    registerCombinator:
      function(combinator: string, resolver: string) {
        const l = combinator.length;
        let symbol;
        for (let i = 0; l > i; ++i) {
          if (combinator[i] != '=') {
            symbol = combinator[i];
            break;
          }
        }
        if (!symbol) throw new Error('Invalid combinator: ' + combinator);
        if (_CFG.combinators.indexOf(symbol) < 0) {
          _CFG.combinators = _CFG.combinators.replace('](', symbol + '](');
          _CFG.combinators = _CFG.combinators.replace('])', symbol + '])');
          _combinators[combinator] = resolver;
          setIdentifierSyntax();
        } else {
          console.warn('Warning: the \'' + combinator + '\' combinator is already registered.');
        }
      },

    // register a new attribute operator symbol and its related function resolver
    // NW.Dom.registerOperator( '!=', { p1: '^', p2: '$', p3: 'false' } );
    registerOperator:
      function(operator: string, resolver: AttrMatcherParts) {
        const l = operator.length;
        let symbol;
        for (let i = 0; l > i; ++i) {
          if (operator[i] != '=') {
            symbol = operator[i];
            break;
          }
        }
        if (!symbol) throw new Error('Invalid operator: ' + operator);
        if (_CFG.operators.indexOf(symbol) < 0 && !_operators[operator]) {
          _CFG.operators = _CFG.operators.replace(']=', symbol + ']=');
          _operators[operator] = resolver;
          setIdentifierSyntax();
        } else {
          console.warn('Warning: the \'' + operator + '\' operator is already registered.');
        }
      },

    // register a new selector symbol and its related function resolver
    registerSelector:
      function(name: string, rexp: RegExp, func: SelectorExtFn) {
        _selectors[name] || (_selectors[name] = {
          Expression: rexp,
          Callback: func
        });
      },

    setDebug(enabled: boolean) {
      _snapshot.isDebug = enabled;
      if (enabled) Dom.clearDebug();
    },

    clearDebug() {
      _snapshot.debugCompile = undefined;
      _snapshot.debugCollect = undefined;
    },

    printDebug() {
      const docDesc = describeQueryContext(_snapshot.doc);
      const fromDesc = describeQueryContext(_snapshot.from);
      return JSON.stringify({
        snapshot: {
          isHtml: _snapshot.isHtml,
          isQuirksMode: _snapshot.isQuirksMode,
          namespace: _snapshot.namespace,
          doc: docDesc,
          from: _snapshot.from === _snapshot.doc ? '(same as doc)' : fromDesc,
          root: { summary: describeElement(_snapshot.root) },
        },
        debugCollect: _snapshot.debugCollect,
        debugCompile: _snapshot.debugCompile,
      }, null, 2);
    },

  };

  initialize(_doc);

  return Dom;
}

function concatCall(nodes: Element[] | NodeListOf<Element>, callback: QueryCallback): Element[] {
  const list: Element[] = Array(nodes.length);
  for (let i = 0, l = nodes.length; i < l; ++i) {
    if (false === callback((list[i] = nodes[i]))) break;
  }
  return list;
}

function concatList(list: Element[], nodes: ArrayLike<Element>): Element[] {
  const l = nodes.length;
  let i = 0;
  while (i < l) list[list.length] = nodes[i++];
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

function unique(nodes: Element[]): Element[] {
  let i = 0;
  let j = -1;
  let l = nodes.length + 1;
  const list: Element[] = [];

  while (--l) {
    if (nodes[i++] === nodes[i]) continue;
    list[++j] = nodes[i - 1];
  }

  return list;
}

function sortUnique(nodes: Element[]): Element[] {
  let hasDupes = false;
  nodes.sort((a, b) => {
    if (a === b) {
      hasDupes = true;
      return 0;
    }
    return a.compareDocumentPosition(b) & 4 ? -1 : 1;
  });

  return hasDupes ? unique(nodes) : nodes;
}

// check if the document type is HTML
function isHTML(doc: Document) {
  return doc.nodeType == 9 &&
    // contentType not in IE <= 11
    'contentType' in doc ?
      doc.contentType.indexOf('/html') > 0 :
      doc.createElement('DiV').localName == 'div';
}

function isQuirksMode(doc: Document): boolean {
  return isHTML(doc) && doc.compatMode.indexOf('CSS') < 0;
}

function getNamespace(doc: Document): string | null {
  return doc.documentElement ? doc.documentElement.namespaceURI : null;
}

function updateSnapshot(snap: SnapshotState, ctx: QueryContext, force = false): SnapshotState {
  const doc = ctx.ownerDocument ?? ctx;

  if (force || snap.doc !== doc) {
    snap.doc = doc;
    snap.root = doc.documentElement;
    snap.isHtml = isHTML(doc);
    snap.isQuirksMode = isQuirksMode(doc);
    snap.namespace = getNamespace(doc);
  }

  snap.from = ctx;
  return snap;
}

// convert single codepoint to UTF-16 encoding
function codePointToUTF16(codePoint: number) {
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
function stringFromCodePoint(codePoint: number) {
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

let cachedCssEscape: CssEscapeFn | undefined;
function cssEscape(str: string, glob: Glob): string {
  cachedCssEscape ??= typeof glob.CSS?.escape === 'function'
    ? (ident: string) => glob.CSS!.escape(ident)
    : (ident: string) => ident;
  return cachedCssEscape(str);
}

function decodeCssEscapes(ident: string): string {
  return REX.HasEscapes.test(ident)
    ? ident.replace(REX.FixEscapes, (substring, p1, p2) =>
        // unescaped " or '
        p2 ? '\\' + p2 :
        // javascript strings are UTF-16 encoded
        REX.HexNumbers.test(p1) ? codePointToUTF16(parseInt(p1, 16)) :
        // \' \"
        REX.EscOrQuote.test(p1) ? substring :
        // \g \h \. \# etc
        p1)
    : ident;
}

// convert escape sequence in a CSS string or identifier
// to javascript string with characters representations
function unescapeIdentifier(str: string) {
  return REX.HasEscapes.test(str) ?
    str.replace(REX.FixEscapes, (substring, p1, p2) =>
      // unescaped " or '
      p2 ? p2 :
      // javascript strings are UTF-16 encoded
      REX.HexNumbers.test(p1) ? stringFromCodePoint(parseInt(p1, 16)) :
      // \' \"
      REX.EscOrQuote.test(p1) ? substring :
      // \g \h \. \# etc
      p1
    ) : str;
}

// find duplicate ids using iterative walk
function byIdRaw(id: string, context: QueryContext) {
  const nodes = [ ]
  let node: QueryContext | null = context;
  let next = node.firstElementChild;
  while ((node = next)) {
    node.getAttribute('id') === id && (nodes[nodes.length] = node);
    if ((next = node.firstElementChild || node.nextElementSibling)) continue;
    while (!next && (node = node.parentElement) && node !== context) {
      next = node.nextElementSibling;
    }
  }
  return nodes;
}

// context agnostic getElementById
function byId(id: string, context: QueryContext, snap: SnapshotState): Element[] {
  if (!snap.config.IDS_DUPES && 'getElementById' in context) {
    const e = context.getElementById(id);
    return e ? [e] : [];
  }

  return byIdRaw(id, context);
}

// wrapped up namespaced TagName api calls
function byTagNSRaw(tag: string, context: QueryContext) {
  return byTagRaw(tag, context);
}

// context agnostic getElementsByTagName
function byTagRaw(tag: string, context: QueryContext) {
  let el: Element | null
  let nodes: Element[];
  // DOCUMENT_NODE (9) & ELEMENT_NODE (1)
  if ('getElementsByTagName' in context) {
    return Array.from(context.getElementsByTagName(tag));
  } else {
    tag = tag.toLowerCase();
    // DOCUMENT_FRAGMENT_NODE (11)
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
function byClassRaw(cls: string, context: QueryContext) {
  let el: Element | null;
  let nodes: Element[];
  // DOCUMENT_NODE (9) & ELEMENT_NODE (1)
  if ('getElementsByClassName' in context) {
    return Array.from(context.getElementsByClassName(cls));
  } else {
    // DOCUMENT_FRAGMENT_NODE (11)
    if ((el = context.firstElementChild)) {
      const reCls = RegExp('(^|\\s)' + cls + '(\\s|$)', isQuirksMode(document) ? 'i' : '');
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
function hasAttributeNS(e: Element, name: string, isHtml: boolean) {
  var i, l, attr = e.getAttributeNames();
  const reName = new RegExp(':?' + name + '$', isHtml ? 'i' : '');
  for (i = 0, l = attr.length; l > i; ++i) {
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

// function getContextName(ctx: QueryContext): string {
//   if (ctx.nodeType === 9) return '#document';
//   if (ctx.nodeType === 11) return '#fragment';
//   if (ctx.nodeType === 1) return (ctx as Element).localName;
//   return '#unknown';
// }

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

