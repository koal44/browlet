import {
  consumeBlock, type BlockContents, type Declaration, type Rule, type ParsingContext, type StatementAtRule,
} from '../../src/stylelet/syntax/parser';
import type { TokenCursor } from '../../src/stylelet/syntax/token-cursor';
import type { ComponentValue, Token } from '../../src/stylelet/syntax/tokens';

/** Structural grammar for Syntax tests; deliberately makes no claim about CSS validity. */
export class SyntaxParsingContext implements ParsingContext<Rule, Declaration> {
  interpretDeclaration(declaration: Declaration): Declaration | null {
    return declaration;
  }

  interpretStatementAtRule(rule: StatementAtRule, _preceding: BlockContents): Rule | null {
    return rule;
  }

  interpretBlockAtRule(
    name: string,
    prelude: ComponentValue[],
    _preceding: BlockContents,
    c: TokenCursor<Token>,
  ): Rule | null {
    const block = c.withContext(this, consumeBlock);
    return { type: 'block-at-rule', name, prelude, block };
  }

  interpretQualifiedRule(prelude: ComponentValue[], c: TokenCursor<Token>): Rule | null {
    const block = c.withContext(this, consumeBlock);
    return { type: 'qualified-rule', prelude, block };
  }
}
