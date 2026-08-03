import { asciiLower } from '../../shared/css';
import { withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import {
  BlockKind, parseAsComponentGrammar, parseListOfComponentValues,
  type ComponentValue, type ParserInput,
} from '../parser/syntax';
import type { ValueStage } from '../value-processing';
import { tryConsumeCssWideValue, type CssWideValue } from './css-wide';
import { parseDeclarationValue } from './declaration-value';
import { createSubstitutionValue, type SubstitutionValue } from './substitution-value';
import { createWholeValueConsumer, type WholeValue } from './whole-value';

export type PropertyValue<Value, Context = unknown> =
  | WholeValue<Value, Context>
  | SubstitutionValue<Value, Context>
  | CssWideValue<Value, Context>;

export type Property<Value, Context = unknown> = {
  parse: (input: ParserInput) => PropertyValue<Value, Context> | null;
  tryConsume: TryComponentConsumer<PropertyValue<Value, Context>>;
};

export function defineProperty<Value, Context = unknown>(definition: {
  tryConsume: TryComponentConsumer<Value>;
  resolve: (value: Value, stage: ValueStage, context: Context) => Value;
  serialize: (value: Value) => string;
}): Property<Value, Context> {
  const tryConsume = createWholeValueConsumer(
    definition.tryConsume,
    definition.resolve,
    definition.serialize,
  );

  return {
    parse: (input) => parsePropertyValue(input, tryConsume),
    tryConsume,
  };
}

function parsePropertyValue<Value, Context>(
  input: ParserInput,
  tryConsumeWholeValue: TryComponentConsumer<WholeValue<Value, Context>>,
): PropertyValue<Value, Context> | null {
  const components = parseListOfComponentValues(input);

  if (containsArbitrarySubstitutionFunction(components)) {
    const declaration = parseDeclarationValue(components);
    return declaration === null
      ? null
      : createSubstitutionValue<Value, Context>(declaration);
  }

  const cssWide = parseAsComponentGrammar(
    components,
    withTrivia(tryConsumeCssWideValue<Value, Context>),
  );

  if (cssWide !== null) {
    return cssWide;
  }

  return parseAsComponentGrammar(components, withTrivia(tryConsumeWholeValue));
}

const ARBITRARY_SUBSTITUTION_FUNCTION_NAMES = new Set([
  'var',
  'attr',
  'env',
  'if',
  'inherit',
  'random-item',
]);

function containsArbitrarySubstitutionFunction(
  components: readonly ComponentValue[],
): boolean {
  for (const component of components) {
    if (component.type !== 'block') continue;

    if (component.block === BlockKind.Function) {
      const name = asciiLower(component.name);

      if (
        name.startsWith('--') ||
        ARBITRARY_SUBSTITUTION_FUNCTION_NAMES.has(name)
      ) {
        return true;
      }
    }

    if (containsArbitrarySubstitutionFunction(component.value)) {
      return true;
    }
  }

  return false;
}
