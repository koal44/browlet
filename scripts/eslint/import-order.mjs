import { componentFor, importPosition, sourcePath } from './import-hierarchy.mjs';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    fixable: 'code',
    schema: [],
    messages: {
      order: 'Order imports from foundations to consumers, then local collaborators, using the project component map.',
      commented: 'Order imports from foundations to consumers; comments require a manual rearrangement to preserve their attachment.',
      spacing: 'Use one blank line between import groups and none within a group.',
    },
  },
  create(context) {
    if (!componentFor(sourcePath(context.filename))) return {};
    const code = context.sourceCode;

    return {
      Program(node) {
        let block = [];
        for (const statement of node.body) {
          // Explicit side-effect imports and executable statements are barriers.
          if (statement.type !== 'ImportDeclaration' || statement.specifiers.length === 0) {
            check(block);
            block = [];
            continue;
          }
          block.push(statement);
        }
        check(block);
      },
    };

    function check(block) {
      if (block.length < 2) return;
      const entries = block.map((node) => ({ node, ...importPosition(context.filename, node) }));
      const sorted = [...entries].sort((a, b) => a.group - b.group || a.order - b.order);
      const reordered = sorted.some((entry, i) => entry !== entries[i]);
      const newline = code.text.includes('\r\n') ? '\r\n' : '\n';
      const gaps = entries.slice(1).map((entry, i) => code.text.slice(entries[i].node.range[1], entry.node.range[0]));
      const spaced = gaps.every((gap, i) => /\S/.test(gap) ||
        gap === newline.repeat(entries[i].group === entries[i + 1].group ? 1 : 2));
      if (!reordered && spaced) return;
      const commented = code.getCommentsBefore(block[0]).length > 0 || gaps.some((gap) => /\S/.test(gap)) ||
        code.getCommentsAfter(block.at(-1)).some((comment) => comment.loc.start.line === block.at(-1).loc.end.line);
      if (commented) {
        context.report({ node: block[0], messageId: 'commented' });
        return;
      }
      const output = sorted.map((entry, i) =>
        (i === 0 ? '' : newline.repeat(entry.group === sorted[i - 1].group ? 1 : 2)) + code.getText(entry.node)
      ).join('');
      const range = [block[0].range[0], block.at(-1).range[1]];
      context.report({
        node: block[0],
        messageId: reordered ? 'order' : 'spacing',
        fix: (fixer) => fixer.replaceTextRange(range, output),
      });
    }
  },
};
