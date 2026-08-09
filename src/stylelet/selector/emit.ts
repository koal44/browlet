import {
  PseudoArgumentKind, SelectorKind,
  type AttributeSelector, type ClassSelector, type IdSelector,
  type PseudoClassSelector, type SimpleSelector, type TypeSelector,
} from '../syntax/selector';
import { asciiLower } from '../../shared/css';
import { assertNever } from '../../shared/util';
import type { Snapshot } from '../snapshot';
import {
  checkClass, checkId, checkTag, hasAttr, isChecked, isDefault, isDefined, isDisabled, isEnabled, isFocused, isIndeterminate,
  isInRange, isInvalid, isMuted, isNthElement, isNthOfType, isOptional, isOutOfRange, isPaused,
  isPlaceholderShown, isPlaying, isReadWrite, isRequired, isSeeking, isValid, matchAttribute,
  matchDir, matchLang, nthElement, nthOfType,
  isScope, isRoot, isEmpty, isFirstChild, isLastChild, isOnlyChild, isFirstOfType,
  isLastOfType, isOnlyOfType, matchesNthIndex, isAnyLink, isTarget, isHovered, isActive, isFocusWithin,
} from './runtime';
import {
  asSubjectPredicate, SubjectKind,
  type CandidateElementPredicate, type CompiledMatcher,
} from './candidate';

type NthArgs = { step: number; offset: number; };

const TRUE_PREDICATE: CandidateElementPredicate = () => true;
const FALSE_PREDICATE: CandidateElementPredicate = () => false;

export function emitMatcher(
  selector: SimpleSelector,
  snapshot: Snapshot,
  compiledArgument?: CompiledMatcher,
): CompiledMatcher {
  switch (selector.kind) {
    case SelectorKind.TypeSelector: return emitTypeTest(selector, snapshot);
    case SelectorKind.IdSelector: return emitIdTest(selector, snapshot);
    case SelectorKind.ClassSelector: return emitClassTest(selector, snapshot);
    case SelectorKind.AttributeSelector:
      return emitAttributeTest(selector, snapshot);
    case SelectorKind.PseudoClassSelector:
      return emitPseudoClassTest(
        selector,
        snapshot,
        compiledArgument,
      );
    default: return assertNever(selector);
  }
}

function emitIdTest(
  selector: IdSelector,
  snapshot: Snapshot,
): CompiledMatcher {
  return createMatcher(
    (element) => checkId(element, selector.name, snapshot),
    1,
  );
}

function emitClassTest(
  selector: ClassSelector,
  snapshot: Snapshot,
): CompiledMatcher {
  if (/[\t\n\f\r ]/.test(selector.name)) {
    return FALSE_MATCHER;
  }

  return createMatcher(
    (element) => checkClass(element, selector.name, snapshot),
    2,
  );
}

function emitTypeTest(
  selector: TypeSelector,
  snapshot: Snapshot,
): CompiledMatcher {
  const localName = selector.name;
  const lowerName = asciiLower(localName);
  const testName: (element: Element, snapshot: Snapshot) => boolean = localName === '*'
    ? () => true
    : (element, snapshot) =>
      checkTag(element, lowerName, localName, snapshot);

  let element: CandidateElementPredicate;

  if (selector.namespace === '*') {
    element = (candidate) => testName(candidate, snapshot);
  } else if (selector.namespace === '') {
    element = (candidate) =>
      snapshot.getNamespaceURI(candidate) === null &&
      testName(candidate, snapshot);
  } else if (selector.namespace !== null) {
    element = FALSE_PREDICATE;
  } else {
    element = (candidate) => testName(candidate, snapshot);
  }

  return createMatcher(element, localName === '*' ? 0 : 2);
}

function emitPseudoClassTest(
  selector: PseudoClassSelector,
  snapshot: Snapshot,
  compiledArgument?: CompiledMatcher,
): CompiledMatcher {
  const argument = selector.argument;

  switch (selector.name) {
    case 'is':
      return emitIsPseudoTest(compiledArgument);
    case 'where':
      return emitWherePseudoTest(compiledArgument);
    case 'not':
      return emitNotPseudoTest(compiledArgument);
    case 'has':
      return emitHasPseudoTest(compiledArgument);
    case 'host':
      return argument === null || compiledArgument !== undefined
        ? emitHostPseudoTest(compiledArgument)
        : emitNoMatchPseudoTest();
    case 'host-context':
      return emitHostContextPseudoTest(compiledArgument);
    case 'scope': return emitScopePseudoTest(snapshot);
    case 'root': return emitRootPseudoTest(snapshot);
    case 'empty': return emitEmptyPseudoTest(snapshot);
    case 'first-child': return emitFirstChildPseudoTest(snapshot);
    case 'last-child': return emitLastChildPseudoTest(snapshot);
    case 'only-child': return emitOnlyChildPseudoTest(snapshot);
    case 'first-of-type': return emitFirstOfTypePseudoTest(snapshot);
    case 'last-of-type': return emitLastOfTypePseudoTest(snapshot);
    case 'only-of-type': return emitOnlyOfTypePseudoTest(snapshot);
    case 'nth-child':
    case 'nth-last-child':
      if (argument?.kind !== PseudoArgumentKind.NthChild || argument.of !== null) {
        return emitNoMatchPseudoTest();
      }
      return emitNthPseudoTest(
        { step: argument.formula.a, offset: argument.formula.b },
        { ofType: false, last: selector.name === 'nth-last-child' },
        snapshot,
      );
    case 'nth-of-type':
    case 'nth-last-of-type':
      return argument?.kind === PseudoArgumentKind.AnPlusB
        ? emitNthPseudoTest(
          { step: argument.a, offset: argument.b },
          { ofType: true, last: selector.name === 'nth-last-of-type' },
          snapshot,
        )
        : emitNoMatchPseudoTest();
    case 'dir':
      return argument?.kind === PseudoArgumentKind.Direction && argument.value !== null
        ? emitDirPseudoTest(argument.value, snapshot)
        : emitNoMatchPseudoTest();
    case 'lang':
      return argument?.kind === PseudoArgumentKind.LanguageRangeList
        ? emitLanguageRangesPseudoTest(argument.ranges, snapshot)
        : emitNoMatchPseudoTest();
    case 'any-link': return emitAnyLinkPseudoTest(snapshot);
    case 'link': return emitLinkPseudoTest(snapshot);
    case 'visited': return emitVisitedPseudoTest();
    case 'target': return emitTargetPseudoTest(snapshot);
    case 'defined': return emitDefinedPseudoTest(snapshot);
    case 'hover': return emitHoverPseudoTest(snapshot);
    case 'active': return emitActivePseudoTest(snapshot);
    case 'focus': return emitFocusPseudoTest(snapshot);
    case 'focus-visible': return emitFocusVisiblePseudoTest(snapshot);
    case 'focus-within': return emitFocusWithinPseudoTest(snapshot);
    case 'enabled': return emitEnabledPseudoTest(snapshot);
    case 'disabled': return emitDisabledPseudoTest(snapshot);
    case 'read-only': return emitReadOnlyPseudoTest(snapshot);
    case 'read-write': return emitReadWritePseudoTest(snapshot);
    case 'placeholder-shown': return emitPlaceholderShownPseudoTest(snapshot);
    case 'default': return emitDefaultPseudoTest(snapshot);
    case 'checked': return emitCheckedPseudoTest(snapshot);
    case 'indeterminate': return emitIndeterminatePseudoTest(snapshot);
    case 'required': return emitRequiredPseudoTest(snapshot);
    case 'optional': return emitOptionalPseudoTest(snapshot);
    case 'invalid': return emitInvalidPseudoTest(snapshot);
    case 'valid': return emitValidPseudoTest(snapshot);
    case 'in-range': return emitInRangePseudoTest(snapshot);
    case 'out-of-range': return emitOutOfRangePseudoTest(snapshot);
    case 'playing': return emitPlayingPseudoTest(snapshot);
    case 'paused': return emitPausedPseudoTest(snapshot);
    case 'seeking': return emitSeekingPseudoTest(snapshot);
    case 'buffering': return emitBufferingPseudoTest();
    case 'stalled': return emitStalledPseudoTest();
    case 'muted': return emitMutedPseudoTest(snapshot);
    case 'volume-locked': return emitVolumeLockedPseudoTest();
    case 'state':
      return argument?.kind === PseudoArgumentKind.Ident
        ? emitStatePseudoTest(argument.value, snapshot)
        : emitNoMatchPseudoTest();
    default:
      return emitNoMatchPseudoTest();
  }
}

// [attr], [attr=value], [ns|attr op value flag]
function emitAttributeTest(
  attr: AttributeSelector,
  snapshot: Snapshot,
): CompiledMatcher {
  const anyNs = attr.wqName.namespace === '*';

  const localName = attr.wqName.localName;
  const htmlName = asciiLower(localName);

  const htmlNameOrNull = htmlName === localName ? null : htmlName;
  const hasColonName = localName.indexOf(':') >= 0;

  // Existence: [attr], [|attr], [*|attr]
  if (!attr.matcher) {
    return createMatcher(
      (element) => hasAttr(
        element,
        anyNs,
        localName,
        htmlNameOrNull,
        hasColonName,
        snapshot,
      ),
      3,
    );
  }

  if (attr.value === null) {
    throw new Error(`Missing attribute value in selector`);
  }

  const attrVal = attr.value;

  const sensitivity =
    attr.modifier === 'i' ? 1
    : attr.modifier === 's' ? 0
    : ATTR_INSENSITIVE.has(htmlName) ? 2
    : 0;

  let pattern: string;
  let cost = 4;

  if (attrVal === '') {
    if (attr.matcher === '=') {       // [attr=""] matches only empty values.
      pattern = '=';
    }
    else if (attr.matcher === '|=') { // [attr|=""] matches only empty or hyphen-only values.
      pattern = '|';
    }
    else {                       // ^=, $=, *=, ~= with empty expected value match nothing.
      return FALSE_MATCHER;
    }
  } else {
    switch (attr.matcher) {
      case '=': pattern = '='; cost = 3; break;
      case '^=': pattern = '^'; cost = 3; break;
      case '$=': pattern = '$'; cost = 3; break;
      case '|=': pattern = '|'; cost = 4; break;
      case '*=': pattern = '*'; cost = 4; break;
      case '~=':
        if (/[\t\n\f\r ]/.test(attrVal)) {
          // [attr~="a b"] is syntactically valid but can never match one whitespace-separated token.
          return FALSE_MATCHER;
        }

        // Keep ~= on the manual token path. A CSS-space regex is faster for one
        // hot repeated token selector, but token-selector churn favors avoiding
        // distinct regex patterns and cache/JIT overhead.
        pattern = '~R';
        // pattern = `(^|[\\t\\n\\f\\r ])${escapeRegExp(attrVal)}([\\t\\n\\f\\r ]|$)`;
        cost = 4;
        break;

      default:
        assertNever(attr.matcher);
    }
  }

  const htmlValue = asciiLower(attrVal);

  return createMatcher(
    (element) => matchAttribute(
      element,
      anyNs,
      localName,
      htmlNameOrNull,
      hasColonName,
      pattern,
      attrVal,
      htmlValue,
      sensitivity,
      snapshot,
    ),
    cost,
  );
}

const ATTR_INSENSITIVE = new Set([
  'accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color',
  'compact', 'declare', 'defer', 'dir', 'direction', 'disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang',
  'language', 'link', 'media', 'method', 'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev',
  'rules', 'scope', 'scrolling', 'selected', 'shape', 'target', 'text', 'type', 'valign', 'valuetype', 'vlink',
]);

// :is()
function emitIsPseudoTest(
  argument?: CompiledMatcher,
): CompiledMatcher {
  return argument ?? FALSE_MATCHER;
}

// :where()
function emitWherePseudoTest(
  argument?: CompiledMatcher,
): CompiledMatcher {
  return argument ?? FALSE_MATCHER;
}

// :not()
function emitNotPseudoTest(
  argument?: CompiledMatcher,
): CompiledMatcher {
  if (argument === undefined) return FALSE_MATCHER;

  const subject = argument.subject;

  return {
    element: (element, runtimeCache) =>
      !argument.element(element, runtimeCache),
    subject: subject === undefined
      ? undefined
      : (element, runtimeCache, kind) => {
        const result = subject(element, runtimeCache, kind);
        return result === null ? null : !result;
      },
    cost: argument.cost,
    usesCache: argument.usesCache,
    usesTriMatch: argument.usesTriMatch,
  };
}

// :has()
function emitHasPseudoTest(
  argument?: CompiledMatcher,
): CompiledMatcher {
  return argument ?? FALSE_MATCHER;
}

// :host/:host()
function emitHostPseudoTest(
  argument?: CompiledMatcher,
): CompiledMatcher {
  const argumentSubject = argument === undefined
    ? null
    : asSubjectPredicate(argument);

  return {
    element: FALSE_PREDICATE,
    subject: (element, runtimeCache, subject) => {
      if (subject !== SubjectKind.HostElement) return false;
      return argumentSubject === null
        ? true
        : argumentSubject(element, runtimeCache, SubjectKind.Element);
    },
    cost: 1 + (argument?.cost ?? 0),
    usesCache: argument?.usesCache ?? false,
    usesTriMatch: true,
  };
}

// :host-context()
function emitHostContextPseudoTest(
  argument?: CompiledMatcher,
): CompiledMatcher {
  if (argument === undefined) return FALSE_MATCHER;

  const argumentSubject = asSubjectPredicate(argument);

  return {
    element: FALSE_PREDICATE,
    subject: (element, runtimeCache, subject) => {
      if (subject !== SubjectKind.HostElement) return false;

      for (
        let current: Element | null = element;
        current !== null;
        current = current.parentElement
      ) {
        if (argumentSubject(
          current,
          runtimeCache,
          SubjectKind.Element,
        ) === true) {
          return true;
        }
      }

      return false;
    },
    cost: 1 + argument.cost,
    usesCache: argument.usesCache,
    usesTriMatch: true,
  };
}

// :scope
function emitScopePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isScope(element, snapshot), 2);
}

// :root
function emitRootPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isRoot(element, snapshot), 1);
}

// :empty
function emitEmptyPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isEmpty(element, snapshot), 2);
}

// :first-child
function emitFirstChildPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isFirstChild(element, snapshot), 3);
}

// :last-child
function emitLastChildPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isLastChild(element, snapshot), 3);
}

// :only-child
function emitOnlyChildPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isOnlyChild(element, snapshot), 4);
}

// :first-of-type
function emitFirstOfTypePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isFirstOfType(element, snapshot), 3);
}

// :last-of-type
function emitLastOfTypePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isLastOfType(element, snapshot), 4);
}

// :only-of-type
function emitOnlyOfTypePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isOnlyOfType(element, snapshot), 4);
}

// :nth-child(), :nth-of-type(), :nth-last-child(), :nth-last-of-type()
function emitNthPseudoTest(
  nth: NthArgs,
  meta: { ofType: boolean; last: boolean; },
  snapshot: Snapshot,
): CompiledMatcher {
  const { step, offset } = nth;
  const { ofType, last } = meta;

  if (step === 1 && offset === 0) {
    return createMatcher(TRUE_PREDICATE, 0, true);
  }

  const cost = ofType ? 16 : 8;

  if (step === 0) {
    return createMatcher(
      (element, runtimeCache) => ofType
        ? isNthOfType(element, offset, last, runtimeCache, snapshot)
        : isNthElement(element, offset, last, runtimeCache, snapshot),
      cost,
      true,
    );
  }

  const absStep = Math.abs(step);

  if (absStep === 1) {
    return createMatcher(
      (element, runtimeCache) => {
        const index = ofType
          ? nthOfType(element, last, runtimeCache, snapshot)
          : nthElement(element, last, runtimeCache, snapshot);
        return step > 0 ? index >= offset : index <= offset;
      },
      cost,
      true,
    );
  }

  if (step === 2 && offset === 0) {
    return createMatcher(
      (element, runtimeCache) => {
        const index = ofType
          ? nthOfType(element, last, runtimeCache, snapshot)
          : nthElement(element, last, runtimeCache, snapshot);
        return index % 2 === 0;
      },
      cost,
      true,
    );
  }

  if (step === 2 && offset === 1) {
    return createMatcher(
      (element, runtimeCache) => {
        const index = ofType
          ? nthOfType(element, last, runtimeCache, snapshot)
          : nthElement(element, last, runtimeCache, snapshot);
        return index % 2 === 1;
      },
      cost,
      true,
    );
  }

  return createMatcher(
    (element, runtimeCache) => {
      const index = ofType
        ? nthOfType(element, last, runtimeCache, snapshot)
        : nthElement(element, last, runtimeCache, snapshot);
      return matchesNthIndex(index, step, absStep, offset, snapshot);
    },
    cost,
    true,
  );
}

// :dir()
function emitDirPseudoTest(
  argument: string,
  snapshot: Snapshot,
): CompiledMatcher {
  const dir = argument.toLowerCase();

  if (dir !== 'ltr' && dir !== 'rtl') {
    return FALSE_MATCHER;
  }

  return createMatcher((element) => matchDir(dir, element, snapshot), 4);
}

function emitLanguageRangesPseudoTest(
  ranges: readonly string[],
  snapshot: Snapshot,
): CompiledMatcher {
  return createMatcher(
    (element) => ranges.some((range) =>
      matchLang(range, element, snapshot)),
    4 * ranges.length,
  );
}

// :any-link
function emitAnyLinkPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isAnyLink(element, snapshot), 3);
}

// :link
function emitLinkPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isAnyLink(element, snapshot), 3);
}

// :visited
function emitVisitedPseudoTest(): CompiledMatcher {
  // Browser selector APIs do not expose history state to script.
  return FALSE_MATCHER;
}

// :target
function emitTargetPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isTarget(element, snapshot), 2);
}

// :defined
function emitDefinedPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isDefined(element, snapshot), 10);
}

// :hover
function emitHoverPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isHovered(element, snapshot), 3);
}

// :active
function emitActivePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isActive(element, snapshot), 3);
}

// :focus
function emitFocusPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isFocused(element, snapshot), 16);
}

// :focus-visible
function emitFocusVisiblePseudoTest(snapshot: Snapshot): CompiledMatcher {
  // TODO: distinguish :focus-visible from :focus
  return createMatcher((element) => isFocused(element, snapshot), 16);
}

// :focus-within
function emitFocusWithinPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isFocusWithin(element, snapshot), 12);
}

// :enabled
function emitEnabledPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isEnabled(element, snapshot), 5);
}

// :disabled
function emitDisabledPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isDisabled(element, snapshot), 3);
}

// :read-only
function emitReadOnlyPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => !isReadWrite(element, snapshot), 8);
}

// :read-write
function emitReadWritePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isReadWrite(element, snapshot), 8);
}

// :placeholder-shown
function emitPlaceholderShownPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher(
    (element) => isPlaceholderShown(element, snapshot),
    5,
  );
}

// :default
function emitDefaultPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isDefault(element, snapshot), 2);
}

// :checked
function emitCheckedPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isChecked(element, snapshot), 4);
}

// :indeterminate
function emitIndeterminatePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isIndeterminate(element, snapshot), 2);
}

// :required
function emitRequiredPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isRequired(element, snapshot), 3);
}

// :optional
function emitOptionalPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isOptional(element, snapshot), 5);
}

// :invalid
function emitInvalidPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isInvalid(element, snapshot), 30);
}

// :valid
function emitValidPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isValid(element, snapshot), 30);
}

// :in-range
function emitInRangePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isInRange(element, snapshot), 28);
}

// :out-of-range
function emitOutOfRangePseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isOutOfRange(element, snapshot), 28);
}

// :playing
function emitPlayingPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isPlaying(element, snapshot), 2);
}

// :paused
function emitPausedPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isPaused(element, snapshot), 2);
}

// :seeking
function emitSeekingPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isSeeking(element, snapshot), 2);
}

// :buffering
function emitBufferingPseudoTest(): CompiledMatcher {
  return FALSE_MATCHER;
}

// :stalled
function emitStalledPseudoTest(): CompiledMatcher {
  return FALSE_MATCHER;
}

// :muted
function emitMutedPseudoTest(snapshot: Snapshot): CompiledMatcher {
  return createMatcher((element) => isMuted(element, snapshot), 2);
}

// :volume-locked
function emitVolumeLockedPseudoTest(): CompiledMatcher {
  return FALSE_MATCHER;
}

// parse-valid no-match pseudo-class
function emitNoMatchPseudoTest(): CompiledMatcher {
  return FALSE_MATCHER;
}

// :state() pseudo-class
function emitStatePseudoTest(
  state: string,
  snapshot: Snapshot,
): CompiledMatcher {
  return createMatcher(
    (element) => snapshot.hasCustomState(element, state),
    1,
  );
}

function createMatcher(
  element: CandidateElementPredicate,
  cost: number,
  usesCache = false,
): CompiledMatcher {
  return {
    element,
    cost,
    usesCache,
    usesTriMatch: false,
  };
}

const FALSE_MATCHER: CompiledMatcher = createMatcher(FALSE_PREDICATE, 0);
