import type {
  AttributeSelector, CandidatePredicate, CandidateTest, CompoundSelector, RelativeSelectorList, SelectorList,
} from '../parser/parser';
import type { NthArgs } from '../parser/nth';
import { asciiLower, cssIdentUnescape } from '../utils/css';
import { assertNever } from '../utils/util';
import {
  hasAttr, isChecked, isDefault, isDefined, isDisabled, isEnabled, isFocused, isIndeterminate,
  isInRange, isInvalid, isMuted, isNthElement, isNthOfType, isOptional, isOutOfRange, isPaused,
  isPlaceholderShown, isPlaying, isReadWrite, isRequired, isSeeking, isValid, matchAttribute,
  matchDir, matchLang, nthElement, nthOfType,
  isScope, isRoot, isEmpty, isFirstChild, isLastChild, isOnlyChild, isFirstOfType,
  isLastOfType, isOnlyOfType, matchesNthIndex, isAnyLink, isTarget, isHovered, isActive, isFocusWithin,
} from './runtime';
import { buildForgivingSelectorListTest, buildStrictSelectorListTest, buildRelativeSelectorListTest  } from '../planner/chain';

const TRUE_PREDICATE: CandidatePredicate = () => true;
const FALSE_PREDICATE: CandidatePredicate = () => false;

// [attr], [attr=value], [ns|attr op value flag]
export function emitAttributeTest(attr: AttributeSelector): CandidateTest {
  const anyNs = attr.prefixRaw === '*';

  const localName = cssIdentUnescape(attr.localRaw);
  const htmlName = asciiLower(localName);

  const htmlNameOrNull = htmlName === localName ? null : htmlName;
  const hasColonName = localName.indexOf(':') >= 0;

  // Existence: [attr], [|attr], [*|attr]
  if (!attr.op) {
    return {
      build: (s) => (e) => hasAttr(e, anyNs, localName, htmlNameOrNull, hasColonName, s),
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
      return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'attr', attr } };
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
          return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'attr', attr } };
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

  const htmlValue = asciiLower(attrVal);

  return {
    build: (s) => (e) =>
      matchAttribute(e, anyNs, localName, htmlNameOrNull, hasColonName, pattern, attrVal, htmlValue, sensitivity, s),
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
  return { build: (s) => (e) => isScope(e, s), unique: true, usesScope: true, cost: 2, debug: { kind: 'pseudo', name: 'scope' } };
}

// :root
export function emitRootPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isRoot(e, s), unique: true, cost: 1, debug: { kind: 'pseudo', name: 'root' } };
}

// :empty
export function emitEmptyPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isEmpty(e, s), cost: 2, debug: { kind: 'pseudo', name: 'empty' } };
}

// :first-child
export function emitFirstChildPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isFirstChild(e, s), cost: 3, debug: { kind: 'pseudo', name: 'first-child' } };
}

// :last-child
export function emitLastChildPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isLastChild(e, s), cost: 3, debug: { kind: 'pseudo', name: 'last-child' } };
}

// :only-child
export function emitOnlyChildPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isOnlyChild(e, s), cost: 4, debug: { kind: 'pseudo', name: 'only-child' } };
}

// :first-of-type
export function emitFirstOfTypePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isFirstOfType(e, s), cost: 3, debug: { kind: 'pseudo', name: 'first-of-type' } };
}

// :last-of-type
export function emitLastOfTypePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isLastOfType(e, s), cost: 4, debug: { kind: 'pseudo', name: 'last-of-type' } };
}

// :only-of-type
export function emitOnlyOfTypePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isOnlyOfType(e, s), cost: 4, debug: { kind: 'pseudo', name: 'only-of-type' } };
}

// :nth-child(), :nth-of-type(), :nth-last-child(), :nth-last-of-type()
export function emitNthPseudoTest(nth: NthArgs, meta: { ofType: boolean; last: boolean; }): CandidateTest {
  const { step, offset } = nth;
  const { ofType, last } = meta;
  const name = ofType
    ? last ? 'nth-last-of-type(...)' : 'nth-of-type(...)'
    : last ? 'nth-last-child(...)' : 'nth-child(...)';

  if (step === 1 && offset === 0) return { build: () => TRUE_PREDICATE, cost: 0, debug: { kind: 'static', value: true } };

  const cost = ofType ? 16 : 8;

  if (step === 0) {
    return {
      build: (s) => (e, rc) => ofType
        ? isNthOfType(e, offset, last, rc, s)
        : isNthElement(e, offset, last, rc, s),
      cost,
      usesCache: true,
      debug: { kind: 'pseudo', name },
    };
  }

  const absStep = Math.abs(step);

  if (absStep === 1) {
    return {
      build: (s) => (e, rc) => {
        const index = ofType ? nthOfType(e, last, rc, s) : nthElement(e, last, rc, s);
        return step > 0 ? index >= offset : index <= offset;
      },
      cost,
      usesCache: true,
      debug: { kind: 'pseudo', name },
    };
  }

  if (step === 2 && offset === 0) {
    return {
      build: (s) => (e, rc) => {
        const index = ofType ? nthOfType(e, last, rc, s) : nthElement(e, last, rc, s);
        return index % 2 === 0;
      },
      cost,
      usesCache: true,
      debug: { kind: 'pseudo', name },
    };
  }

  if (step === 2 && offset === 1) {
    return {
      build: (s) => (e, rc) => {
        const index = ofType ? nthOfType(e, last, rc, s) : nthElement(e, last, rc, s);
        return index % 2 === 1;
      },
      cost,
      usesCache: true,
      debug: { kind: 'pseudo', name },
    };
  }

  return {
    build: (s) => (e, rc) => {
      const index = ofType ? nthOfType(e, last, rc, s) : nthElement(e, last, rc, s);
      return matchesNthIndex(index, step, absStep, offset, s);
    },
    cost,
    usesCache: true,
    debug: { kind: 'pseudo', name },
  };
}

// :is()
export function emitIsPseudoTest(list: SelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    cost: list.cost,
    build: (s) => buildForgivingSelectorListTest(list, s),
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
    build: (s) => buildForgivingSelectorListTest(list, s),
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
    build: (s) => {
      const test = buildStrictSelectorListTest(list, s);
      return (e, rc) => !test(e, rc);
    },
    debug: { kind: 'not', list },
  };
}

// :has()
export function emitHasPseudoTest(list: RelativeSelectorList): CandidateTest {
  return {
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    cost: list.cost + 1,
    build: (s) => buildRelativeSelectorListTest(list, s),
    debug: { kind: 'has', list },
  };
}

// :dir()
export function emitDirPseudoTest(arg: string): CandidateTest {
  const dir = arg.toLowerCase();

  if (dir !== 'ltr' && dir !== 'rtl') {
    return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'static', value: false } };
  }

  return { build: (s) => (e) => matchDir(dir, e, s), cost: 4, debug: { kind: 'pseudo', name: 'dir(...)' } };
}

// :lang()
export function emitLangPseudoTest(arg: string): CandidateTest {
  const lang = arg.toLowerCase();
  return { build: (s) => (e) => matchLang(lang, e, s), cost: 4, debug: { kind: 'pseudo', name: 'lang(...)' } };
}

// :any-link
export function emitAnyLinkPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isAnyLink(e, s), cost: 3, debug: { kind: 'pseudo', name: 'any-link' } };
}

// :link
export function emitLinkPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isAnyLink(e, s), cost: 3, debug: { kind: 'pseudo', name: 'link' } };
}

// :visited
export function emitVisitedPseudoTest(): CandidateTest {
  // Browser selector APIs do not expose history state to script.
  return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'pseudo', name: 'visited' } };
}

// :target
export function emitTargetPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isTarget(e, s), cost: 2, debug: { kind: 'pseudo', name: 'target' } };
}

// :defined
export function emitDefinedPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isDefined(e, s), cost: 10, debug: { kind: 'pseudo', name: 'defined' } };
}

// :hover
export function emitHoverPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isHovered(e, s), cost: 3, debug: { kind: 'pseudo', name: 'hover' } };
}

// :active
export function emitActivePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isActive(e, s), cost: 3, debug: { kind: 'pseudo', name: 'active' } };
}

// :focus
export function emitFocusPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isFocused(e, s), cost: 16, debug: { kind: 'pseudo', name: 'focus' } };
}

// :focus-visible
export function emitFocusVisiblePseudoTest(): CandidateTest {
  // TODO: distinguish :focus-visible from :focus
  return { build: (s) => (e) => isFocused(e, s), cost: 16, debug: { kind: 'pseudo', name: 'focus-visible' } };
}

// :focus-within
export function emitFocusWithinPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isFocusWithin(e, s), cost: 12, debug: { kind: 'pseudo', name: 'focus-within' } };
}

// :enabled
export function emitEnabledPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isEnabled(e, s), cost: 5, debug: { kind: 'pseudo', name: 'enabled' } };
}

// :disabled
export function emitDisabledPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isDisabled(e, s), cost: 3, debug: { kind: 'pseudo', name: 'disabled' } };
}

// :read-only
export function emitReadOnlyPseudoTest(): CandidateTest {
  return { build: (s) => (e) => !isReadWrite(e, s), cost: 8, debug: { kind: 'pseudo', name: 'read-only' } };
}

// :read-write
export function emitReadWritePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isReadWrite(e, s), cost: 8, debug: { kind: 'pseudo', name: 'read-write' } };
}

// :placeholder-shown
export function emitPlaceholderShownPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isPlaceholderShown(e, s), cost: 5, debug: { kind: 'pseudo', name: 'placeholder-shown' } };
}

// :default
export function emitDefaultPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isDefault(e, s), cost: 2, debug: { kind: 'pseudo', name: 'default' } };
}

// :checked
export function emitCheckedPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isChecked(e, s), cost: 4, debug: { kind: 'pseudo', name: 'checked' } };
}

// :indeterminate
export function emitIndeterminatePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isIndeterminate(e, s), cost: 2, debug: { kind: 'pseudo', name: 'indeterminate' } };
}

// :required
export function emitRequiredPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isRequired(e, s), cost: 3, debug: { kind: 'pseudo', name: 'required' } };
}

// :optional
export function emitOptionalPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isOptional(e, s), cost: 5, debug: { kind: 'pseudo', name: 'optional' } };
}

// :invalid
export function emitInvalidPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isInvalid(e, s), cost: 30, debug: { kind: 'pseudo', name: 'invalid' } };
}

// :valid
export function emitValidPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isValid(e, s), cost: 30, debug: { kind: 'pseudo', name: 'valid' } };
}

// :in-range
export function emitInRangePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isInRange(e, s), cost: 28, debug: { kind: 'pseudo', name: 'in-range' } };
}

// :out-of-range
export function emitOutOfRangePseudoTest(): CandidateTest {
  return { build: (s) => (e) => isOutOfRange(e, s), cost: 28, debug: { kind: 'pseudo', name: 'out-of-range' } };
}

// :playing
export function emitPlayingPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isPlaying(e, s), cost: 2, debug: { kind: 'pseudo', name: 'playing' } };
}

// :paused
export function emitPausedPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isPaused(e, s), cost: 2, debug: { kind: 'pseudo', name: 'paused' } };
}

// :seeking
export function emitSeekingPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isSeeking(e, s), cost: 2, debug: { kind: 'pseudo', name: 'seeking' } };
}

// :buffering
export function emitBufferingPseudoTest(): CandidateTest {
  return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'pseudo', name: 'buffering' } };
}

// :stalled
export function emitStalledPseudoTest(): CandidateTest {
  return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'pseudo', name: 'stalled' } };
}

// :muted
export function emitMutedPseudoTest(): CandidateTest {
  return { build: (s) => (e) => isMuted(e, s), cost: 2, debug: { kind: 'pseudo', name: 'muted' } };
}

// :volume-locked
export function emitVolumeLockedPseudoTest(): CandidateTest {
  return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'pseudo', name: 'volume-locked' } };
}

// parse-valid no-match pseudo-class
export function emitNoMatchPseudoTest(name: string): CandidateTest {
  return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'pseudo', name } };
}

// parse-valid no-match pseudo-element
export function emitNoMatchPseudoElementTest(name: string): CandidateTest {
  return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'pseudo-element', name } };
}

// ::part() pseudo-element
export function emitPartPseudoElementTest(parts: string[]): CandidateTest {
  return { build: () => FALSE_PREDICATE, cost: 0, debug: { kind: 'parts', parts } };
}

export function emitSlottedPseudoElementTest(arg: CompoundSelector): CandidateTest {
  return {
    usesScope: arg.usesScope,
    usesCache: arg.usesCache,
    cost: arg.cost,
    build: () => FALSE_PREDICATE,
    debug: { kind: 'pseudo-element', name: 'slotted' },
  };
}

// :state() pseudo-class
export function emitStatePseudoTest(raw: string): CandidateTest {
  const stateName = cssIdentUnescape(raw);
  return {
    cost: 1,
    build: (s) => {
      return (e) => s.hasCustomState(e, stateName);
    },
    debug: { kind: 'pseudo', name: `state(${raw})` },
  };
}

// registered pseudo-class
export function emitRegisteredPseudoTest(name: string): CandidateTest {
  return {
    build: (s) => (e) => s.pseudos[name](e),
    cost: 20,
    debug: { kind: 'registered-pseudo', name },
  };
}
