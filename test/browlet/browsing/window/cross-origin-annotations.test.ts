/* eslint-disable @typescript-eslint/unbound-method -- Inspect and invoke IDL getters with explicit receivers. */
import { describe, expect, it } from 'vitest';

import {
  arg, attr, defineIncludes, defineInterface, defineInterfaceMixin, definePartialInterface,
  idlType, impl, op, roAttr, xattr,
} from '../../../../src/web-idl/core/index';
import { DefinitionAssembly } from '../../../../src/web-idl/assembly/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';
import { Browlet } from '../../../../src/browlet/browlet';
import { createSandboxEnvironment } from '../../../../src/browlet/bindings';
import type { BrowletEnvironment } from '../../../../src/browlet/environment';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import {
  CrossOriginObjectBinding, prepareCrossOriginObject,
} from '../../../../src/browlet/integration/web-idl/cross-origin';
import { htmlExtendedAttributeHooks } from '../../../../src/browlet/integration/web-idl/extended-attributes';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';

describe('cross-origin annotation proof of concept', () => {
  it('selects an annotated interface without depending on Window or Location names', () => {
    const definitions = [
      defineInterface({
        name: 'Example', ...xattr('CrossOriginObject'),
        members: [
          roAttr('readable', idlType.DOMString, xattr('CrossOrigin')),
          attr('writable', idlType.DOMString, xattr(['CrossOrigin', 'Setter'])),
          attr('both', idlType.DOMString, xattr(['CrossOrigin', ['Getter', 'Setter']])),
          roAttr('privateValue', idlType.DOMString),
          op('send', idlType.undefined, [], xattr('CrossOrigin')),
          op('send', idlType.undefined, [arg('value', idlType.DOMString)], xattr('CrossOrigin')),
        ],
      }),
    ];
    const assembly = new DefinitionAssembly(definitions);
    const owner = assembly.interfaces.get('Example')!;
    const properties = prepareCrossOriginObject(owner);
    expect(properties).toEqual([
      { property: 'readable', needsGetter: true, needsSetter: false },
      { property: 'writable', needsGetter: false, needsSetter: true },
      { property: 'both', needsGetter: true, needsSetter: true },
      { property: 'send' },
    ]);
    expect(prepareCrossOriginObject(owner)).toBe(properties);
  });

  it('requires the interface annotation and includes partial and mixin members', () => {
    const assembly = new DefinitionAssembly([
      defineInterface({
        name: 'Ordinary', members: [roAttr('value', idlType.long, xattr('CrossOrigin'))],
      }),
      defineInterface({ name: 'Protected', ...xattr('CrossOriginObject'), members: [] }),
      definePartialInterface({ name: 'Protected', members: [op('send', idlType.undefined, [], xattr('CrossOrigin'))] }),
      defineInterfaceMixin({
        name: 'Readable', members: [roAttr('value', idlType.long, xattr('CrossOrigin'))],
      }),
      defineIncludes({ interface: 'Protected', mixin: 'Readable' }),
    ]);
    expect(prepareCrossOriginObject(assembly.interfaces.get('Ordinary')!)).toBeNull();
    expect(prepareCrossOriginObject(assembly.interfaces.get('Protected')!)).toEqual([
      { property: 'send' },
      { property: 'value', needsGetter: true, needsSetter: false },
    ]);
  });

  it('uses the composed Window declarations for accessible names', () => {
    const world = new BindingWorld<BrowletEnvironment>([
      defineInterface({
        name: 'Window', ...xattr('CrossOriginObject'),
        members: [roAttr('window', idlType.object, xattr('CrossOrigin')), roAttr('privateValue', idlType.long)],
      }),
      definePartialInterface({
        name: 'Window', members: [op('fromPartial', idlType.undefined, [], xattr('CrossOrigin'))],
      }),
      defineInterfaceMixin({
        name: 'Readable', members: [roAttr('fromMixin', idlType.long, xattr('CrossOrigin'))],
      }),
      defineIncludes({ interface: 'Window', mixin: 'Readable' }),
    ]);
    const env = createSandboxEnvironment();
    const context = world.register(env.realm, () => env);
    const binding = new CrossOriginObjectBinding(context);
    expect(prepareCrossOriginObject(context.resolveInterface('Window'))).toEqual([
      { property: 'window', needsGetter: true, needsSetter: false },
      { property: 'fromPartial' },
      { property: 'fromMixin', needsGetter: true, needsSetter: false },
    ]);
    for (const name of ['window', 'fromPartial', 'fromMixin', '0']) {
      expect(binding.isCrossOriginAccessibleWindowPropertyName(name), name).toBe(true);
    }
    for (const name of ['privateValue', 'self', 'then']) {
      expect(binding.isCrossOriginAccessibleWindowPropertyName(name), name).toBe(false);
    }
  });

  it('rejects unsupported annotation forms instead of broadening access', () => {
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'InvalidInterface', ...xattr(['CrossOriginObject', 'All']), members: [] }),
      defineInterface({
        name: 'InvalidMember', ...xattr('CrossOriginObject'),
        members: [roAttr('value', idlType.long, xattr(['CrossOrigin', 'All']))],
      }),
    ]);
    expect(() => prepareCrossOriginObject(assembly.interfaces.get('InvalidInterface')!)).toThrow('takes no arguments');
    expect(() => prepareCrossOriginObject(assembly.interfaces.get('InvalidMember')!)).toThrow('Getter and/or Setter');
  });

  it('prepares security from annotations without an environment initializer hook', async () => {
    class BaseImpl {
      value = 7;
      read(): number { return this.value; }
    }
    class ProtectedImpl extends BaseImpl {
      allowed = 9;
    }
    const world = new BindingWorld<BrowletEnvironment>([
      defineInterface({
        name: 'Base', implementation: impl(BaseImpl),
        members: [roAttr('value', idlType.long), op('read', idlType.long)],
      }),
      defineInterface({
        name: 'Protected', inherits: 'Base', implementation: impl(ProtectedImpl), ...xattr('CrossOriginObject'),
        members: [roAttr('allowed', idlType.long, xattr('CrossOrigin'))],
      }),
    ], { extendedAttributes: htmlExtendedAttributeHooks });
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    await caller.navigate('https://caller.example/');
    await target.navigate('https://target.example/');
    const callerEnv = unwrap<DocumentImpl>(caller.document).env;
    const targetEnv = unwrap<DocumentImpl>(target.document).env;
    // Register real environments without createBrowletEnvironmentInit assigning a policy.
    const callerContext = world.register(callerEnv.realm, () => callerEnv);
    const targetContext = world.register(targetEnv.realm, () => targetEnv);
    const own = callerContext.project(ProtectedImpl, new ProtectedImpl());
    const protectedTarget = targetContext.project(ProtectedImpl, new ProtectedImpl());
    const ordinaryTarget = targetContext.project(BaseImpl, new BaseImpl());
    const getter = callerContext.createMemberFunction('Base', 'value', 'getter')!;
    const method = callerContext.createMemberFunction('Base', 'read', 'method')!;
    const allowed = callerContext.createMemberFunction('Protected', 'allowed', 'getter')!;

    expect(() => { Reflect.apply(getter, protectedTarget, []); }).toThrow(callerContext.DOMException);
    expect(() => { Reflect.apply(method, protectedTarget, []); }).toThrow(callerContext.DOMException);
    expect(Reflect.apply(getter, own, [])).toBe(7);
    expect(Reflect.apply(method, ordinaryTarget, [])).toBe(7);
    expect(Reflect.apply(allowed, protectedTarget, [])).toBe(9);
  });

  it('drives Window and Location checks and descriptors through real bindings', async () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    await caller.navigate('https://caller.example/');
    await target.navigate('https://target.example/');
    const callerContext = getBindingContext(unwrap<DocumentImpl>(caller.document).env.realm);
    const targetGlobal = unwrap<DocumentImpl>(target.document).env.global;
    const binding = new CrossOriginObjectBinding(callerContext);

    expect(() => callerContext.performSecurityCheck(targetGlobal, 'document', 'getter')).toThrow(caller.window.DOMException);
    expect(() => callerContext.performSecurityCheck(targetGlobal, 'self', 'getter')).not.toThrow();
    expect(() => callerContext.performSecurityCheck(targetGlobal, 'self', 'setter')).toThrow(caller.window.DOMException);
    expect(() => callerContext.performSecurityCheck(targetGlobal, 'location', 'getter')).not.toThrow();
    expect(() => callerContext.performSecurityCheck(targetGlobal, 'location', 'setter')).not.toThrow();
    expect(() => callerContext.performSecurityCheck(target.window.location, 'href', 'getter')).toThrow(caller.window.DOMException);
    expect(() => callerContext.performSecurityCheck(target.window.location, 'href', 'setter')).not.toThrow();
    expect(() => callerContext.performSecurityCheck(target.window.location, 'replace', 'method')).not.toThrow();

    const descriptor = binding.crossOriginGetOwnPropertyHelper(targetGlobal, 'location')!;
    expect(descriptor).toMatchObject({ enumerable: false, configurable: true });
    expect(typeof descriptor.get).toBe('function');
    expect(typeof descriptor.set).toBe('function');
    expect(Reflect.apply(descriptor.get!, target.window, [])).toBe(target.window.location);
    expect(Object.getPrototypeOf(descriptor.get)).toBe(callerContext.realm.Function.prototype);
    expect(binding.crossOriginGetOwnPropertyHelper(targetGlobal, 'location')).toBe(descriptor);
  });
});
