import { asciiLower } from '../../infra/ascii';
import { InternalError } from '../../infra/internal-error';

import {
  consumeIdentToken, consumeWhitespace, createFreeFormConsumer, isComponentBlock, isDelimToken, isFunctionBlock,
  parseAsComponentGrammar, TokenKind, TokenList, withTrivia, isCustomPropertyName,
  type ComponentValue, type CustomPropertyName, type FunctionBlock, type TokenCursor,
} from '../syntax/index';

import { GuaranteedInvalidValue, guaranteedInvalidValue } from './guaranteed-invalid';
import { DeclarationValue, OptionalDeclarationValue } from './declaration-value';

/** Replace arbitrary substitutions before the consuming property reparses their result. */
export class SubstitutionValue {
  /** Unsubstituted declaration components, including their source spans. */
  value: OptionalDeclarationValue;

  constructor(value: OptionalDeclarationValue) {
    this.value = value;
  }

  /** Whether a component list contains an arbitrary substitution, including inside blocks. */
  static containsFunction(list: TokenList<ComponentValue>): boolean {
    for (const component of list.tokens) {
      if (!isComponentBlock(component)) continue;

      if (SubstitutionValue.#isSubstitution(component)) return true;
      if (SubstitutionValue.containsFunction(component.value)) return true;
    }

    return false;
  }

  /** Check var() argument structure at declaration time; the resulting name is checked at computation. */
  // https://drafts.csswg.org/css-values-5/#resolve-property
  static hasValidVarArguments(list: TokenList<ComponentValue>): boolean {
    for (const component of list.tokens) {
      if (!isComponentBlock(component)) continue;
      if (isFunctionBlock(component) && asciiLower(component.name) === 'var' &&
        !SubstitutionValue.#hasEarlyFunction(component.value) &&
        parseAsComponentGrammar(component.value, SubstitutionValue.#consumeVarArguments, {}) === null) return false;
      if (!SubstitutionValue.hasValidVarArguments(component.value)) return false;
    }
    // TODO: Validate the argument grammars of the other arbitrary substitution functions.
    return true;
  }

  /** Visit ordinary blocks, leaving each arbitrary function in control of its own arguments. */
  // https://drafts.csswg.org/css-values-5/#substitution
  // https://drafts.csswg.org/css-values-5/#early-resolution
  static #substitute(
    list: TokenList<ComponentValue>,
    getCustomProperty: CustomPropertyLookup,
    earlyOnly = false,
  ): TokenList<ComponentValue> | GuaranteedInvalidValue {
    let result: TokenList<ComponentValue> | undefined;
    let copied = 0;
    let invalid = false;
    let size = SubstitutionValue.#countTokens(list);
    for (let i = 0; i < list.sourceTokens.length; i++) {
      const component = list.sourceTokens[i]!;
      if (!isComponentBlock(component)) continue;
      if (isFunctionBlock(component) && component.replacement !== undefined) continue;
      let start = i;
      let replacement: TokenList<ComponentValue> | GuaranteedInvalidValue;
      const substitutesFunction = SubstitutionValue.#isSubstitution(component);
      if (substitutesFunction) {
        if (earlyOnly) {
          if (!SubstitutionValue.#isSpread(list, i)) continue;
          start -= 3;
        }
        replacement = SubstitutionValue.#replaceFunction(component, getCustomProperty);
      } else {
        replacement = SubstitutionValue.#substitute(component.value, getCustomProperty, earlyOnly);
        if (replacement === component.value) continue;
      }
      if (replacement instanceof GuaranteedInvalidValue) {
        // Continue visiting siblings: a later reference can still mark this property's guard cyclic.
        invalid = true;
        continue;
      }
      // An ordinary block keeps its delimiters; a substituted function contributes only its replacement.
      if (!substitutesFunction) size += 2;
      size += SubstitutionValue.#countTokens(replacement) - SubstitutionValue.#countTokens(list, start, i + 1);
      const next = substitutesFunction ? { ...component, replacement } : { ...component, value: replacement };
      result ??= new TokenList<ComponentValue>(list, true);
      for (; copied < start; copied++) result.append(list.sourceTokens[copied]!, list, copied, copied + 1);
      result.append(next, list, start, i + 1);
      copied = i + 1;
    }
    // Check before grammar consumers request the expanded tokens; no source text is read here.
    if (invalid || (result !== undefined && size > MAX_SUBSTITUTED_TOKENS)) return guaranteedInvalidValue;
    if (result === undefined) return list;
    for (; copied < list.sourceTokens.length; copied++) result.append(list.sourceTokens[copied]!, list, copied, copied + 1);
    return result;
  }

  /** Expand spread arguments first, then let var() substitute only the arguments it needs. */
  // https://drafts.csswg.org/css-variables-1/#using-variables (replace a var() function)
  static #replaceFunction(
    fn: FunctionBlock,
    getCustomProperty: CustomPropertyLookup,
  ): TokenList<ComponentValue> | GuaranteedInvalidValue {
    const early = SubstitutionValue.#substitute(fn.value, getCustomProperty, true);
    if (early instanceof GuaranteedInvalidValue) return early;
    const name = asciiLower(fn.name);
    if (name !== 'var') {
      // TODO: Connect attr(), env(), if(), inherit(), ident(), random-item(), and custom functions
      // to their owners, including their argument grammars, dependency guards, and taint rules.
      throw new InternalError(`Substitution for ${fn.name}() is not implemented`);
    }
    // SPEC_CLASH(var-argument-grammar): Follow Values 5 / Variables 1's free-form arguments,
    // dynamic names, and spread expansion. Chromium, Firefox, and WebKit use the older grammar.
    const args = parseAsComponentGrammar(early, SubstitutionValue.#consumeVarArguments, {});
    if (args === null) return guaranteedInvalidValue;
    const first = SubstitutionValue.#substitute(args.name.value, getCustomProperty);
    let result: TokenList<ComponentValue> | GuaranteedInvalidValue = guaranteedInvalidValue;
    if (!(first instanceof GuaranteedInvalidValue)) {
      const ident = parseAsComponentGrammar(first, consumeVarPropertyName, {});
      if (ident !== null && isCustomPropertyName(ident.value)) {
        // TODO: Carry animation taint with computed values when animation declarations participate.
        const value = getCustomProperty(ident.value);
        result = value instanceof GuaranteedInvalidValue ? value : value.value;
      }
    }
    // SPEC_CLASH(lazy-var-fallback): Follow the draft and Chromium; Firefox/WebKit still
    // let a cycle in an unused fallback invalidate the containing custom property.
    if (result instanceof GuaranteedInvalidValue && args.fallback !== null) {
      result = SubstitutionValue.#substitute(args.fallback.value, getCustomProperty);
    }
    return !(result instanceof GuaranteedInvalidValue) && SubstitutionValue.#countTokens(result) > MAX_SUBSTITUTED_TOKENS
      ? guaranteedInvalidValue : result;
  }

  /** Parse the argument grammar, preserving the difference between an omitted and an empty fallback. */
  static #consumeVarArguments(this: void, c: TokenCursor): VarArguments | null {
    const start = c.pos();
    const name = consumeVarName(c);
    if (name === null) return null;
    consumeWhitespace(c);
    if (!c.match(TokenKind.Comma)) return { name, fallback: null };
    const fallback = consumeVarFallback(c);
    if (fallback === null) {
      c.restore(start);
      return null;
    }
    return { name, fallback };
  }

  /** Whether early expansion can change this argument list before its grammar is applied. */
  static #hasEarlyFunction(list: TokenList<ComponentValue>): boolean {
    for (let i = 0; i < list.sourceTokens.length; i++) {
      const component = list.sourceTokens[i]!;
      if (!isComponentBlock(component)) continue;
      if (isFunctionBlock(component) && component.replacement !== undefined) continue;
      if (SubstitutionValue.#isSubstitution(component)) {
        if (SubstitutionValue.#isSpread(list, i)) return true;
      } else if (SubstitutionValue.#hasEarlyFunction(component.value)) {
        return true;
      }
    }
    return false;
  }

  static #isSubstitution(component: ComponentValue): component is FunctionBlock {
    if (!isFunctionBlock(component)) return false;
    const name = asciiLower(component.name);
    return name.startsWith('--') || ARBITRARY_SUBSTITUTION_FUNCTION_NAMES.has(name);
  }

  static #isSpread(list: TokenList<ComponentValue>, index: number): boolean {
    return index >= 3 && isDelimToken(list.sourceTokens[index - 1]!, '.') &&
      isDelimToken(list.sourceTokens[index - 2]!, '.') && isDelimToken(list.sourceTokens[index - 3]!, '.');
  }

  /** Count the underlying tokens, including block delimiters, rather than only folded components. */
  static #countTokens(
    list: TokenList<ComponentValue>,
    start = 0,
    end = list.sourceTokens.length,
    counts = new Map<TokenList<ComponentValue>, number>(),
  ): number {
    let count = 0;
    for (let i = start; i < end; i++) {
      const component = list.sourceTokens[i]!;
      if (!isComponentBlock(component)) {
        count++;
        continue;
      }
      const replacement = isFunctionBlock(component) ? component.replacement : undefined;
      const contents = replacement ?? component.value;
      let size = counts.get(contents);
      if (size === undefined) {
        // Computed lists can be shared repeatedly, including when they contain no tokens.
        size = SubstitutionValue.#countTokens(contents, 0, contents.sourceTokens.length, counts);
        counts.set(contents, size);
      }
      count += size + (replacement === undefined ? 2 : 0);
    }
    return count;
  }

  /** Substitute using the caller's guarded lookup of computed custom properties. */
  // SPEC_MISMATCH: substitute arbitrary substitution functions(values, context?) -> values
  // The engine guards property computation; recursive argument substitution shares that lookup.
  substitute(getCustomProperty: CustomPropertyLookup): TokenList<ComponentValue> | GuaranteedInvalidValue {
    return SubstitutionValue.#substitute(this.value.value, getCustomProperty);
  }

  /** Serialize the original declaration spelling without performing substitutions. */
  // https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
  // SPEC_CLASH(deferred-value-source-serialization): Preserve spelling; WebKit drops escapes/comments.
  // SPEC_CLASH(deferred-value-eof-serialization): Preserve missing EOF closers; Firefox/WebKit differ.
  serialize(): string {
    return this.value.value.sourceText();
  }
}

/** Computation inputs supplied by the caller, bound to the element being resolved. */
export type SubstitutionContext = {
  /** Guarded lookup; required when a value containing var() reaches computed time. */
  getCustomProperty?: CustomPropertyLookup;
};

/** Computed, unregistered custom values for the element being styled; missing names return the sentinel. */
export type CustomPropertyLookup = (name: CustomPropertyName) => OptionalDeclarationValue | GuaranteedInvalidValue;

type VarArguments = {
  name: DeclarationValue;
  fallback: OptionalDeclarationValue | null;
};

/*
 * var() argument grammar: var( <declaration-value> , <declaration-value>? )
 * The comma and second argument are optional. The fallback is non-strict:
 * commas belong to it, while an initial brace block delimits either argument.
 * https://drafts.csswg.org/css-variables-1/#using-variables
 */
const consumeVarName = createFreeFormConsumer(DeclarationValue.consume);
const consumeVarFallback = createFreeFormConsumer(OptionalDeclarationValue.consume, { strict: false });
const consumeVarPropertyName = withTrivia(consumeIdentToken);

// https://drafts.csswg.org/css-values-5/#long-substitution
// Bound expanded sequences before materializing them; literal input is not subject to this limit.
const MAX_SUBSTITUTED_TOKENS = 65536;

const ARBITRARY_SUBSTITUTION_FUNCTION_NAMES = new Set([
  'var',
  'attr',
  'env',
  'if',
  'inherit',
  'ident',
  'random-item',
]);
