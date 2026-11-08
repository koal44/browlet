import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sourcePath } from './import-hierarchy.mjs';

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
// TypeScript replaces its Program snapshot after edits. Cache per snapshot,
// without retaining retired editor programs or rechecking the graph per file.
const analyses = new WeakMap();

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      cycle: 'Runtime import cycle: {{path}}',
    },
  },
  create(context) {
    const program = context.sourceCode.parserServices.program;
    // Syntax-only lint configurations have no project graph. The ordinary
    // type-aware configuration and the unit guard both check the complete graph.
    if (!program) return {};
    return {
      Program() {
        let analysis = analyses.get(program);
        if (!analysis) {
          analysis = findImportCycles(program.getSourceFiles(), sourceRoot, program.getCompilerOptions());
          analyses.set(program, analysis);
        }
        const file = program.getSourceFile(context.filename);
        for (const { specifier, cycle } of analysis.imports.get(file?.fileName) ?? []) {
          context.report({
            loc: {
              start: context.sourceCode.getLocFromIndex(specifier.getStart(file)),
              end: context.sourceCode.getLocFromIndex(specifier.getEnd()),
            },
            messageId: 'cycle',
            data: { path: cycle.map(node => sourcePath(node.fileName)).join(' -> ') },
          });
        }
      },
    };
  },
};

/**
 * Find cycles among source modules, including imports through barrels.
 * Type-only declarations are excluded; other imports declare runtime dependencies.
 * Each cyclic import carries a shortest return path for its diagnostic.
 */
export function findImportCycles(sourceFiles, sourceRoot, options = {}) {
  const canonical = (filename) => ts.sys.useCaseSensitiveFileNames ? resolve(filename) : resolve(filename).toLowerCase();
  const withinRoot = (filename) => {
    const path = relative(sourceRoot, filename);
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
  };
  const files = new Map(sourceFiles.map(file => [canonical(file.fileName), file]));
  const host = {
    fileExists: filename => files.has(canonical(filename)) || ts.sys.fileExists(filename),
    readFile: filename => files.get(canonical(filename))?.text ?? ts.sys.readFile(filename),
  };
  const cache = ts.createModuleResolutionCache(sourceRoot, canonical, options);
  const graph = new Map();
  const pending = sourceFiles.filter(file => !file.isDeclarationFile && withinRoot(file.fileName));

  // Follow every local runtime dependency, even if a project reference caused
  // the caller's TypeScript program to include its declaration output instead.
  for (const file of pending) {
    if (graph.has(file)) continue;
    const edges = [];
    graph.set(file, edges);
    for (const specifier of runtimeImports(file, options)) {
      const resolved = ts.resolveModuleName(specifier.text, file.fileName, options, host, cache).resolvedModule;
      if (!resolved) {
        if (specifier.text.startsWith('.')) {
          throw new Error(`Cannot resolve runtime import "${specifier.text}" in ${file.fileName}`);
        }
        continue;
      }
      if (!withinRoot(resolved.resolvedFileName)) continue;
      const key = canonical(resolved.resolvedFileName);
      let target = files.get(key);
      if (!target) {
        const text = host.readFile(resolved.resolvedFileName);
        if (text === undefined) throw new Error(`Cannot read ${resolved.resolvedFileName}`);
        target = ts.createSourceFile(resolved.resolvedFileName, text, ts.ScriptTarget.Latest);
        files.set(key, target);
      }
      if (target.isDeclarationFile) continue;
      edges.push({ specifier, target });
      pending.push(target);
    }
  }

  const imports = new Map();
  const paths = new Map();
  for (const component of cyclicComponents(graph)) {
    for (const file of component) {
      const findings = [];
      for (const { specifier, target } of graph.get(file)) {
        if (!component.has(target)) continue;
        const cycle = [file, ...returnPath(target, file, graph, component)];
        findings.push({ specifier, cycle });
        // A cycle has no distinguished first module. Deduplicate its rotations.
        const names = cycle.slice(0, -1).map(node => relative(sourceRoot, node.fileName).split(sep).join('/'));
        const first = names.indexOf([...names].sort()[0]);
        const rotated = [...names.slice(first), ...names.slice(0, first)];
        paths.set(rotated.join(' -> '), [...rotated, rotated[0]]);
      }
      imports.set(file.fileName, findings);
    }
  }
  return { imports, cycles: [...paths].sort(([a], [b]) => a.localeCompare(b)).map(([, cycle]) => cycle) };
}

function runtimeImports(file, options) {
  const imports = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) return;
      if (!options.verbatimModuleSyntax && clause && !clause.name &&
          clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every(item => item.isTypeOnly)) return;
      imports.push(node.moduleSpecifier);
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly) return;
      if (!options.verbatimModuleSyntax && node.exportClause && ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.every(item => item.isTypeOnly)) return;
      imports.push(node.moduleSpecifier);
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        imports.push(node.moduleReference.expression);
      }
      return;
    }
    if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require')
    )) {
      const [specifier] = node.arguments;
      // Computed module names cannot be resolved by a static dependency check.
      if (specifier && ts.isStringLiteralLike(specifier)) imports.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return imports;
}

// Tarjan's algorithm finds mutually reachable groups without a depth limit.
// Only edges inside those groups need a return-path search.
function cyclicComponents(graph) {
  const states = new Map();
  const stack = [];
  const components = [];
  const visit = (file) => {
    const state = { index: states.size, low: states.size, active: true };
    states.set(file, state);
    stack.push(file);
    for (const { target } of graph.get(file)) {
      const next = states.get(target);
      if (!next) {
        visit(target);
        state.low = Math.min(state.low, states.get(target).low);
      } else if (next.active) {
        state.low = Math.min(state.low, next.index);
      }
    }
    if (state.low !== state.index) return;
    const component = new Set();
    let member;
    do {
      member = stack.pop();
      states.get(member).active = false;
      component.add(member);
    } while (member !== file);
    if (component.size > 1 || graph.get(file).some(edge => edge.target === file)) components.push(component);
  };
  for (const file of graph.keys()) if (!states.has(file)) visit(file);
  return components;
}

function returnPath(start, destination, graph, component) {
  const queue = [start];
  const previous = new Map([[start, undefined]]);
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index];
    if (file === destination) {
      const path = [];
      for (let node = file; node !== undefined; node = previous.get(node)) path.unshift(node);
      return path;
    }
    for (const { target } of graph.get(file)) {
      if (!component.has(target) || previous.has(target)) continue;
      previous.set(target, file);
      queue.push(target);
    }
  }
  throw new Error('A cyclic import has no return path');
}
