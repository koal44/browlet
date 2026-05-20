import { escapeRegExp } from "./utils/css";

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

export type Rex = ReturnType<typeof buildRex>;
