import { consumeIdentToken } from '../syntax/component-consumers';
import { serializeCssIdentifier } from '../syntax/component-value';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { adaptConsumer, withTrivia } from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';

/*
 * <ident> = <ident-token>
 */

export type IdentValue = {
  type: 'ident';
  value: string;
};

export function parseIdent(
  input: ParserInput,
  context: unknown = undefined,
): IdentValue | null {
  return identParser(input, context);
}

export function consumeIdent(
  c: ComponentCursor,
): TryComponentConsumerResult<IdentValue> {
  return identConsumer(c);
}

export function serializeIdent(value: IdentValue): string {
  return serializeCssIdentifier(value.value);
}

// <ident> = <ident-token>
const identConsumer: TryComponentConsumer<IdentValue> = adaptConsumer(
  consumeIdentToken,
  (token) => ({
    type: 'ident',
    value: token.value,
  }),
);

const identParser = createComponentParser(withTrivia(identConsumer));
