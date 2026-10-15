import { describe, expect, it } from 'vitest';
import { createReflectionFixture, createReflectionWorld } from './fixture';

describe('HTML reflected element associations', () => {
  it('does not resolve an empty ID, including on a detached tree root', () => {
    const { platform: owner } = createReflectionFixture();
    owner.setAttribute('id', '');
    owner.setAttribute('target', '');
    expect(owner.target).toBe(null);
  });

  it('uses tree order, includes the root, and filters by the declared interface before choosing an ID match', () => {
    const fixture = createReflectionFixture();
    const owner = fixture.platform;
    const first = fixture.child().platform;
    const second = fixture.child(true).platform;
    owner.append(first, second);
    owner.id = 'root';
    first.id = second.id = 'duplicate';
    owner.setAttribute('target', 'root');
    expect(owner.target).toBe(owner);
    owner.setAttribute('target', 'duplicate');
    expect(owner.target).toBe(first);
    owner.setAttribute('typedtarget', 'duplicate');
    expect(owner.typedTarget).toBe(second);
    owner.setAttribute('aliastarget', 'duplicate');
    expect(owner.aliasTarget).toBe(second);
    owner.setAttribute('typedtargets', 'duplicate duplicate');
    expect(owner.typedTargets).toEqual([second, second]);
    expect(() => Reflect.set(owner, 'typedTarget', first)).toThrow(fixture.realm.intrinsics.typeError);
    owner.setAttribute('targets', 'duplicate\tmissing duplicate root');
    expect(owner.targets).toEqual([first, first, owner]);
    owner.prepend(second);
    expect(owner.target).toBe(second);
  });

  it('retains explicit detached root-to-child and child-to-root references, and clears them on ordinary writes', () => {
    const { platform: root, child } = createReflectionFixture();
    const target = child().platform;
    root.append(target);
    root.target = target;
    expect([root.target, root.getAttribute('target')]).toEqual([target, '']);
    root.targets = [root, target, target];
    expect(root.targets).toEqual([root, target, target]);
    root.setAttributeNS('urn:other', 'x:target', 'ignored');
    expect(root.target).toBe(target);
    root.getAttributeNode('target')!.value = '';
    expect(root.target).toBe(null);
    root.setAttribute('targets', '');
    expect(root.targets).toEqual([]);
    root.target = target;
    root.target = null;
    expect(root.hasAttribute('target')).toBe(false);
    root.targets = null;
    expect(root.hasAttribute('targets')).toBe(false);
  });

  it('suppresses ID fallback for an explicit out-of-scope reference and recomputes scope after moves', () => {
    const { platform: owner, child } = createReflectionFixture();
    const target = child().platform;
    owner.target = target;
    owner.targets = [target];
    expect(owner.target).toBe(null);
    expect(owner.targets).toEqual([]);
    owner.append(target);
    expect(owner.target).toBe(target);
    expect(owner.targets).toEqual([target]);
    target.remove();
    expect(owner.target).toBe(null);
    expect(owner.targets).toEqual([]);
  });

  it('allows references out through enclosing hosts but never into another shadow tree', () => {
    const fixture = createReflectionFixture();
    const owner = fixture.platform;
    const host = fixture.child().platform;
    const siblingHost = fixture.child().platform;
    const outerTarget = fixture.child().platform;
    const innerTarget = fixture.child().platform;
    const siblingTarget = fixture.child().platform;
    const root = fixture.child().platform;
    root.append(host, siblingHost, outerTarget);
    host.attachShadow({ mode: 'open' }).append(owner, innerTarget);
    siblingHost.attachShadow({ mode: 'open' }).append(siblingTarget);
    owner.targets = [host, outerTarget, innerTarget, siblingTarget];
    expect(owner.targets).toEqual([host, outerTarget, innerTarget]);
    outerTarget.id = innerTarget.id = 'named';
    owner.setAttribute('target', 'named');
    expect(owner.target).toBe(innerTarget);
    innerTarget.remove();
    expect(owner.target).toBe(null);
    root.append(owner);
    owner.target = siblingTarget;
    expect(owner.target).toBe(null);
  });

  it('returns a first empty frozen array and reuses it while the associated contents stay equal', () => {
    const { platform: owner, child, realm } = createReflectionFixture();
    owner.setAttribute('targets', '');
    const empty = owner.targets;
    expect(empty).toEqual([]);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(empty).toBeInstanceOf(realm.intrinsics.array);
    owner.setAttribute('targets', 'missing');
    expect(owner.targets).toBe(empty);
    const target = child().platform;
    target.id = 'named';
    owner.append(target);
    owner.setAttribute('targets', 'named');
    const one = owner.targets;
    owner.setAttribute('targets', '  named\t');
    expect(owner.targets).toBe(one);
    expect(one).toEqual([target]);
    owner.removeAttribute('targets');
    expect(owner.targets).toBe(null);
    owner.setAttribute('targets', '');
    expect(owner.targets).toEqual([]);
  });

  it('copies and validates the assigned sequence before changing the attribute', () => {
    const { platform: owner, child, realm } = createReflectionFixture();
    const target = child().platform;
    owner.append(target);
    const input = [target];
    owner.targets = input;
    input.length = 0;
    expect(owner.targets).toEqual([target]);
    expect(owner.targets).not.toBe(input);
    const previous = owner.targets;
    expect(() => Reflect.set(owner, 'targets', [target, {}])).toThrow(realm.intrinsics.typeError);
    expect(owner.targets).toBe(previous);
    expect(owner.getAttribute('targets')).toBe('');
  });

  it('uses the receiver realm for cached arrays while preserving referenced elements in their original realm', () => {
    const create = createReflectionWorld();
    const owner = create();
    const foreign = create();
    owner.platform.append(foreign.platform);
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(foreign.platform), 'targets')!;
    descriptor.set!.call(owner.platform, [foreign.platform]);
    const array = descriptor.get!.call(owner.platform) as NonNullable<typeof owner.platform.targets>;
    expect(array).toBe(owner.platform.targets);
    expect(Object.getPrototypeOf(array)).toBe(owner.realm.intrinsics.array.prototype);
    expect(array[0]).toBe(foreign.platform);
    expect(foreign.element.env).toBe(foreign.env);
    expect(foreign.element.nodeDocument).toBe(owner.document);
    foreign.platform.target = owner.platform;
    expect(foreign.platform.target).toBe(owner.platform);
  });
});
