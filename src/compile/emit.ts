import type { AttributeSelector, CandidateTest, CompoundSelector, RelativeSelectorList, SelectorList } from '../parser/parser';
import type { NthArgs } from '../parser/nth';
import { asciiLower, cssIdentUnescape } from '../utils/css';
import { assertNever } from '../utils/util';
import { buildCompoundTest, buildForgivingSelectorListTest, buildRelativeSelectorListTest, buildStrictSelectorListTest } from '../planner/build-tests';

// [attr], [attr=value], [ns|attr op value flag]
export function emitAttributeTest(attr: AttributeSelector): CandidateTest {
  const anyNsArg = attr.prefixRaw === '*' ? 'true' : 'false';

  const localName = cssIdentUnescape(attr.localRaw);
  const htmlName = asciiLower(localName);

  const nameArg = JSON.stringify(localName);
  const htmlNameArg = htmlName === localName ? 'null' : JSON.stringify(htmlName);
  const hasColonNameArg = localName.indexOf(':') >= 0 ? 'true' : 'false';

  // Existence: [attr], [|attr], [*|attr]
  if (!attr.op) {
    return {
      source: `s.hasAttr(e,${anyNsArg},${nameArg},${htmlNameArg},${hasColonNameArg})`,
      cost: 3,
      debug: { kind: 'attr', attr },
    };
  }

  if (attr.valueRaw === undefined) {
    throw new Error(`Missing attribute value in selector`);
  }

  const attrVal = cssIdentUnescape(attr.valueRaw);

  const sensitivity =
    attr.flag === 'i' ? 1
    : attr.flag === 's' ? 0
    : ATTR_INSENSITIVE.has(htmlName) ? 2
    : 0;

  let pattern: string;
  let cost = 4;

  if (attrVal === '') {
    if (attr.op === '=') {       // [attr=""] matches only empty values.
      pattern = '=';
    }
    else if (attr.op === '|=') { // [attr|=""] matches only empty or hyphen-only values.
      pattern = '|';
    }
    else {                       // ^=, $=, *=, ~= with empty expected value match nothing.
      return { source: 'false', cost: 0, debug: { kind: 'attr', attr } };
    }
  } else {
    switch (attr.op) {
      case '=': pattern = '='; cost = 3; break;
      case '^=': pattern = '^'; cost = 3; break;
      case '$=': pattern = '$'; cost = 3; break;
      case '|=': pattern = '|'; cost = 4; break;
      case '*=': pattern = '*'; cost = 4; break;
      case '~=':
        if (/[\t\n\f\r ]/.test(attrVal)) {
          // [attr~="a b"] is syntactically valid but can never match one whitespace-separated token.
          return { source: 'false', cost: 0, debug: { kind: 'attr', attr } };
        }

        // Keep ~= on the manual token path. A CSS-space regex is faster for one
        // hot repeated token selector, but token-selector churn favors avoiding
        // distinct regex patterns and cache/JIT overhead.
        pattern = '~R';
        // pattern = `(^|[\\t\\n\\f\\r ])${escapeRegExp(attrVal)}([\\t\\n\\f\\r ]|$)`;
        cost = 4;
        break;

      default:
        assertNever(attr.op);
    }
  }

  const patternArg = JSON.stringify(pattern);
  const valueArg = JSON.stringify(attrVal);
  const htmlValueArg = JSON.stringify(asciiLower(attrVal));

  return {
    source:
      `s.matchAttribute(e,${anyNsArg},${nameArg},${htmlNameArg},${hasColonNameArg},` +
      `${patternArg},${valueArg},${htmlValueArg},${sensitivity})`,
    cost,
    debug: { kind: 'attr', attr },
  };
}

const ATTR_INSENSITIVE = new Set([
  'accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color',
  'compact', 'declare', 'defer', 'dir', 'direction', 'disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang',
  'language', 'link', 'media', 'method', 'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev',
  'rules', 'scope', 'scrolling', 'selected', 'shape', 'target', 'text', 'type', 'valign', 'valuetype', 'vlink',
]);

// :scope
export function emitScopePseudoTest(): CandidateTest {
  return { source: 's.isScope(e)', unique: true, usesScope: true, cost: 2 };
}

// :root
export function emitRootPseudoTest(): CandidateTest {
  return { source: 's.isRoot(e)', unique: true, cost: 1 };
}

// :host
export function emitHostPseudoTest(): CandidateTest {
  return { source: 's.isHost(e)', cost: 2, debug: { kind: 'pseudo', name: 'host' } };
}

// :host(<compound-selector>)
export function emitHostWithArgPseudoTest(arg: CompoundSelector): CandidateTest {
  return {
    usesScope: arg.usesScope,
    usesCache: arg.usesCache,
    cost: arg.cost + 2,
    buildSource: (ctx) => `s.isHost(e)&&(${buildCompoundTest(arg, ctx)})`,
    debug: { kind: 'host', arg },
  };
}

// :empty
export function emitEmptyPseudoTest(): CandidateTest {
  return { source: 's.isEmpty(e)', cost: 2 };
}

// :first-child
export function emitFirstChildPseudoTest(): CandidateTest {
  return { source: 's.isFirstChild(e)', cost: 3 };
}

// :last-child
export function emitLastChildPseudoTest(): CandidateTest {
  return { source: 's.isLastChild(e)', cost: 3 };
}

// :only-child
export function emitOnlyChildPseudoTest(): CandidateTest {
  return { source: 's.isOnlyChild(e)', cost: 4 };
}

// :first-of-type
export function emitFirstOfTypePseudoTest(): CandidateTest {
  return { source: 's.isFirstOfType(e)', cost: 3 };
}

// :last-of-type
export function emitLastOfTypePseudoTest(): CandidateTest {
  return { source: 's.isLastOfType(e)', cost: 4 };
}

// :only-of-type
export function emitOnlyOfTypePseudoTest(): CandidateTest {
  return { source: 's.isOnlyOfType(e)', cost: 4 };
}
// :nth-child(), :nth-of-type(), :nth-last-child(), :nth-last-of-type()
export function emitNthPseudoTest(nth: NthArgs, meta: { ofType: boolean; last: boolean; }): CandidateTest {
  const { step, offset } = nth;
  const { ofType, last } = meta;

  if (step === 1 && offset === 0) return { source: 'true', cost: 0 };

  const cost = ofType ? 16 : 8;

  if (step === 0) {
    return {
      source: ofType
        ? `s.isNthOfType(e,${offset},${last},rc)`
        : `s.isNthElement(e,${offset},${last},rc)`,
      cost,
      usesCache: true,
    };
  }

  const index = ofType ? `s.nthOfType(e,${last},rc)` : `s.nthElement(e,${last},rc)`;
  const absStep = Math.abs(step);

  if (absStep === 1) return { source: step > 0 ? `${index}>=${offset}` : `${index}<=${offset}`, cost, usesCache: true };
  if (step === 2 && offset === 0) return { source: `${index}%2===0`, cost, usesCache: true };
  if (step === 2 && offset === 1) return { source: `${index}%2===1`, cost, usesCache: true };

  return { source: `s.matchesNthIndex(${index},${step},${absStep},${offset})`, cost, usesCache: true };
}

// :is()
export function emitIsPseudoTest(list: SelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    cost: list.cost,
    buildSource: (ctx) => buildForgivingSelectorListTest(list, ctx),
    pseudoIs: list,
    debug: { kind: 'is', list },
  };
}

// :where()
export function emitWherePseudoTest(list: SelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    cost: list.cost,
    buildSource: (ctx) => buildForgivingSelectorListTest(list, ctx),
    pseudoWhere: list,
    debug: { kind: 'where', list },
  };
}

// :not()
export function emitNotPseudoTest(list: SelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    cost: list.cost,
    buildSource: (ctx) => `!(${buildStrictSelectorListTest(list, ctx)})`,
    debug: { kind: 'not', list },
  };
}

// :has()
export function emitHasPseudoTest(list: RelativeSelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    cost: list.cost + 1,
    buildSource: (ctx) => buildRelativeSelectorListTest(list, ctx),
    debug: { kind: 'has', list },
  };
}

// :dir()
export function emitDirPseudoTest(arg: string): CandidateTest {
  const dir = arg.toLowerCase();

  if (dir !== 'ltr' && dir !== 'rtl') {
    return { source: 'false', cost: 0 };
  }

  return { source: `s.matchDir(${JSON.stringify(dir)},e)`, cost: 4 };
}

// :lang()
export function emitLangPseudoTest(arg: string): CandidateTest {
  const lang = arg.toLowerCase();
  return { source: `s.matchLang(${JSON.stringify(lang)},e)`, cost: 4 };
}

// :any-link
export function emitAnyLinkPseudoTest(): CandidateTest {
  return { source: 's.isAnyLink(e)', cost: 3 };
}

// :link
export function emitLinkPseudoTest(): CandidateTest {
  return { source: 's.isAnyLink(e)', cost: 3 };
}

// :visited
export function emitVisitedPseudoTest(): CandidateTest {
  // Browser selector APIs do not expose history state to script.
  return { source: 'false', cost: 0, debug: { kind: 'pseudo', name: 'visited' } };
}

// :target
export function emitTargetPseudoTest(): CandidateTest {
  return { source: 's.isTarget(e)', cost: 2 };
}

// :defined
export function emitDefinedPseudoTest(): CandidateTest {
  return { source: 's.defined(e)', cost: 10 };
}

// :hover
export function emitHoverPseudoTest(): CandidateTest {
  return { source: 's.isHovered(e)', cost: 3 };
}

// :active
export function emitActivePseudoTest(): CandidateTest {
  return { source: 's.isActive(e)', cost: 3 };
}

// :focus
export function emitFocusPseudoTest(): CandidateTest {
  return { source: 's.isFocused(e)', cost: 16 };
}

// :focus-visible
export function emitFocusVisiblePseudoTest(): CandidateTest {
  // TODO: distinguish :focus-visible from :focus
  return { source: 's.isFocused(e)', cost: 16 };
}

// :focus-within
export function emitFocusWithinPseudoTest(): CandidateTest {
  return { source: 's.isFocusWithin(e)', cost: 12 };
}

// :enabled
export function emitEnabledPseudoTest(): CandidateTest {
  return { source: 's.isEnabled(e)', cost: 5 };
}
// :disabled
export function emitDisabledPseudoTest(): CandidateTest {
  return { source: 's.isDisabled(e)', cost: 3 };
}

// :read-only
export function emitReadOnlyPseudoTest(): CandidateTest {
  return { source: '!s.isReadWrite(e)', cost: 8 };
}

// :read-write
export function emitReadWritePseudoTest(): CandidateTest {
  return { source: 's.isReadWrite(e)', cost: 8 };
}

// :placeholder-shown
export function emitPlaceholderShownPseudoTest(): CandidateTest {
  return { source: 's.isPlaceholderShown(e)', cost: 5 };
}

// :default
export function emitDefaultPseudoTest(): CandidateTest {
  return { source: 's.isDefault(e)', cost: 2 };
}
// :checked
export function emitCheckedPseudoTest(): CandidateTest {
  return { source: 's.isChecked(e)', cost: 4 };
}

// :indeterminate
export function emitIndeterminatePseudoTest(): CandidateTest {
  return { source: 's.isIndeterminate(e)', cost: 2 };
}

// :required
export function emitRequiredPseudoTest(): CandidateTest {
  return { source: 's.isRequired(e)', cost: 3 };
}

// :optional
export function emitOptionalPseudoTest(): CandidateTest {
  return { source: 's.isOptional(e)', cost: 5 };
}

// :invalid
export function emitInvalidPseudoTest(): CandidateTest {
  return { source: 's.isInvalid(e)', cost: 30 };
}

// :valid
export function emitValidPseudoTest(): CandidateTest {
  return { source: 's.isValid(e)', cost: 30 };
}

// :in-range
export function emitInRangePseudoTest(): CandidateTest {
  return { source: 's.isInRange(e)', cost: 28 };
}

// :out-of-range
export function emitOutOfRangePseudoTest(): CandidateTest {
  return { source: 's.isOutOfRange(e)', cost: 28 };
}

// :playing
export function emitPlayingPseudoTest(): CandidateTest {
  return { source: 's.isPlaying(e)', cost: 2 };
}

// :paused
export function emitPausedPseudoTest(): CandidateTest {
  return { source: 's.isPaused(e)', cost: 2 };
}

// :seeking
export function emitSeekingPseudoTest(): CandidateTest {
  return { source: 's.isSeeking(e)', cost: 2 };
}

// :buffering
export function emitBufferingPseudoTest(): CandidateTest {
  return { source: 'false', cost: 0 };
}

// :stalled
export function emitStalledPseudoTest(): CandidateTest {
  return { source: 'false', cost: 0 };
}

// :muted
export function emitMutedPseudoTest(): CandidateTest {
  return { source: 's.isMuted(e)', cost: 2 };
}

// :volume-locked
export function emitVolumeLockedPseudoTest(): CandidateTest {
  return { source: 'false', cost: 0 };
}

// parse-valid no-match pseudo-class
export function emitNoMatchPseudoTest(name: string): CandidateTest {
  return { source: 'false', cost: 0, debug: { kind: 'pseudo', name } };
}

// parse-valid no-match pseudo-element
export function emitNoMatchPseudoElementTest(name: string): CandidateTest {
  return { source: 'false', cost: 0, debug: { kind: 'pseudo-element', name } };
}

// ::part() pseudo-element
export function emitPartPseudoElementTest(parts: string[]): CandidateTest {
  return { source: 'false', cost: 0, debug: { kind: 'parts', parts } };
}

export function emitSlottedPseudoElementTest(arg: CompoundSelector): CandidateTest {
  return {
    usesScope: arg.usesScope,
    usesCache: arg.usesCache,
    cost: arg.cost,
    source: 'false',
    debug: { kind: 'pseudo-element', name: 'slotted' },
  };
}

// :state() pseudo-class
export function emitStatePseudoTest(raw: string): CandidateTest {
  return { source: 'false', cost: 0, debug: { kind: 'pseudo', name: `state(${raw})` } };
}

// registered pseudo-class
export function emitRegisteredPseudoTest(name: string): CandidateTest {
  return {
    source: `s.pseudos[${JSON.stringify(name)}](e)`,
    cost: 20,
    debug: { kind: 'registered-pseudo', name },
  };
}
