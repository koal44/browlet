import type { ComponentCursor } from '../parser/component-cursor';
import { ok, unwrapConsumeResultOrThrow, type TryComponentConsumerResult } from '../parser/component-try-consumer';
import {
  isFunctionBlock, isParensBlock, parseAsComponentGrammar,
  type FunctionBlock, type ParensBlock, type ParserInput,
} from '../parser/syntax';
import { withTrivia } from '../parser/component-grammar';
import { parseAnyValue, type AnyValue } from './any-value';

export type GeneralEnclosedValue = {
  type: 'general-enclosed';
  value: GeneralEnclosedBlock;
};

export type GeneralEnclosedBlock =
  | FunctionBlock<AnyValue | undefined>
  | ParensBlock<AnyValue | undefined>;

export function parseGeneralEnclosed(input: ParserInput): GeneralEnclosedValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, withTrivia(tryConsumeGeneralEnclosed)),
    '<general-enclosed>',
  );
}

/*
 * <general-enclosed> =
 *   [ <function-token> <any-value>? ) ] |
 *   [ ( <any-value>? ) ]
 *
 * CSS Syntax represents these alternatives as function and parentheses blocks.
 */
export function tryConsumeGeneralEnclosed(
  c: ComponentCursor,
): TryComponentConsumerResult<GeneralEnclosedValue> {
  const start = c.pos();
  const component = c.next();

  if (!isFunctionBlock(component) && !isParensBlock(component)) {
    c.restore(start);
    return null;
  }

  const value = component.value.length === 0
    ? undefined
    : parseAnyValue(component.value);

  if (value === null) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'general-enclosed',
    value: {
      ...component,
      value,
    },
  });
}
