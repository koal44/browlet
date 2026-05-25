import type {
  AttributeSelector, CandidateTest, RelativeSelectorList, SelectorList,
} from "../parser/parser";
import type { NthArgs } from "../parser/nth";
import { asciiLower, cssIdentUnescape } from "../utils/css";
import { assertNever } from "../utils/util";
import {
  buildForgivingSelectorListMatch, buildRelativeSelectorListMatch, buildStrictSelectorListMatch,
} from "./build";

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
    return { source: `s.hasAttr(e,${anyNsArg},${nameArg},${htmlNameArg},${hasColonNameArg})` };
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

  if (attrVal === '') {
    if (attr.op === '=') pattern = '=';       // [attr=""] matches only empty values.
    else if (attr.op === '|=') pattern = '|'; // [attr|=""] matches only empty or hyphen-only values.
    else return { source: 'false' };          // ^=, $=, *=, ~= with empty expected value match nothing.
  } else {
    switch (attr.op) {
      case '=': pattern = '='; break;
      case '^=': pattern = '^'; break;
      case '$=': pattern = '$'; break;
      case '*=': pattern = '*'; break;
      case '|=': pattern = '|'; break;
      case '~=':
        if (/[\t\n\f\r ]/.test(attrVal)) {
          // [attr~="a b"] is syntactically valid but can never match one whitespace-separated token.
          return { source: 'false' };
        }

        // Keep ~= on the manual token path. A CSS-space regex is faster for one
        // hot repeated token selector, but token-selector churn favors avoiding
        // distinct regex patterns and cache/JIT overhead.
        pattern = '~R';
        // pattern = `(^|[\\t\\n\\f\\r ])${escapeRegExp(attrVal)}([\\t\\n\\f\\r ]|$)`;
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
  return { source: 's.isScope(e)', unique: true, usesScope: true };
}

// :root
export function emitRootPseudoTest(): CandidateTest {
  return { source: 's.isRoot(e)', unique: true };
}

// :empty
export function emitEmptyPseudoTest(): CandidateTest {
  return { source: 's.isEmpty(e)' };
}

// :first-child
export function emitFirstChildPseudoTest(): CandidateTest {
  return { source: 's.isFirstChild(e)' };
}

// :last-child
export function emitLastChildPseudoTest(): CandidateTest {
  return { source: 's.isLastChild(e)' };
}

// :only-child
export function emitOnlyChildPseudoTest(): CandidateTest {
  return { source: 's.isOnlyChild(e)' };
}

// :first-of-type
export function emitFirstOfTypePseudoTest(): CandidateTest {
  return { source: 's.isFirstOfType(e)' };
}

// :last-of-type
export function emitLastOfTypePseudoTest(): CandidateTest {
  return { source: 's.isLastOfType(e)' };
}

// :only-of-type
export function emitOnlyOfTypePseudoTest(): CandidateTest {
  return { source: 's.isOnlyOfType(e)' };
}

// :nth-child(), :nth-of-type(), :nth-last-child(), :nth-last-of-type()
export function emitNthPseudoTest(nth: NthArgs, meta: { ofType: boolean; last: boolean }): CandidateTest {
  const { step, offset } = nth;
  const { ofType, last } = meta;

  if (step === 1 && offset === 0) return { source: 'true' };

  if (step === 0) {
    return {
      source: ofType
        ? `s.isNthOfType(e,${offset},${last},h)`
        : `s.isNthElement(e,${offset},${last},h)`,
    };
  }

  const index = ofType ? `s.nthOfType(e,${last},h)` : `s.nthElement(e,${last},h)`;
  const absStep = Math.abs(step);

  if (absStep === 1) return { source: step > 0 ? `${index}>=${offset}` : `${index}<=${offset}` };
  if (step === 2 && offset === 0) return { source: `${index}%2===0` };
  if (step === 2 && offset === 1) return { source: `${index}%2===1` };

  return { source: `s.matchesNthIndex(${index},${step},${absStep},${offset})` };
}

// :is()
export function emitIsPseudoTest(list: SelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    buildSource: (ctx) => buildForgivingSelectorListMatch(list, ctx)
  };
}

// :where()
export function emitWherePseudoTest(list: SelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    buildSource: (ctx) => buildForgivingSelectorListMatch(list, ctx)
  };
}

// :not()
export function emitNotPseudoTest(list: SelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    buildSource: (ctx) => `!(${buildStrictSelectorListMatch(list, ctx)})`
  };
}

// :has()
export function emitHasPseudoTest(list: RelativeSelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    buildSource: (ctx) => buildRelativeSelectorListMatch(list, ctx)
  };
}

// :dir()
export function emitDirPseudoTest(arg: string): CandidateTest {
  const dir = arg.toLowerCase();

  if (dir !== 'ltr' && dir !== 'rtl') {
    return { source: 'false' };
  }

  return { source: `s.matchDir(${JSON.stringify(dir)},e)` };
}

// :lang()
export function emitLangPseudoTest(arg: string): CandidateTest {
  const lang = arg.toLowerCase();
  return { source: `s.matchLang(${JSON.stringify(lang)},e)` };
}

// :any-link
export function emitAnyLinkPseudoTest(): CandidateTest {
  return { source: 's.isAnyLink(e)' };
}

// :link
export function emitLinkPseudoTest(): CandidateTest {
  return { source: 's.isAnyLink(e)' };
}

// :visited
export function emitVisitedPseudoTest(): CandidateTest {
  // Browser selector APIs do not expose history state to script.
  return { source: 'false' };
}

// :target
export function emitTargetPseudoTest(): CandidateTest {
  return { source: 's.isTarget(e)' };
}

// :defined
export function emitDefinedPseudoTest(): CandidateTest {
  return { source: 's.defined(e)' };
}

// :hover
export function emitHoverPseudoTest(): CandidateTest {
  return { source: 's.isHovered(e)' };
}

// :active
export function emitActivePseudoTest(): CandidateTest {
  return { source: 's.isActive(e)' };
}

// :focus
export function emitFocusPseudoTest(): CandidateTest {
  return { source: 's.isFocused(e)' };
}

// :focus-visible
export function emitFocusVisiblePseudoTest(): CandidateTest {
  // TODO: distinguish :focus-visible from :focus
  return { source: 's.isFocused(e)' };
}

// :focus-within
export function emitFocusWithinPseudoTest(): CandidateTest {
  return { source: 's.isFocusWithin(e)' };
}

// :enabled
export function emitEnabledPseudoTest(): CandidateTest {
  return { source: 's.isEnabled(e)' };
}

// :disabled
export function emitDisabledPseudoTest(): CandidateTest {
  return { source: 's.isDisabled(e)' };
}

// :read-only
export function emitReadOnlyPseudoTest(): CandidateTest {
  return { source: '!s.isReadWrite(e)' };
}

// :read-write
export function emitReadWritePseudoTest(): CandidateTest {
  return { source: 's.isReadWrite(e)' };
}

// :placeholder-shown
export function emitPlaceholderShownPseudoTest(): CandidateTest {
  return { source: 's.isPlaceholderShown(e)' };
}

// :default
export function emitDefaultPseudoTest(): CandidateTest {
  return { source: 's.isDefault(e)' };
}
// :checked
export function emitCheckedPseudoTest(): CandidateTest {
  return { source: 's.isChecked(e)' };
}

// :indeterminate
export function emitIndeterminatePseudoTest(): CandidateTest {
  return { source: 's.isIndeterminate(e)' };
}

// :required
export function emitRequiredPseudoTest(): CandidateTest {
  return { source: 's.isRequired(e)' };
}

// :optional
export function emitOptionalPseudoTest(): CandidateTest {
  return { source: 's.isOptional(e)' };
}

// :invalid
export function emitInvalidPseudoTest(): CandidateTest {
  return { source: 's.isInvalid(e)' };
}

// :valid
export function emitValidPseudoTest(): CandidateTest {
  return { source: 's.isValid(e)' };
}

// :in-range
export function emitInRangePseudoTest(): CandidateTest {
  return { source: 's.isInRange(e)' };
}

// :out-of-range
export function emitOutOfRangePseudoTest(): CandidateTest {
  return { source: 's.isOutOfRange(e)' };
}

// :playing
export function emitPlayingPseudoTest(): CandidateTest {
  return { source: 's.isPlaying(e)' };
}

// :paused
export function emitPausedPseudoTest(): CandidateTest {
  return { source: 's.isPaused(e)' };
}

// :seeking
export function emitSeekingPseudoTest(): CandidateTest {
  return { source: 's.isSeeking(e)' };
}

// :buffering
export function emitBufferingPseudoTest(): CandidateTest {
  return { source: 'false' };
}

// :stalled
export function emitStalledPseudoTest(): CandidateTest {
  return { source: 'false' };
}

// :muted
export function emitMutedPseudoTest(): CandidateTest {
  return { source: 's.isMuted(e)' };
}

// :volume-locked
export function emitVolumeLockedPseudoTest(): CandidateTest {
  return { source: 'false' };
}

// parse-valid no-match pseudo-class
export function emitNoMatchPseudoTest(_name: string): CandidateTest {
  return { source: 'false' };
}

// parse-valid no-match pseudo-element
export function emitNoMatchPseudoElementTest(_name: string): CandidateTest {
  return { source: 'false' };
}

// registered pseudo-class
export function emitRegisteredPseudoTest(name: string): CandidateTest {
  return {
    source: `s.pseudos[${JSON.stringify(name)}](e)`,
  };
}
