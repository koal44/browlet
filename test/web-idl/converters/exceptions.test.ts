import { describe, expect, it } from 'vitest';

import { TypeError as InternalTypeError } from '../../../src/infra/exceptions';
import { IDLDictionary } from '../../../src/web-idl/values/dictionary';
import {
  BindingWorld, defineDictionary, dictMember, idlType, nullable, record, reference, sequence, union,
} from '../../../src/web-idl/index';

import { TestRealm } from '../../support/web-idl-realm';

describe.each(['direct', 'prepared'] as const)('Web IDL %s output exception values', (mode) => {
  it('realizes arbitrary error values inside their declared containers and preserves one identity', () => {
    const world = new BindingWorld([defineDictionary({
      name: 'Failure', members: [dictMember('reason', idlType.any)],
    })]);
    const realm = new TestRealm();
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    const otherRealm = new TestRealm();
    const other = world.register(otherRealm, (ctx) => ({ realm: ctx.realm }));
    const request = Object.freeze(new InternalTypeError('failure as a value'));
    const authorError = new Error('author error');
    const inputs = [
      { type: idlType.any, value: request },
      { type: idlType.object, value: request },
      { type: nullable(idlType.object), value: request },
      { type: union(idlType.object, idlType.long), value: request },
      { type: sequence(idlType.any), value: [request, authorError] },
      { type: record(idlType.DOMString, idlType.object), value: new Map([['reason', request], ['author', authorError]]) },
      { type: reference('Failure'), value: new IDLDictionary({ reason: request }) },
    ];
    const outputs = inputs.map(({ type, value }) => {
      const converter = binding.getConverter(binding.assembly.getIDLType(type));
      return mode === 'direct' ? converter.idlToJS(value) : converter.getIDLToJSSteps()(value);
    });
    const expected = outputs[0];
    expect(expected).toBeInstanceOf(realm.intrinsics.typeError);
    expect(expected).not.toBe(request);
    expect(expected).toHaveProperty('message', 'failure as a value');
    for (const output of outputs.slice(1, 4)) expect(output).toBe(expected);
    expect((outputs[4] as unknown[])[0]).toBe(expected);
    expect((outputs[4] as unknown[])[1]).toBe(authorError);
    expect((outputs[5] as Record<string, unknown>).reason).toBe(expected);
    expect((outputs[5] as Record<string, unknown>).author).toBe(authorError);
    expect((outputs[6] as Record<string, unknown>).reason).toBe(expected);
    expect(other.implToJS(request, idlType.any)).toBe(expected);
    expect(other.implToJS(authorError, idlType.object)).toBe(authorError);
  });
});
