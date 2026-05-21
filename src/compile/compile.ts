import { findUnescapedPipe, matchLogicalSelector, parseRelativeSelectorList } from "../parser";
import { asciiLower, cssIdentUnescape, escapeRegExp } from "../utils/css";

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

function selectLambdaKey(selector: string, hasCb: boolean): string {
  return `${hasCb ? '\x01' : '\x00'}${selector}`;
}

// compile groups or single selector strings into
// executable functions for matching or selecting
export function compile(selector: string, mode: true, hasCb: boolean, snap: Snapshot): SelectLambda;
export function compile(selector: string, mode: false, hasCb: false, snap: Snapshot): MatchLambda;
export function compile(selector: string, mode: boolean, hasCb: boolean, snap: Snapshot): SelectLambda | MatchLambda {
  const isSelectMode = mode === true;

  const cache = isSelectMode ? snap.selectLambdas : snap.matchLambdas;
  const key = isSelectMode ? selectLambdaKey(selector, hasCb) : selector;
  const cached = cache.get(key);
  if (cached) return cached;

  const spec = isSelectMode ? MACROS.S : MACROS.M;
  const macro = `${spec.BODY}${hasCb ? spec.TEST : ''}${spec.TAIL}`;

  const { source, post, modvar } = compileSelector(selector, macro, mode, snap);

  const loop = `${spec.LOOP}${isSelectMode ? `{${source}}` : source}`;
  const vars = modvar.length ? `,${modvar.join(',')}` : '';
  const f = `${spec.INIT}{${spec.HEAD}${vars};${loop}${post}${spec.RETURN}}`;
  const factory = Function('s', f)(snap) as SelectLambda | MatchLambda;

  if (isSelectMode) {
    snap.selectLambdas.set(key, factory as SelectLambda);
  } else {
    snap.matchLambdas.set(key, factory as MatchLambda);
  }

  return factory;
}

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
        
        source = `if(s.checkId(e,${JSON.stringify(id)})){${source}}`;
        break;
      }

      // class name resolver
      case '.': {
        match = selector.match(snap.re.Patterns.className);
        if (!match) throw new Error('Invalid class selector: ' + selector);

        const cls = cssIdentUnescape(match[1]);

        // Class selectors match whitespace-separated tokens. If the decoded selector
        // fragment itself contains whitespace, it cannot denote one class token.
        if (/[\t\n\f\r ]/.test(cls)) {
          source = `if(false){${source}}`;
          break;
        }

        source = `if(s.checkClass(e,${JSON.stringify(cls)})){${source}}`;
        break;
      }

      // tag name resolver
      case '<tag>': {
        match = selector.match(snap.re.Patterns.tagName);
        if (!match) throw new Error('Invalid tag selector: ' + selector);

        const tag = cssIdentUnescape(match[1]);
        const lowerTag = asciiLower(tag);

        source = tag === lowerTag
          ? `if(e.localName===${JSON.stringify(tag)}){${source}}`
          : `if(s.checkTag(e,${JSON.stringify(lowerTag)},${JSON.stringify(tag)})){${source}}`;

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

export const ATTR_INSENSITIVE = new Set([
  'accept', 'accept-charset', 'align', 'alink', 'axis',
  'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color',
  'compact', 'declare', 'defer', 'dir', 'direction', 'disabled',
  'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang',
  'language', 'link', 'media', 'method', 'multiple', 'nohref',
  'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev',
  'rules', 'scope', 'scrolling', 'selected', 'shape', 'target',
  'text', 'type', 'valign', 'valuetype', 'vlink',
]);
