import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    schema: [{
      type: 'object',
      properties: {
        unrestrictedSubsystems: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        entryPoints: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
      additionalProperties: false,
    }],
    messages: {
      entryPoint: 'Import through {{entries}} when crossing into {{subsystem}}.',
    },
  },
  create(context) {
    const { entryPoints = {}, unrestrictedSubsystems = [] } = context.options[0] ?? {};
    const owners = Object.keys(entryPoints).sort((a, b) => b.length - a.length);
    const importer = ownerOf(relative(sourceRoot, context.filename).split(sep).join('/'));
    if (importer === '..') return {};

    function ownerOf(path) {
      return owners.find((owner) => path.startsWith(`${owner}/`)) ?? path.split('/')[0];
    }

    return {
      'ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType'(node) {
        const source = node.source;
        if (typeof source?.value !== 'string' || !source.value.startsWith('.')) return;
        const target = resolve(dirname(context.filename), source.value);
        const path = relative(sourceRoot, target).split(sep).join('/');
        const subsystem = ownerOf(path);
        if (subsystem === importer || subsystem === '..' || unrestrictedSubsystems.includes(subsystem.split('/')[0])) return;
        const entries = entryPoints[subsystem] ?? ['index'];
        const entry = path.slice(subsystem.length + 1).replace(/\.(js|ts|mjs|cjs|mts|cts)$/, '');
        if (entries.includes(entry)) return;
        context.report({
          node: source,
          messageId: 'entryPoint',
          data: { subsystem, entries: entries.map((entry) => `${subsystem}/${entry}`).join(' or ') },
        });
      },
    };
  },
};

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
