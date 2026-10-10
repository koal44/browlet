import { componentFor, importedPath, isTypeOnly, sourcePath } from './import-hierarchy.mjs';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      upward: 'Runtime dependency from {{owner}} to higher component {{target}}; review ownership or the proposed layer.',
      peer: 'Runtime dependency from {{owner}} to independent component {{target}} on the same layer; review their relationship.',
      unmapped: 'No import-hierarchy component owns {{path}}; name its place in scripts/eslint/import-hierarchy.mjs.',
    },
  },
  create(context) {
    const path = sourcePath(context.filename);
    if (path === undefined) return {};
    const owner = componentFor(path);
    if (!owner) return { Program(node) { context.report({ node, messageId: 'unmapped', data: { path } }); } };

    function check(node, source) {
      if (isTypeOnly(node) || typeof source?.value !== 'string') return;
      const targetPath = importedPath(context.filename, source.value);
      if (targetPath === undefined) return;
      const target = componentFor(targetPath);
      if (!target) {
        context.report({ node: source, messageId: 'unmapped', data: { path: targetPath } });
      } else if (target !== owner && target.level >= owner.level) {
        context.report({
          node: source,
          messageId: target.level === owner.level ? 'peer' : 'upward',
          data: { owner: owner.id, target: target.id },
        });
      }
    }

    return {
      'ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType'(node) {
        check(node, node.source);
      },
      TSExternalModuleReference(node) { check(node, node.expression); },
      'CallExpression[callee.name="require"]'(node) { check(node, node.arguments[0]); },
    };
  },
};
