'use strict';

// Wasm ESM over V8's existing source-text and synthetic modules. The generated
// source supplies graph ordering and bindings; the private leaf instantiates
// Wasm only when V8 evaluates it. This is not a second host module record.
module.exports = native => {
  const contexts = new WeakMap();

  function captureIntrinsics(context) {
    contexts.set(context, native.evaluate(`({
      Module: WebAssembly.Module, Instance: WebAssembly.Instance,
      imports: WebAssembly.Module.imports, exports: WebAssembly.Module.exports,
      instanceExports: Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports').get,
      globalValue: Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, 'value').get,
      LinkError: WebAssembly.LinkError, TypeError,
    })`, context, 'node-compat:wasm-intrinsics', 0));
  }

  function compile(bytes, context) {
    const intrinsics = contexts.get(context);
    if (intrinsics === undefined) throw new TypeError('Expected a compatibility context');
    const source = new intrinsics.Module(bytes, {
      builtins: ['js-string'], importedStringConstants: 'wasm:js/string-constants',
    });
    const imports = intrinsics.imports(source);
    const exports = intrinsics.exports(source);
    const specifiers = [...new Set(imports.map(entry => entry.module))];
    for (const entry of imports) {
      if (entry.module.startsWith('wasm-js:') || reserved(entry.name)) {
        throw new intrinsics.LinkError(`Reserved Wasm import: ${entry.module} / ${entry.name}`);
      }
    }
    for (const entry of exports) {
      if (reserved(entry.name)) throw new intrinsics.LinkError(`Reserved Wasm export: ${entry.name}`);
    }
    let helperSpecifier = 'browlet:wasm-instantiate';
    while (specifiers.includes(helperSpecifier)) helperSpecifier += ':';
    const quote = JSON.stringify;
    const lines = specifiers.map((name, i) => `import * as $n${i} from ${quote(name)};`);
    // Named imports make V8 reject missing/ambiguous exports during linking.
    imports.forEach((entry, i) => lines.push(
      `import { ${quote(entry.name)} as $i${i} } from ${quote(entry.module)};`));
    lines.push(`import $instantiate from ${quote(helperSpecifier)};`,
      `const $values = $instantiate([${specifiers.map((_, i) => `$n${i}`).join(',')}]);`);
    exports.forEach((entry, i) => lines.push(
      `const $e${i} = $values[${quote(entry.name)}]; export { $e${i} as ${quote(entry.name)} };`));
    const record = { source, specifiers, sourceText: lines.join('\n'), dependencies: [], instance: undefined };

    record.instantiate = namespaces => {
      const importObject = Object.create(null);
      for (let i = 0; i < specifiers.length; ++i) {
        const dependency = record.dependencies[i];
        if (dependency !== undefined) {
          if (dependency.instance === undefined) throw new intrinsics.LinkError('Wasm dependency has not executed');
          importObject[specifiers[i]] = dependency.exports;
        } else {
          importObject[specifiers[i]] = namespaces[i];
        }
      }
      record.instance = new intrinsics.Instance(source, importObject);
      record.exports = Reflect.apply(intrinsics.instanceExports, record.instance, []);
      const values = Object.create(null);
      for (const entry of exports) {
        const value = record.exports[entry.name];
        if (entry.kind !== 'global') {
          values[entry.name] = value;
          continue;
        }
        // TODO(wasm-bindings): The draft requires live mutable globals and a
        // permanently uninitialized v128 binding. Node has the same limits;
        // preserve the specification expectations in wasm-gaps.test.cjs.
        try { values[entry.name] = Reflect.apply(intrinsics.globalValue, value, []); }
        catch (error) {
          if (!(error instanceof intrinsics.TypeError)) throw error;
        }
      }
      return values;
    };
    return record;
  }

  return { captureIntrinsics, compile };
};

function reserved(name) {
  return name.startsWith('wasm:') || name.startsWith('wasm-js:');
}
