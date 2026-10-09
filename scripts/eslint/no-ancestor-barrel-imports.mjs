import { dirname, posix, relative, resolve, sep } from 'node:path';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      ancestorBarrel: 'Do not import the current or an ancestor barrel ({{source}}); make the dependency\'s owner explicit.',
    },
  },
  create(context) {
    const directory = dirname(context.filename);

    function checkSource(source) {
      if (typeof source?.value !== 'string' || !/^\.\.?(?:\/|$)/.test(source.value)) return;
      const target = relative(directory, resolve(directory, source.value)).split(sep).join('/');
      // Include implicit directory imports and normalize paths that leave and
      // re-enter the same component before reaching its barrel.
      const implicitDirectory = /^(?:\.\.\/)*\.{1,2}\/?$/.test(posix.normalize(source.value));
      const ancestorBarrel = /^(?:\.\.\/)*index(?:\.(?:[cm]?[jt]s|[jt]sx))?$/.test(target);
      if (!implicitDirectory && !ancestorBarrel) return;
      context.report({ node: source, messageId: 'ancestorBarrel', data: { source: source.value } });
    }

    return {
      'ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType'(node) {
        checkSource(node.source);
      },
      TSExternalModuleReference(node) {
        checkSource(node.expression);
      },
      'CallExpression[callee.name="require"]'(node) {
        checkSource(node.arguments[0]);
      },
    };
  },
};
