/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    schema: [],
    messages: {
      argument: 'Start this declaration argument on its own indented line.',
      closing: 'Close the declaration call on its own line.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    const references = new Map();

    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type !== 'ImportDeclaration' ||
              !/\/web-idl\/(?:core\/)?index(?:\.js)?$/.test(statement.source.value)) continue;
          for (const variable of source.getDeclaredVariables(statement)) {
            const definition = variable.defs[0].node;
            if (definition.type !== 'ImportSpecifier' ||
                !['op', 'staticOp', 'ctor'].includes(definition.imported.name)) continue;
            const headerLength = definition.imported.name === 'ctor' ? 0 : 2;
            for (const reference of variable.references) references.set(reference.identifier, headerLength);
          }
        }
      },
      CallExpression(node) {
        const headerLength = references.get(node.callee);
        if (headerLength === undefined || node.arguments.length < headerLength + 2) return;

        // Operations have a name/type header; constructors start with their
        // argument list. The indent rule supplies spacing for each group.
        const groups = node.arguments.slice(headerLength);
        if (!groups.some((argument) => argument.loc.start.line !== argument.loc.end.line)) return;

        for (let index = headerLength; index < node.arguments.length; index++) {
          const argument = node.arguments[index];
          const previous = node.arguments[index - 1] ?? node.callee;
          if (argument.loc.start.line === previous.loc.end.line) {
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
