import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// A reviewed dependency order, not a description inferred from today's imports.
// Rows run from foundations to consumers. Different components on one row are
// independent: an import between them still needs review. Only one component's
// own modules are treated as mutually cooperating peers.
// Entries name folders and end in '/'. Top-level files belong to their containing
// component; shared code gets a narrower folder only when it needs a separate layer.
export const layers = [
  ['infra/'],
  ['js-engine/', 'web-idl/core/', 'url/core/'],
  ['timing/'],
  ['web-idl/assembly/'],
  ['web-idl/values/'],
  ['web-idl/converters/'],
  ['web-idl/binding/'],
  ['web-idl/'],
  ['streams/', 'selectlet/'],
  ['encoding/'],
  ['url/'],
  ['permissions/'],
  ['http/', 'storage/'],
  ['mime/'],
  ['file/'],
  ['xhr/'],
  ['fetch/'],
  ['stylelet/syntax/'],
  ['stylelet/value-processing/'],
  ['stylelet/values/numeric-literal/', 'stylelet/values/collections/'],
  ['stylelet/values/'],
  ['stylelet/conditional/'],
  ['stylelet/props/'],
  ['stylelet/props/built-in/'],
  ['stylelet/selector/'],
  ['stylelet/cssom/declarations/', 'stylelet/cssom/media/'],
  ['stylelet/cssom/typed/'],
  ['stylelet/cssom/rules/'],
  ['stylelet/cssom/'],
  ['stylelet/engine/'],
  ['stylelet/'],
  ['browlet/dom/infra/', 'browlet/dom/nodes/element-definitions/', 'browlet/style/', 'browlet/webassembly/'],
  ['browlet/html/microsyntaxes/', 'browlet/dom/lists/'],
  ['browlet/dom/nodes/html/attributes/'],
  // HTML handlers use DOM's host-neutral listener values and dispatch metadata.
  ['browlet/dom/events/'],
  ['browlet/scripting/'],
  // Policy consumes event/report primitives; documents construct and retain policy state.
  ['browlet/reporting/'],
  // DataTransfer owns data and typed Element references; event payloads can consume it.
  ['browlet/interaction/drag-drop/'],
  // Feature event payloads can serve Document's legacy factory without loading their producers.
  ['browlet/storage/events/', 'browlet/browsing/navigation/events/', 'browlet/interaction/events/'],
  // Clipboard data/notification algorithms use lower event/task primitives and type-only Document references.
  ['browlet/interaction/clipboard/'],
  // Document owns mouse/wheel input state; these foundations use event primitives and typed nodes only.
  ['browlet/interaction/mouse/legacy/', 'browlet/interaction/wheel/'],
  // Policy owns the source-expression algorithms shared with its CSP implementation.
  ['browlet/browsing/policy/'],
  ['browlet/browsing/policy/csp/'],
  ['browlet/browsing/policy/trusted-types/'],
  // Mutation participants retain typed nodes without loading their implementation classes.
  ['browlet/dom/ranges/', 'browlet/dom/traversal/', 'browlet/dom/intersection-observer/'],
  // Selection owns a live Range and retains only typed Document/node references.
  ['browlet/interaction/selection/'],
  // HTML reflection reuses DOM operations through supplied nodes, without loading their classes.
  ['browlet/html/reflection/'],
  // Documents own History state; History queries Document/navigation through retained types.
  ['browlet/browsing/history/'],
  // Collected navigation diagnostics are consumed by Document and Performance without loading navigation.
  ['browlet/browsing/navigation/diagnostics/'],
  ['browlet/dom/abort/', 'browlet/dom/nodes/'],
  ['browlet/dom/', 'browlet/performance/', 'browlet/navigator/'],
  ['browlet/communication/', 'browlet/storage/'],
  // Shared snapshots and history-record operations do not load the navigation coordinator.
  ['browlet/browsing/navigation/state/'],
  // Window owns its Navigation object; the API retains navigation and Document types without loading the loader.
  ['browlet/browsing/navigation/api/'],
  // Window forwards messaging to communication; communication retains Window types only.
  ['browlet/browsing/window/'],
  // Origin declarations name the platform implementations; environments dispatch their extraction.
  ['browlet/browsing/'],
  // Browser settings compose the lower facilities.
  ['browlet/environment/'],
  ['browlet/html/parser/', 'browlet/scripting/structured-data/'],
  ['browlet/html/', 'browlet/workers/', 'browlet/automation/'],
  // Navigation composes resource consumption with document creation and parsing.
  ['browlet/loader/'],
  ['browlet/browsing/navigation/'],
  // Pointer state and lock controllers precede the mouse delivery coordinator.
  ['browlet/interaction/pointer/', 'browlet/interaction/pointer-lock/', 'browlet/interaction/keyboard/'],
  ['browlet/interaction/mouse/'],
  ['browlet/interaction/'],
  // Rendering owns document-bound transitions and their eventual presentation lifecycle.
  ['browlet/rendering/'],
  // Host and feature adapters do not discover Web IDL composition.
  ['browlet/integration/host/', 'browlet/integration/xhr/', 'browlet/integration/permissions/'],
  ['browlet/integration/file/'],
  ['browlet/integration/'],
  // HTML binding hooks consume implementations; composition assembles their world and environments.
  ['browlet/integration/web-idl/bindings/'],
  ['browlet/integration/web-idl/'],
  ['browlet/'],
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

/** Find the most specific owning folder, including an import of the folder itself. */
export function componentFor(path) {
  if (path === undefined) return undefined;
  return bySpecificity.find(({ id }) => path.startsWith(id) || path === id.slice(0, -1));
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
  const foundation = ['infra/', 'js-engine/', 'web-idl/core/', 'url/core/'].includes(target.id);
  return { group: sibling && !foundation ? 2 : 1, order: components.indexOf(target) };
}
