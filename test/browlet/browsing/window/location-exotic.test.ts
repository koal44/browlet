import { afterEach, describe, expect, it, vi } from 'vitest';

import { addon } from '../../../../src/js-engine/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/bindings/cross-origin';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { getBindingContext, getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

// Approved stock-Node gaps: accessing-realm capture and changing frozen-property visibility require the addon.
const testLocation = addon.createExoticObject ? it : it.fails;

describe('Location automatic exotic dispatch', () => {
  testLocation('uses the accessing realm for foreign prototype reflection', async () => {
    const { caller } = createPair();
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignLocation') as object;
      return [
        Reflect.getPrototypeOf(foreign) === null, Reflect.setPrototypeOf(foreign, null),
        Reflect.setPrototypeOf(foreign, {}), Reflect.isExtensible(foreign), Reflect.preventExtensions(foreign),
      ];
    })).toEqual([true, true, false, true, false]);
  });

  testLocation('selects foreign descriptors, keys, and stable functions in the accessing realm', async () => {
    const { caller, target } = createPair();
    Reflect.set(caller.window, 'ownerReplace', Reflect.get(target.window.location, 'replace'));
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignLocation') as Location;
      const href = Object.getOwnPropertyDescriptor(foreign, 'href')!;
      const replace = Object.getOwnPropertyDescriptor(foreign, 'replace')!;
      return [
        Reflect.ownKeys(foreign).map((key) => typeof key === 'symbol' ? key.toString() : key),
        href.get === undefined, typeof href.set, href.enumerable, href.configurable,
        replace.value === foreign.replace, Object.getOwnPropertyDescriptor(foreign, 'replace')!.value === replace.value,
        Object.getPrototypeOf(replace.value) === Function.prototype,
        replace.value !== Reflect.get(window, 'ownerReplace'), replace.writable, replace.configurable,
        'href' in foreign, 'then' in foreign, Reflect.get(foreign, 'then') as unknown,
      ];
    })).toEqual([
      ['href', 'replace', 'then', 'Symbol(Symbol.toStringTag)', 'Symbol(Symbol.hasInstance)', 'Symbol(Symbol.isConcatSpreadable)'],
      true, 'function', false, true, true, true, true, true, false, true, true, true, undefined,
    ]);
  });

  testLocation('rejects foreign reads, writes, definitions, deletions, and unsupported presence checks', async () => {
    const { caller } = createPair();
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignLocation') as object;
      return [
        () => Reflect.get(foreign, 'href') as unknown,
        () => Reflect.get(foreign, 'assign') as unknown,
        () => Reflect.getOwnPropertyDescriptor(foreign, 'constructor'),
        () => Reflect.set(foreign, 'replace', 1),
        () => Reflect.defineProperty(foreign, 'probe', { value: 1 }),
        () => Reflect.deleteProperty(foreign, 'missing'),
        () => Reflect.has(foreign, 'missing'),
      ].map((operation) => {
        try { operation(); return 'returned'; }
        catch (error) { return error instanceof DOMException && error.name; }
      });
    })).toEqual(Array.from({ length: 7 }, () => 'SecurityError'));
  });

  testLocation('keeps one property store while nonconfigurable keys become foreign-hidden', async () => {
    const { caller, target, targetDocument } = createPair();
    const callerDocument = unwrap<DocumentImpl>(caller.document);
    const originalOrigin = targetDocument.origin;
    callerDocument.origin = originalOrigin;
    Reflect.defineProperty(target.window.location, 'frozenProbe', { value: 17, enumerable: true });
    Reflect.defineProperty(target.window.location, '0', { value: 23, enumerable: true });
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignLocation') as object;
      return [Reflect.get(foreign, 'frozenProbe') as unknown, Reflect.get(foreign, '0') as unknown,
        Object.getOwnPropertyDescriptor(foreign, 'frozenProbe')!.configurable];
    })).toEqual([17, 23, false]);
    callerDocument.origin = unwrap<DocumentImpl>(new Browlet({ route: () => '' }).document).origin;
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignLocation') as object;
      return Reflect.ownKeys(foreign).includes('frozenProbe') || Reflect.ownKeys(foreign).includes('0');
    })).toBe(false);
    callerDocument.origin = originalOrigin;
    expect(Reflect.get(target.window.location, 'frozenProbe')).toBe(17);
    expect(Reflect.deleteProperty(target.window.location, 'frozenProbe')).toBe(false);
  });

  testLocation('uses a borrowed Reflect method realm instead of the outer script or Location owner', async () => {
    const { caller, target } = createPair();
    Reflect.set(target.window.location, 'marker', 42);
    Reflect.set(caller.window, 'ownerReflect', Reflect.get(getRelevantRealm(target.window).globalProxy, 'Reflect'));
    Reflect.set(caller.window, 'ownerPrototype', target.window.Location.prototype);
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignLocation') as object;
      const ownerReflect = Reflect.get(window, 'ownerReflect') as typeof Reflect;
      return [
        Reflect.getPrototypeOf(foreign) === null,
        ownerReflect.getPrototypeOf(foreign) === Reflect.get(window, 'ownerPrototype'),
        ownerReflect.get(foreign, 'marker') as unknown,
      ];
    })).toEqual([true, true, 42]);
  });

  testLocation('keeps foreign function identity per caller and restores it after same-origin access', async () => {
    const { caller, target, targetDocument } = createPair();
    const otherCaller = new Browlet({ route: () => '' });
    Reflect.set(otherCaller.window, 'foreignLocation', target.window.location);
    await caller.evaluate(() => {
      Reflect.set(window, 'savedReplace', Reflect.get(Reflect.get(window, 'foreignLocation') as object, 'replace'));
    });
    await otherCaller.evaluate(() => {
      Reflect.set(window, 'savedReplace', Reflect.get(Reflect.get(window, 'foreignLocation') as object, 'replace'));
    });
    const binding = new CrossOriginObjectBinding(getBindingContext(getRelevantRealm(caller.window)));
    expect(binding.crossOriginGet(target.window.location, 'replace', target.window.location))
      .toBe(Reflect.get(caller.window, 'savedReplace'));
    expect(Reflect.get(caller.window, 'savedReplace')).not.toBe(Reflect.get(otherCaller.window, 'savedReplace'));
    const callerDocument = unwrap<DocumentImpl>(caller.document);
    const foreignOrigin = callerDocument.origin;
    callerDocument.origin = targetDocument.origin;
    expect(await caller.evaluate(() =>
      (Reflect.get(window, 'foreignLocation') as Location).replace === Reflect.get(window, 'savedReplace'),
    )).toBe(false);
    callerDocument.origin = foreignOrigin;
    expect(await caller.evaluate(() =>
      (Reflect.get(window, 'foreignLocation') as Location).replace === Reflect.get(window, 'savedReplace'),
    )).toBe(true);
  });

  testLocation('rechecks domain relaxation on both sides for each automatic access', async () => {
    const { caller, target, targetDocument } = createPair();
    const callerDocument = unwrap<DocumentImpl>(caller.document);
    callerDocument.origin = obtainURLOrigin(parseURL('https://a.example.test/').url!);
    targetDocument.origin = obtainURLOrigin(parseURL('https://b.example.test/').url!);
    if (callerDocument.origin.kind !== 'tuple' || targetDocument.origin.kind !== 'tuple') throw new Error('Expected tuple origins');
    Reflect.set(caller.window, 'ownerPrototype', target.window.Location.prototype);
    const visible = () => caller.evaluate(() =>
      Reflect.getPrototypeOf(Reflect.get(window, 'foreignLocation') as object) === Reflect.get(window, 'ownerPrototype'),
    );
    expect(await visible()).toBe(false);
    callerDocument.origin.domain = parseURL('https://example.test/').url!.host;
    expect(await visible()).toBe(false);
    targetDocument.origin.domain = parseURL('https://example.test/').url!.host;
    expect(await visible()).toBe(true);
    targetDocument.origin.domain = null;
    expect(await visible()).toBe(false);
  });

  testLocation('preserves the accessing realm through ordinary assignment to a foreign receiver', async () => {
    const { caller, targetDocument } = createPair();
    const other = new Browlet({ route: () => '' });
    unwrap<DocumentImpl>(caller.document).origin = targetDocument.origin;
    Reflect.set(caller.window, 'foreignReceiver', other.window.location);
    expect(await caller.evaluate(() => {
      const source = Reflect.get(window, 'foreignLocation') as object;
      const receiver = Reflect.get(window, 'foreignReceiver') as object;
      Object.defineProperty(source, 'probe', { value: 1, writable: true, configurable: true });
      try { Reflect.set(source, 'probe', 2, receiver); return false; }
      catch (error) { return error instanceof DOMException && error.name === 'SecurityError'; }
    })).toBe(true);
    expect(Reflect.has(other.window.location, 'probe')).toBe(false);
  });

  testLocation('runs inherited property lookup in the accessing realm', async () => {
    const { caller, target, targetDocument } = createPair();
    const other = new Browlet({ route: () => '' });
    unwrap<DocumentImpl>(caller.document).origin = targetDocument.origin;
    Reflect.setPrototypeOf(target.window.Location.prototype, other.window.location);
    expect(await caller.evaluate(() => {
      const source = Reflect.get(window, 'foreignLocation') as object;
      return [() => Reflect.get(source, 'missing') as unknown, () => Reflect.has(source, 'missing')].map((operation) => {
        try { operation(); return false; }
        catch (error) { return error instanceof DOMException && error.name === 'SecurityError'; }
      });
    })).toEqual([true, true]);
  });

  testLocation.each(['href', 'replace'] as const)('hands foreign %s navigation to the target navigable', async (member) => {
    const { caller, target, targetDocument } = createPair();
    const navigable = targetDocument.getNodeNavigable()!;
    const navigate = vi.spyOn(navigable, 'navigate').mockImplementation(() => {});
    await caller.evaluate((member) => {
      const foreign = Reflect.get(window, 'foreignLocation') as Location;
      if (member === 'href') foreign.href = 'https://destination.test/path';
      else foreign.replace('https://destination.test/path');
    }, member);
    expect(navigate).toHaveBeenCalledOnce();
    const [url, source, options] = navigate.mock.calls[0]!;
    expect(serializeURL(url)).toBe('https://destination.test/path');
    expect(source).toBe(unwrap<DocumentImpl>(caller.document));
    expect(options).toMatchObject({ exceptionsEnabled: true, historyHandling: member === 'href' ? 'auto' : 'replace' });
    expect(target.window.location.href).toBe('about:blank');
  });

  testLocation('keeps a retained Location store and origin separate from the replacement Window', async () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    await target.navigate('https://old.test/');
    unwrap<DocumentImpl>(caller.document).origin = unwrap<DocumentImpl>(target.document).origin;
    const retained = target.window.location;
    Reflect.defineProperty(retained, 'saved', { value: 71 });
    Reflect.set(caller.window, 'retainedLocation', retained);
    Reflect.set(caller.window, 'oldPrototype', target.window.Location.prototype);
    await target.navigate('https://new.test/');
    Reflect.set(caller.window, 'replacementLocation', target.window.location);
    expect(await caller.evaluate(() => {
      const retained = Reflect.get(window, 'retainedLocation') as object;
      const replacement = Reflect.get(window, 'replacementLocation') as object;
      return [Reflect.get(retained, 'saved') as unknown,
        Reflect.getPrototypeOf(retained) === Reflect.get(window, 'oldPrototype'),
        Reflect.getPrototypeOf(replacement) === null, retained !== replacement];
    })).toEqual([71, true, true, true]);
  });
});

function createPair() {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  Reflect.set(caller.window, 'foreignLocation', target.window.location);
  return { caller, target, targetDocument: unwrap<DocumentImpl>(target.document) };
}
