import { resolve } from 'node:path';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    schema: [{ type: 'array', items: { type: 'string' }, uniqueItems: true }],
    messages: {
      restricted: 'Receive the incumbent through a declared Binding input; direct getIncumbentEnvironment access is restricted to the module allowlist.',
    },
  },
  create(context) {
    const allowed = context.options[0] ?? [];
    if (allowed.some((file) => resolve(context.cwd, file) === resolve(context.filename))) return {};

    function check(node, key, computed) {
      const name = key.type === 'Identifier' && !computed ? key.name
        : key.type === 'Literal' ? key.value : undefined;
      if (name === 'getIncumbentEnvironment') context.report({ node, messageId: 'restricted' });
    }

    return {
      MemberExpression(node) { check(node, node.property, node.computed); },
      Property(node) {
        if (node.parent.type === 'ObjectPattern') check(node, node.key, node.computed);
      },
    };
  },
};
