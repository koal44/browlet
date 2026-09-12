import {
  PseudoArgumentKind, SelectorKind,
  type AttributeSelector, type ClassSelector, type IdSelector,
  type PseudoClassSelector, type SimpleSelector, type TypeSelector,
} from '../syntax/selector';
import { asciiLower } from '../../infra/ascii';
import { assertNever } from '../../infra/util';
import type { StyleletContext } from '../context';
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
  context: StyleletContext,
  compiledArgument?: CompiledMatcher,
): CompiledMatcher {
  switch (selector.kind) {
    // Without a parent selector expansion, `&` behaves like :scope.
    case SelectorKind.NestingSelector: return emitScopePseudoTest(context);
    case SelectorKind.TypeSelector: return emitTypeTest(selector, context);
    case SelectorKind.IdSelector: return emitIdTest(selector, context);
    case SelectorKind.ClassSelector: return emitClassTest(selector, context);
    case SelectorKind.AttributeSelector:
      return emitAttributeTest(selector, context);
    case SelectorKind.PseudoClassSelector:
      return emitPseudoClassTest(
        selector,
        context,
        compiledArgument,
      );
    default: return assertNever(selector);
  }
}

function emitIdTest(
  selector: IdSelector,
  context: StyleletContext,
): CompiledMatcher {
  return createMatcher(
    (element) => checkId(element, selector.name, context),
    1,
  );
}

function emitClassTest(
  selector: ClassSelector,
  context: StyleletContext,
): CompiledMatcher {
  if (/[\t\n\f\r ]/.test(selector.name)) {
    return FALSE_MATCHER;
  }

  return createMatcher(
    (element) => checkClass(element, selector.name, context),
    2,
  );
}

function emitTypeTest(
  selector: TypeSelector,
  context: StyleletContext,
): CompiledMatcher {
  const localName = selector.name;
  const lowerName = asciiLower(localName);
  const testName: (element: Element, context: StyleletContext) => boolean = localName === '*'
    ? () => true
    : (element, context) =>
      checkTag(element, lowerName, localName, context);

  const namespaceURI = selector.namespaceURI;
  const element: CandidateElementPredicate = namespaceURI === undefined
    ? (candidate) => testName(candidate, context)
    : (candidate) =>
      context.getNamespaceURI(candidate) === namespaceURI &&
      testName(candidate, context);

  return createMatcher(element, localName === '*' ? 0 : 2);
}

function emitPseudoClassTest(
  selector: PseudoClassSelector,
  context: StyleletContext,
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
    case 'scope': return emitScopePseudoTest(context);
    case 'root': return emitRootPseudoTest(context);
    case 'empty': return emitEmptyPseudoTest(context);
    case 'first-child': return emitFirstChildPseudoTest(context);
    case 'last-child': return emitLastChildPseudoTest(context);
    case 'only-child': return emitOnlyChildPseudoTest(context);
    case 'first-of-type': return emitFirstOfTypePseudoTest(context);
    case 'last-of-type': return emitLastOfTypePseudoTest(context);
    case 'only-of-type': return emitOnlyOfTypePseudoTest(context);
    case 'nth-child':
    case 'nth-last-child':
      if (argument?.kind !== PseudoArgumentKind.NthChild || argument.of !== null) {
        return emitNoMatchPseudoTest();
      }
      return emitNthPseudoTest(
        { step: argument.formula.a, offset: argument.formula.b },
        { ofType: false, last: selector.name === 'nth-last-child' },
        context,
      );
    case 'nth-of-type':
    case 'nth-last-of-type':
      return argument?.kind === PseudoArgumentKind.AnPlusB
        ? emitNthPseudoTest(
          { step: argument.a, offset: argument.b },
          { ofType: true, last: selector.name === 'nth-last-of-type' },
          context,
        )
        : emitNoMatchPseudoTest();
    case 'dir':
      return argument?.kind === PseudoArgumentKind.Direction
        ? emitDirPseudoTest(argument.value, context)
        : emitNoMatchPseudoTest();
    case 'lang':
      return argument?.kind === PseudoArgumentKind.LanguageRangeList
        ? emitLanguageRangesPseudoTest(argument.ranges, context)
        : emitNoMatchPseudoTest();
    case 'any-link': return emitAnyLinkPseudoTest(context);
    case 'link': return emitLinkPseudoTest(context);
    case 'visited': return emitVisitedPseudoTest();
    case 'target': return emitTargetPseudoTest(context);
    case 'defined': return emitDefinedPseudoTest(context);
    case 'hover': return emitHoverPseudoTest(context);
    case 'active': return emitActivePseudoTest(context);
    case 'focus': return emitFocusPseudoTest(context);
    case 'focus-visible': return emitFocusVisiblePseudoTest(context);
    case 'focus-within': return emitFocusWithinPseudoTest(context);
    case 'enabled': return emitEnabledPseudoTest(context);
    case 'disabled': return emitDisabledPseudoTest(context);
    case 'read-only': return emitReadOnlyPseudoTest(context);
    case 'read-write': return emitReadWritePseudoTest(context);
    case 'placeholder-shown': return emitPlaceholderShownPseudoTest(context);
    case 'default': return emitDefaultPseudoTest(context);
    case 'checked': return emitCheckedPseudoTest(context);
    case 'indeterminate': return emitIndeterminatePseudoTest(context);
    case 'required': return emitRequiredPseudoTest(context);
    case 'optional': return emitOptionalPseudoTest(context);
    case 'invalid': return emitInvalidPseudoTest(context);
    case 'valid': return emitValidPseudoTest(context);
    case 'in-range': return emitInRangePseudoTest(context);
    case 'out-of-range': return emitOutOfRangePseudoTest(context);
    case 'playing': return emitPlayingPseudoTest(context);
    case 'paused': return emitPausedPseudoTest(context);
    case 'seeking': return emitSeekingPseudoTest(context);
    case 'buffering': return emitBufferingPseudoTest();
    case 'stalled': return emitStalledPseudoTest();
    case 'muted': return emitMutedPseudoTest(context);
    case 'volume-locked': return emitVolumeLockedPseudoTest();
    case 'state':
      return argument?.kind === PseudoArgumentKind.Ident
        ? emitStatePseudoTest(argument.value, context)
        : emitNoMatchPseudoTest();
    default:
      return emitNoMatchPseudoTest();
  }
}

// [attr], [attr=value], [ns|attr op value flag]
function emitAttributeTest(
  attr: AttributeSelector,
  context: StyleletContext,
): CompiledMatcher {
  const namespaceURI = attr.wqName.namespaceURI;

  const localName = attr.wqName.localName;
  const htmlName = asciiLower(localName);

  const htmlNameOrNull = htmlName === localName ? null : htmlName;
  const hasColonName = localName.indexOf(':') >= 0;

  // Existence: [attr], [|attr], [*|attr]
  if (!attr.matcher) {
    return createMatcher(
      (element) => hasAttr(
        element,
        namespaceURI,
        localName,
        htmlNameOrNull,
        hasColonName,
        context,
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
      namespaceURI,
      localName,
      htmlNameOrNull,
      hasColonName,
      pattern,
      attrVal,
      htmlValue,
      sensitivity,
      context,
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
function emitScopePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isScope(element, context), 2);
}

// :root
function emitRootPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isRoot(element, context), 1);
}

// :empty
function emitEmptyPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isEmpty(element, context), 2);
}

// :first-child
function emitFirstChildPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isFirstChild(element, context), 3);
}

// :last-child
function emitLastChildPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isLastChild(element, context), 3);
}

// :only-child
function emitOnlyChildPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isOnlyChild(element, context), 4);
}

// :first-of-type
function emitFirstOfTypePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isFirstOfType(element, context), 3);
}

// :last-of-type
function emitLastOfTypePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isLastOfType(element, context), 4);
}

// :only-of-type
function emitOnlyOfTypePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isOnlyOfType(element, context), 4);
}

// :nth-child(), :nth-of-type(), :nth-last-child(), :nth-last-of-type()
function emitNthPseudoTest(
  nth: NthArgs,
  meta: { ofType: boolean; last: boolean; },
  context: StyleletContext,
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
        ? isNthOfType(element, offset, last, runtimeCache, context)
        : isNthElement(element, offset, last, runtimeCache, context),
      cost,
      true,
    );
  }

  const absStep = Math.abs(step);

  if (absStep === 1) {
    return createMatcher(
      (element, runtimeCache) => {
        const index = ofType
          ? nthOfType(element, last, runtimeCache, context)
          : nthElement(element, last, runtimeCache, context);
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
          ? nthOfType(element, last, runtimeCache, context)
          : nthElement(element, last, runtimeCache, context);
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
          ? nthOfType(element, last, runtimeCache, context)
          : nthElement(element, last, runtimeCache, context);
        return index % 2 === 1;
      },
      cost,
      true,
    );
  }

  return createMatcher(
    (element, runtimeCache) => {
      const index = ofType
        ? nthOfType(element, last, runtimeCache, context)
        : nthElement(element, last, runtimeCache, context);
      return matchesNthIndex(index, step, absStep, offset, context);
    },
    cost,
    true,
  );
}

// :dir()
function emitDirPseudoTest(
  argument: string,
  context: StyleletContext,
): CompiledMatcher {
  const dir = asciiLower(argument);

  if (dir !== 'ltr' && dir !== 'rtl') {
    return FALSE_MATCHER;
  }

  return createMatcher((element) => matchDir(dir, element, context), 4);
}

function emitLanguageRangesPseudoTest(
  ranges: readonly string[],
  context: StyleletContext,
): CompiledMatcher {
  return createMatcher(
    (element) => ranges.some((range) =>
      matchLang(range, element, context)),
    4 * ranges.length,
  );
}

// :any-link
function emitAnyLinkPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isAnyLink(element, context), 3);
}

// :link
function emitLinkPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isAnyLink(element, context), 3);
}

// :visited
function emitVisitedPseudoTest(): CompiledMatcher {
  // Browser selector APIs do not expose history state to script.
  return FALSE_MATCHER;
}

// :target
function emitTargetPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isTarget(element, context), 2);
}

// :defined
function emitDefinedPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isDefined(element, context), 10);
}

// :hover
function emitHoverPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isHovered(element, context), 3);
}

// :active
function emitActivePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isActive(element, context), 3);
}

// :focus
function emitFocusPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isFocused(element, context), 16);
}

// :focus-visible
function emitFocusVisiblePseudoTest(context: StyleletContext): CompiledMatcher {
  // TODO: distinguish :focus-visible from :focus
  return createMatcher((element) => isFocused(element, context), 16);
}

// :focus-within
function emitFocusWithinPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isFocusWithin(element, context), 12);
}

// :enabled
function emitEnabledPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isEnabled(element, context), 5);
}

// :disabled
function emitDisabledPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isDisabled(element, context), 3);
}

// :read-only
function emitReadOnlyPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => !isReadWrite(element, context), 8);
}

// :read-write
function emitReadWritePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isReadWrite(element, context), 8);
}

// :placeholder-shown
function emitPlaceholderShownPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher(
    (element) => isPlaceholderShown(element, context),
    5,
  );
}

// :default
function emitDefaultPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isDefault(element, context), 2);
}

// :checked
function emitCheckedPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isChecked(element, context), 4);
}

// :indeterminate
function emitIndeterminatePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isIndeterminate(element, context), 2);
}

// :required
function emitRequiredPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isRequired(element, context), 3);
}

// :optional
function emitOptionalPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isOptional(element, context), 5);
}

// :invalid
function emitInvalidPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isInvalid(element, context), 30);
}

// :valid
function emitValidPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isValid(element, context), 30);
}

// :in-range
function emitInRangePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isInRange(element, context), 28);
}

// :out-of-range
function emitOutOfRangePseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isOutOfRange(element, context), 28);
}

// :playing
function emitPlayingPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isPlaying(element, context), 2);
}

// :paused
function emitPausedPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isPaused(element, context), 2);
}

// :seeking
function emitSeekingPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isSeeking(element, context), 2);
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
function emitMutedPseudoTest(context: StyleletContext): CompiledMatcher {
  return createMatcher((element) => isMuted(element, context), 2);
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
  context: StyleletContext,
): CompiledMatcher {
  return createMatcher(
    (element) => context.hasCustomState(element, state),
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
