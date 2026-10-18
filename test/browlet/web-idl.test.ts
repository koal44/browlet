import { expect, it } from 'vitest';

import { webIDLCommonDefinitions } from '../../src/web-idl/core/index';
import { validateDefinitions } from '../../src/web-idl/assembly/index';
import { browletDefinitions } from '../../src/browlet/bindings';
import type { BrowletEnvironment } from '../../src/browlet/environment';
import { ElementImpl } from '../../src/browlet/dom/nodes/element';
import { getElementConstructor } from '../../src/browlet/dom/nodes/element-interfaces';

it('validates the complete Web IDL declaration set used by Browlet', () => {
  expect(() => validateDefinitions<BrowletEnvironment>([
    ...webIDLCommonDefinitions, ...browletDefinitions,
  ])).not.toThrow();
});

it('declares unique element names with a namespace and an Element implementation', () => {
  const namespaces = new Map<string, Set<string>>();
  for (const definition of browletDefinitions) {
    if (definition.kind !== 'interface') continue;
    if (definition.namespaceURI === undefined && definition.localNames === undefined) continue;
    expect(definition.namespaceURI, definition.name).toBeDefined();
    const declared = definition.implementation;
    const implementations = declared ? Array.isArray(declared) ? declared : [declared] : [];
    expect(implementations.length, definition.name).toBeGreaterThan(0);
    if (implementations.length > 1) expect(definition.localNames).toBeUndefined();
    for (const { implClass } of implementations) {
      expect(implClass.prototype, definition.name).toBeInstanceOf(ElementImpl);
    }
    const namespaceURI = definition.namespaceURI!;
    let names = namespaces.get(namespaceURI);
    if (!names) {
      names = new Set();
      namespaces.set(namespaceURI, names);
    }
    for (const name of definition.localNames ?? []) {
      expect(names.has(name), `${namespaceURI} ${name}`).toBe(false);
      names.add(name);
      const constructor = getElementConstructor(namespaceURI, name);
      expect(implementations.some(({ implClass }) => constructor === implClass), name).toBe(true);
    }
    for (const { implClass } of implementations) {
      const constructor = implClass as typeof ElementImpl;
      const name = constructor.localName;
      if (name === undefined) continue;
      expect(names.has(name), `${namespaceURI} ${name}`).toBe(false);
      names.add(name);
      expect(getElementConstructor(namespaceURI, name)).toBe(constructor);
    }
  }
});
