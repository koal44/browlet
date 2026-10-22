import { describe, expect, it } from 'vitest';

import {
  adaptConsumer, allOf, any, commaRepeat, one, oneOf, opt, plus, recursive, repeat,
  required, requiredAllOf, requiredSequenceOf, requiredSomeOf, sequenceOf, someOf, withTrivia,
} from '../../../../src/stylelet/syntax/component-grammar';
import { consumeIdentToken, createFreeFormConsumer, createFunctionalNotationConsumer } from '../../../../src/stylelet/syntax/component-consumers';
import type { ComponentValue } from '../../../../src/stylelet/syntax/component-value';
import { createComponentParser, parseAsComponentGrammar, parseListAsComponentGrammar } from '../../../../src/stylelet/syntax/parser';
import { TokenCursor, type TryConsumer } from '../../../../src/stylelet/syntax/token-cursor';
import { TokenList } from '../../../../src/stylelet/syntax/token-list';
import { parseSelectorList } from '../../../../src/stylelet/selector/parser';
import { InterpretedDeclaration } from '../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import type { RuleListContext } from '../../../../src/stylelet/cssom/rules/context';

type NameContext = { name: string; };
type CountContext = { count: number; };

const consumeName = adaptConsumer(consumeIdentToken, (token, context: NameContext) =>
  `${context.name}:${token.value}`,
);
const consumeCount = adaptConsumer(consumeIdentToken, (_token, context: CountContext) => context.count);

describe('typed parsing contexts', () => {
  it('shares a context across grammars with different requirements', () => {
    const context = { name: 'parent', count: 3 };
    const consume = sequenceOf(
      [
        one(consumeName, { contextAfter: (_value, selected) => ({ ...selected, name: 'updated' }) }),
        one(withTrivia(consumeCount)),
      ],
      ([[name], [count]], selected) => ({ name, count, selectedName: selected.name }),
    );

    expect(parseAsComponentGrammar('first second', consume, context))
      .toEqual({ name: 'parent:first', count: 3, selectedName: 'updated' });
    expect(context.name).toBe('parent');
  });

  it('selects a different argument context and projects with the outer context', () => {
    const outer = { name: 'outer' };
    const consume = createFunctionalNotationConsumer(
      'example',
      consumeCount,
      (count, context: NameContext) => `${context.name}:${count}`,
      { contextForArguments: (context: NameContext): CountContext => ({ count: context.name.length }) },
    );
    const c = new TokenCursor(TokenList.tokenize('example(value)'), outer);

    expect(parseAsComponentGrammar(c, consume, outer)).toBe('outer:5');
    expect(c.context).toBe(outer);
  });

  it('restores the caller context when a typed argument consumer throws', () => {
    const caller = { caller: true };
    const c = new TokenCursor(TokenList.tokenize('example(value)'), caller);
    const consume = createFunctionalNotationConsumer(
      'example',
      (inner: TokenCursor<ComponentValue, CountContext>): never => {
        expect(inner.context.count).toBe(5);
        throw new Error('argument failed');
      },
      (value, _context: NameContext) => value,
      { contextForArguments: (context: NameContext): CountContext => ({ count: context.name.length }) },
    );

    expect(() => parseAsComponentGrammar(c, consume, { name: 'outer' }))
      .toThrow('argument failed');
    expect(c.context).toBe(caller);
  });
});

/** Compile-time checks: every shared adapter must retain its consumer's requirements. */
export function checkParserContextContracts(ruleContext: RuleListContext): void {
  const parseName = createComponentParser(consumeName);
  parseName('value', { name: 'valid' });
  // @ts-expect-error A parser must reject a context that cannot satisfy its consumer.
  parseName('value', { count: 1 });
  // @ts-expect-error The selected context must satisfy the grammar, even for cursor input.
  parseAsComponentGrammar(new TokenCursor(TokenList.tokenize('value'), { name: 'old' }), consumeName, {});
  // @ts-expect-error List parsing retains the same requirement.
  parseListAsComponentGrammar('one, two', consumeName, {});

  const adapters = [
    withTrivia(consumeName), adaptConsumer(consumeName, (value) => value),
    required(consumeName, 'name'), createFreeFormConsumer(consumeName),
    one(consumeName), opt(consumeName), any(consumeName), plus(consumeName),
    repeat(consumeName, 1, 2), commaRepeat(consumeName),
    recursive<string, NameContext>(() => consumeName),
  ];
  for (const consume of adapters) {
    // @ts-expect-error Adapters cannot silently widen their context to unknown.
    parseAsComponentGrammar('value', consume, {});
  }

  for (const compose of [sequenceOf, requiredSequenceOf, allOf, requiredAllOf, someOf, requiredSomeOf, oneOf]) {
    const parts = [one(consumeName), one(consumeCount)];
    const consume = compose(parts, (values) => values);
    parseAsComponentGrammar('one two', consume, { name: 'valid', count: 1 });
    // @ts-expect-error A composed grammar must require both contexts, including for an array of productions.
    parseAsComponentGrammar('one two', consume, { name: 'missing count' });
  }

  one(consumeName, {
    // @ts-expect-error A local update must preserve requirements supplied for sibling productions.
    contextAfter: () => ({ name: 'discarded the rest of the context' }),
  });

  // The same rule context can supply each grammar's optional settings.
  parseSelectorList('*', ruleContext);
  InterpretedDeclaration.parseBlock('color: red', ruleContext);

  const needsCount: TryConsumer<number, CountContext> = consumeCount;
  // @ts-expect-error The selected child context must satisfy the argument consumer.
  createFunctionalNotationConsumer('example', needsCount, (value) => value, { contextForArguments: (_context: NameContext) => ({ count: 'wrong' }) });
}
