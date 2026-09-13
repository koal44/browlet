/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    schema: [],
    messages: {
      argument: 'Start this operation argument on its own indented line.',
      closing: 'Close the operation call on its own line.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    const references = new Set();

    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type !== 'ImportDeclaration' ||
              !/\/web-idl\/declaration\/index(?:\.js)?$/.test(statement.source.value)) continue;
          for (const variable of source.getDeclaredVariables(statement)) {
            const definition = variable.defs[0].node;
            if (definition.type !== 'ImportSpecifier' || definition.imported.name !== 'op') continue;
            for (const reference of variable.references) references.add(reference.identifier);
          }
        }
      },
      CallExpression(node) {
        if (!references.has(node.callee) || node.arguments.length < 4) return;

        // The name and return type form the header. Multiline argument/binding
        // groups below it each start a line; the indent rule supplies spacing.
        const groups = node.arguments.slice(2);
        if (!groups.some((argument) => argument.loc.start.line !== argument.loc.end.line)) return;

        for (let index = 2; index < node.arguments.length; index++) {
          const argument = node.arguments[index];
          if (argument.loc.start.line === node.arguments[index - 1].loc.end.line) {
            context.report({
              loc: source.getFirstToken(argument).loc,
              messageId: 'argument',
            });
          }
        }
        const closing = source.getLastToken(node);
        if (closing.loc.start.line === node.arguments.at(-1).loc.end.line) {
          context.report({ loc: closing.loc, messageId: 'closing' });
        }
      },
    };
  },
};
