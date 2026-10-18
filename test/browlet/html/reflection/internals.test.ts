import { describe, expect, expectTypeOf, it } from 'vitest';

import { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { HTMLElementImpl } from '../../../../src/browlet/dom/nodes/html/index';
import { ElementInternalsImpl } from '../../../../src/browlet/dom/nodes/html/custom-elements/index';
import { MutationObserverImpl } from '../../../../src/browlet/dom/nodes/mutation-observer';
import { elementReflection, internalsReflection } from '../../../../src/browlet/integration/web-idl/reflection-target';
import type { Element, ElementInternals, HTMLElement } from '../../../../src/browlet/platform';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import {
  attr, defineIncludes, defineInterface, defineInterfaceMixin, frozenArray, idlType, impl, nullable, reference, reflect, xattr,
  type Definition,
} from '../../../../src/web-idl/index';
import { createReflectionWorld } from './fixture';

// These members exercise the existing reflection contract without inventing an ARIAMixin.
class ReflectionInternalsImpl extends ElementInternalsImpl {}

const definition = defineInterface({
  name: 'ReflectionInternals', inherits: 'ElementInternals', exposed: 'Window',
  implementation: impl(ReflectionInternalsImpl),
  members: [
    attr('label', nullable(idlType.DOMString), xattr(reflect())),
    attr('target', nullable(reference('Element')), xattr(reflect())),
    attr('targets', nullable(frozenArray(reference('Element'))), xattr(reflect())),
  ],
});

type ReflectionInternals = ElementInternals & {
  label: string | null;
  target: Element | null;
  targets: readonly Element[] | null;
};

function createFixture(additionalDefinitions: Definition[] = []) {
  const fixture = createReflectionWorld([definition, ...additionalDefinitions])();
  const { context, document, env } = fixture;
  const host = context.construct(HTMLElementImpl, [{ document, localName: 'x-host', namespaceURI: HTML_NAMESPACE }, env]);
  const hostPlatform = context.project(HTMLElementImpl, host) as unknown as HTMLElement;
  // Construction/definition lookup and attachInternals() are a separate unfinished dependency.
  const internals = context.construct(ReflectionInternalsImpl, [host, env]);
  const platform = context.project(ReflectionInternalsImpl, internals) as unknown as ReflectionInternals;
  return { ...fixture, host, hostPlatform, internals, platform };
}

describe('ElementInternals reflection', () => {
  it('prepares a shared mixin for both owner kinds without sharing storage or array identity', () => {
    const { host, hostPlatform, platform, child } = createFixture([
      defineInterfaceMixin({
        name: 'SharedReflection',
        members: [
          attr('sharedLabel', nullable(idlType.DOMString), xattr(reflect())),
          attr('sharedTargets', nullable(frozenArray(reference('Element'))), xattr(reflect())),
        ],
      }),
      defineIncludes({ interface: 'Element', mixin: 'SharedReflection' }),
      defineIncludes({ interface: 'ElementInternals', mixin: 'SharedReflection' }),
    ]);
    Reflect.set(hostPlatform, 'sharedLabel', 'ordinary');
    Reflect.set(platform, 'sharedLabel', 'internal');
    expect(host.getAttribute('sharedlabel')).toBe('ordinary');
    expect(host.internalContentAttributeMap?.get('sharedlabel')).toBe('internal');
    expect(Reflect.get(hostPlatform, 'sharedLabel')).toBe('ordinary');
    expect(Reflect.get(platform, 'sharedLabel')).toBe('internal');
    Reflect.set(platform, 'sharedLabel', null);
    expect(Reflect.get(platform, 'sharedLabel')).toBe(null);
    expect(Reflect.get(hostPlatform, 'sharedLabel')).toBe('ordinary');

    const target = child();
    host.appendChild(target.element);
    for (const owner of [hostPlatform, platform]) Reflect.set(owner, 'sharedTargets', [target.platform]);
    const ordinary = Reflect.get(hostPlatform, 'sharedTargets') as readonly Element[];
    const internal = Reflect.get(platform, 'sharedTargets') as readonly Element[];
    expect(ordinary).toEqual([target.platform]);
    expect(internal).toEqual([target.platform]);
    expect(internal).not.toBe(ordinary);
    expect(Object.isFrozen(ordinary) && Object.isFrozen(internal)).toBe(true);
    expect(Reflect.get(hostPlatform, 'sharedTargets')).toBe(ordinary);
    expect(Reflect.get(platform, 'sharedTargets')).toBe(internal);
    host.setAttribute('sharedtargets', '');
    expect(Reflect.get(hostPlatform, 'sharedTargets')).toEqual([]);
    expect(Reflect.get(platform, 'sharedTargets')).toBe(internal);
  });

  it('keeps internal defaults separate from ordinary attributes and mutation records', () => {
    const { host, internals, platform, env } = createFixture();
    expect(elementReflection.getElement(host)).toBe(host);
    expect(internalsReflection.getElement(internals)).toBe(host);
    host.setAttribute('label', 'author');
    expect(platform.label).toBe(null);
    expect(host.internalContentAttributeMap).toBeUndefined();

    const observer = new MutationObserverImpl(() => undefined, env);
    observer.observe(host, { attributes: true, childList: false, subtree: false });
    platform.label = 'default';
    expect(internals.getContentAttribute('label')).toBe('default');
    expect(host.getAttribute('label')).toBe('author');
    expect(observer.takeRecords()).toEqual([]);

    host.setAttribute('label', 'changed');
    expect(platform.label).toBe('default');
    expect(observer.takeRecords()).toHaveLength(1);
    platform.label = null;
    expect(platform.label).toBe(null);
    expect(host.internalContentAttributeMap?.has('label')).toBe(false);
    expect(host.getAttribute('label')).toBe('changed');
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('resolves internal ID strings in the target tree without reading its ordinary attributes', () => {
    const { host, internals, platform, child } = createFixture();
    const target = child();
    target.element.id = 'named';
    host.appendChild(target.element);
    host.setAttribute('target', 'named');
    expect(platform.target).toBe(null);
    internals.setContentAttribute('target', 'named');
    expect(platform.target).toBe(target.platform);
    expect(internals.getAssociatedElements('target', [ElementImpl], false)).toBe(target.element);
    internals.deleteContentAttribute('target');
    expect(platform.target).toBe(null);
    expect(host.getAttribute('target')).toBe('named');
  });

  it('selects the implementation return type and shape from the class and array flag', () => {
    const { host, internals } = createFixture();
    host.id = 'host';
    host.setAttribute('target', 'host');
    internals.setContentAttribute('target', 'host');
    for (const owner of [host, internals]) {
      const single = owner.getAssociatedElements('target', [HTMLElementImpl], false);
      expectTypeOf(single).toEqualTypeOf<HTMLElementImpl | null>();
      expect(single).toBe(host);
      const list = owner.getAssociatedElements('target', [HTMLElementImpl], true);
      expectTypeOf(list).toEqualTypeOf<HTMLElementImpl[] | null>();
      expect(list).toEqual([host]);
    }
  });

  it('owns explicit references independently of the element, including after attribute changes', () => {
    const { host, internals, platform, child } = createFixture();
    const first = child();
    const second = child();
    second.element.id = 'second';
    host.appendChild(first.element);
    host.appendChild(second.element);
    host.setAssociatedElements('target', first.element);
    platform.target = second.platform;
    expect(host.getAssociatedElements('target', [ElementImpl], false)).toBe(first.element);
    expect(platform.target).toBe(second.platform);
    host.setAttribute('target', 'second');
    host.removeAttribute('target');
    expect(host.getAssociatedElements('target', [ElementImpl], false)).toBe(null);
    expect(platform.target).toBe(second.platform);

    // Internal string writes have no DOM attribute-change steps to clear explicit references.
    internals.setContentAttribute('target', 'missing');
    expect(platform.target).toBe(second.platform);
    host.setAttribute('target', 'second');
    platform.target = null;
    expect(platform.target).toBe(null);
    expect(host.getAssociatedElements('target', [ElementImpl], false)).toBe(second.element);
  });

  it('retains explicit out-of-scope references and rechecks scope after tree changes', () => {
    const { host, internals, platform, child } = createFixture();
    const target = child();
    internals.setAssociatedElements('target', target.element);
    internals.setAssociatedElements('targets', [target.element]);
    expect(platform.target).toBe(null);
    expect(platform.targets).toEqual([]);
    host.appendChild(target.element);
    expect(platform.target).toBe(target.platform);
    expect(platform.targets).toEqual([target.platform]);
    target.element.remove();
    expect(platform.target).toBe(null);
    expect(platform.targets).toEqual([]);
  });

  it('keeps copied associations and cached frozen arrays separate from the element', () => {
    const { host, internals, platform, child, realm } = createFixture();
    const first = child();
    const second = child();
    host.appendChild(first.element);
    host.appendChild(second.element);
    host.setAssociatedElements('targets', [second.element]);
    const input = [first.platform, first.platform, second.platform];
    platform.targets = input;
    input.pop();
    const result = platform.targets;
    expect(result).toEqual([first.platform, first.platform, second.platform]);
    expect(result).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(result)).toBe(true);
    expect(platform.targets).toBe(result);
    expect(host.getAssociatedElements('targets', [ElementImpl], true)).toEqual([second.element]);
    expect(internals.getAssociatedElements('targets', [ElementImpl], true)).toEqual([first.element, first.element, second.element]);
    host.removeAttribute('targets');
    expect(platform.targets).toBe(result);
    platform.targets = [];
    expect(platform.targets).toEqual([]);
    platform.targets = null;
    expect(platform.targets).toBe(null);
    expect(host.internalContentAttributeMap?.has('targets')).toBe(false);
  });

  it('exposes only shadow roots made available to internals, including closed roots', () => {
    const { host, hostPlatform, internals, platform, context } = createFixture();
    expect(platform.shadowRoot).toBe(null);
    const shadow = hostPlatform.attachShadow({ mode: 'closed' });
    expect(hostPlatform.shadowRoot).toBe(null);
    expect(platform.shadowRoot).toBe(null);
    host.shadowRoot!.availableToElementInternals = true;
    expect(internals.shadowRoot).toBe(host.shadowRoot);
    expect(platform.shadowRoot).toBe(shadow);
    expect(context.project(ReflectionInternalsImpl, internals)).toBe(platform);
  });
});
