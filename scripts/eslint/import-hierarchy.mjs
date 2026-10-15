import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// A reviewed dependency order, not a description inferred from today's imports.
// Rows run from foundations to consumers. Different components on one row are
// independent: an import between them still needs review. Only one component's
// own modules are treated as mutually cooperating peers.
export const layers = [
  ['infra'],
  ['js-engine', 'web-idl/core', 'encoding/core'],
  ['web-idl/environment', 'web-idl/compiler'],
  ['web-idl/assembly'],
  ['web-idl/binding/platform'],
  ['web-idl/values'],
  ['web-idl/converters'],
  ['web-idl/binding'],
  ['web-idl/generate'],
  ['web-idl'],
  ['streams', 'selectlet', 'stylelet'],
  ['encoding'],
  ['url'],
  ['http', 'storage'],
  ['mime'],
  ['file'],
  ['xhr'],
  ['fetch'],
  ['browlet/platform', 'browlet/timing', 'browlet/dom/infra', 'browlet/style'],
  ['browlet/html/microsyntaxes'],
  ['browlet/dom/nodes/html/attributes'],
  ['browlet/scripting'],
  // Policy consumes event/report primitives; documents construct and retain policy state.
  ['browlet/dom/events', 'browlet/reporting'],
  ['browlet/browsing/policy'],
  ['browlet/browsing/policy/csp'],
  ['browlet/browsing/policy/trusted-types'],
  // Mutation participants retain typed nodes without loading their implementation classes.
  ['browlet/dom/ranges', 'browlet/dom/traversal', 'browlet/dom/token-list', 'browlet/dom/intersection-observer'],
  // HTML reflection reuses DOM operations through supplied nodes, without loading their classes.
  ['browlet/html/reflection'],
  ['browlet/dom/abort', 'browlet/dom/nodes'],
  ['browlet/dom', 'browlet/performance'],
  ['browlet/reporting/generate'],
  // Full browser settings and global APIs compose the lower facilities.
  ['browlet/environment', 'browlet/global-scope'],
  ['browlet/html/parser', 'browlet/scripting/structured-data'],
  ['browlet/html', 'browlet/browsing/window', 'browlet/workers', 'browlet/automation'],
  // Navigation composes resource consumption with document creation and parsing.
  ['browlet/loader'],
  ['browlet/browsing/navigation'],
  ['browlet/integration/network', 'browlet/integration/xhr', 'browlet/integration/web-idl'],
  ['browlet/integration/file'],
  ['browlet/integration'],
  ['browlet/bindings'],
  ['browlet/user-agent'],
  ['browlet'],
];

// DOM's node/element family and Web IDL's realm binding components were already
// reviewed as cooperating implementations; their nested barrels are entry points,
// not an assertion that every subfolder is a separate dependency layer.
const components = layers.flatMap((ids, level) => ids.map((id) => ({ id, level })));
const bySpecificity = [...components].sort((a, b) => b.id.length - a.id.length);
const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source-relative module path, independent of relative import spelling. */
export function sourcePath(filename) {
  const path = relative(sourceRoot, filename).split(sep).join('/');
  return isAbsolute(path) || path === '..' || path.startsWith('../') ? undefined : path;
}

/** Find the most specific named owner; a standalone module can be an owner too. */
export function componentFor(path) {
  if (path === undefined) return undefined;
  const module = path.replace(/(?:\.d)?\.(?:[cm]?[jt]s|tsx)$/, '').replace(/\/index$/, '');
  return bySpecificity.find(({ id }) => module === id || module.startsWith(`${id}/`));
}

export function importedPath(filename, specifier) {
  return specifier.startsWith('.') ? sourcePath(resolve(dirname(filename), specifier)) : undefined;
}

/** Recognize explicitly type-only references so direction checks can ignore them. */
export function isTypeOnly(node) {
  if (node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type') return true;
  if (node.type === 'TSExternalModuleReference' && node.parent.importKind === 'type') return true;
  return node.specifiers?.length > 0 && node.specifiers.every((item) =>
    item.importKind === 'type' || item.exportKind === 'type');
}

/** External dependencies, other subsystems/foundations, sibling owners, local collaborators. */
export function importPosition(filename, node) {
  const targetPath = importedPath(filename, node.source.value);
  const target = componentFor(targetPath);
  const owner = componentFor(sourcePath(filename));
  if (!target) return { group: 0, order: 0 };
  if (target === owner) return { group: 3, order: 0 };
  const sibling = target.id.split('/')[0] === owner?.id.split('/')[0];
  const foundation = ['infra', 'js-engine', 'web-idl/core', 'encoding/core'].includes(target.id);
  return { group: sibling && !foundation ? 2 : 1, order: components.indexOf(target) };
}
