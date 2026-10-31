import { describe, expect, it } from 'vitest';

import { InternalPromise, internalType } from '../../src/infra/index';
import {
  PermissionFeature, originPermissionKey, PermissionStore,
  type PermissionEnvironment, type PermissionChoiceRequest, type PermissionSelection,
} from '../../src/permissions/index';

import { createPermissionEnvironment, createPermissionUserAgent } from '../support/permissions';

describe('Permissions §5.3: prompting the user to choose', () => {
  it.each(['stored-denial', 'insecure', 'policy'] as const)('does not open a chooser after %s', async (reason) => {
    const { env, requests } = createEnvironment([new PermissionFeature('test-choice', originPermissionKey, { policyControlled: true })]);
    if (reason === 'stored-denial') env.userAgent.permissionStore.setEntry({ name: 'test-choice' }, env.topLevelOrigin, 'denied');
    if (reason === 'insecure') env.isSecureContext = false;
    if (reason === 'policy') env.isAllowedToUse = () => false;

    expect(await env.permissions.promptUserToChoose(['first'], 'test-choice', false, undefined)).toBe('denied');
    expect(requests).toEqual([]);
  });

  it('defaults to a single choice and forwards the descriptor and caller-supplied prompt information', async () => {
    const { env, requests } = createEnvironment();
    const first = { id: 'first' };
    const second = { id: 'second' };
    const descriptor = { name: 'test-choice', aspect: 'camera' };
    const extraInformation = { reason: 'Choose a camera for this call' };
    const selection = await env.permissions.promptUserToChoose([first, second], descriptor, undefined, extraInformation);
    expect(selection).toEqual([first]);
    expect(selection[0]).toBe(first);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ descriptor, options: [first, second], allowMultiple: false, extraInformation });
    expect(requests[0]!.descriptor).toBe(descriptor);
    expect(requests[0]!.extraInformation).toBe(extraInformation);
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('accepts multiple choices only when requested, retaining the original option identities', async () => {
    const { env } = createEnvironment();
    const options = [{ id: 'first' }, { id: 'second' }];
    const selection = await env.permissions.promptUserToChoose(options, 'test-choice', true, undefined);
    expect(selection).toEqual(options);
    expect(selection[0]).toBe(options[0]);
    expect(selection[1]).toBe(options[1]);
    expect(selection).not.toBe(options);
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('still asks which option to use when permission is granted, without silently caching a choice', async () => {
    const { env, requests } = createEnvironment();
    const store = env.userAgent.permissionStore;
    store.setEntry({ name: 'test-choice' }, env.topLevelOrigin, 'granted');
    const before = [...store];
    expect(await env.permissions.promptUserToChoose(['first', 'second'], 'test-choice', false, undefined)).toEqual(['first']);
    expect(await env.permissions.promptUserToChoose(['first', 'second'], 'test-choice', false, undefined)).toEqual(['first']);
    expect(requests).toHaveLength(2);
    expect([...store]).toEqual(before);
    expect([...store][0]).toBe(before[0]);
  });

  it('applies new-consent restrictions only to prompt state, preserving an existing grant', async () => {
    const { env, requests } = createEnvironment([new PermissionFeature('test-choice', originPermissionKey, { canRequest: () => false })]);
    expect(await env.permissions.promptUserToChoose(['first'], 'test-choice', false, undefined)).toBe('denied');
    expect(requests).toEqual([]);
    expect(env.userAgent.permissionStore.size).toBe(0);
    env.userAgent.permissionStore.setEntry({ name: 'test-choice' }, env.topLevelOrigin, 'granted');
    expect(await env.permissions.promptUserToChoose(['first'], 'test-choice', false, undefined)).toEqual(['first']);
    expect(requests).toHaveLength(1);
  });

  it.each(['denial', 'empty'] as const)('returns denied for a host %s without saving permission state', async (kind) => {
    const { env } = createEnvironment();
    env.userAgent.choosePermissionOptions = () => InternalPromise.resolve(
      kind === 'denial' ? 'denied' : [], internalType<PermissionSelection<never>>(),
    );
    expect(await env.permissions.promptUserToChoose(['first'], 'test-choice', true, undefined)).toBe('denied');
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('returns denied when there are no offered options and the host selects nothing', async () => {
    const { env, requests } = createEnvironment();
    expect(await env.permissions.promptUserToChoose([], 'test-choice', false, undefined)).toBe('denied');
    expect(requests[0]!.options).toEqual([]);
  });

  it('does not confuse an option named denied with denial', async () => {
    const { env } = createEnvironment();
    expect(await env.permissions.promptUserToChoose(['denied'], 'test-choice', false, undefined)).toEqual(['denied']);
  });

  it('waits for the host while retaining the offered set and returns its own selection array', async () => {
    const { env } = createEnvironment();
    let finish!: () => void;
    let hostSelection!: unknown[];
    env.userAgent.choosePermissionOptions = <T>(request: PermissionChoiceRequest<T>) => {
      const answer = InternalPromise.withResolvers(internalType<PermissionSelection<T>>());
      const selection = request.options.slice(0, 1);
      hostSelection = selection;
      // Editing the host's presentation list does not remove an originally offered value.
      request.options.length = 0;
      finish = () => { answer.resolve(selection); };
      return answer.promise;
    };
    const first = { id: 'first' };
    const options = [first];
    const pending = env.permissions.promptUserToChoose(options, 'test-choice', false, undefined);
    options.length = 0;
    expect(env.userAgent.permissionStore.size).toBe(0);
    finish();
    const selected = await pending;
    hostSelection.length = 0;
    expect(selected).toEqual([first]);
    expect(selected[0]).toBe(first);
  });

  it.each(['multiple', 'unoffered', 'duplicate', 'not-array', 'mutated-offer'] as const)(
    'rejects an invalid host selection (%s) without recording a denial', async (kind) => {
      const { env } = createEnvironment();
      env.userAgent.choosePermissionOptions = <T>(request: PermissionChoiceRequest<T>) => {
        const foreign = { id: 'first' };
        let selection: unknown;
        switch (kind) {
          case 'multiple': selection = request.options; break;
          case 'duplicate': selection = [request.options[0], request.options[0]]; break;
          case 'not-array': selection = true; break;
          case 'mutated-offer':
            request.options.push(foreign as T);
            selection = [foreign];
            break;
          default: selection = [foreign];
        }
        return InternalPromise.resolve(selection as PermissionSelection<T>, internalType<PermissionSelection<T>>());
      };
      await expect(env.permissions.promptUserToChoose([{ id: 'first' }, { id: 'second' }], 'test-choice', kind !== 'multiple', undefined)).rejects.toThrow('Permission chooser must');
      expect(env.userAgent.permissionStore.size).toBe(0);
    },
  );

  it('propagates missing features, uninitialized settings, and unavailable policy evaluation', async () => {
    const { env, requests } = createEnvironment([new PermissionFeature('test-choice', originPermissionKey, { policyControlled: true })]);
    await expect(env.permissions.promptUserToChoose(['first'], 'not-installed', false, undefined)).rejects.toThrow('Unknown permission feature');
    const origin = env.topLevelOrigin;
    env.topLevelOrigin = null;
    await expect(env.permissions.promptUserToChoose(['first'], 'test-choice', false, undefined)).rejects.toThrow('requires a top-level origin');
    env.topLevelOrigin = origin;
    const error = new Error('Policy evaluator unavailable');
    env.isAllowedToUse = () => { throw error; };
    await expect(env.permissions.promptUserToChoose(['first'], 'test-choice', false, undefined)).rejects.toBe(error);
    expect(requests).toEqual([]);
  });
});

function createEnvironment(features: PermissionFeature[] = [new PermissionFeature('test-choice', originPermissionKey)]): {
  env: PermissionEnvironment;
  requests: PermissionChoiceRequest<unknown>[];
} {
  const requests: PermissionChoiceRequest<unknown>[] = [];
  const userAgent = createPermissionUserAgent(new PermissionStore(features));
  userAgent.choosePermissionOptions = <T>(request: PermissionChoiceRequest<T>) => {
    requests.push(request);
    const selected = request.options.slice(0, request.allowMultiple ? undefined : 1);
    return InternalPromise.resolve(selected, internalType<PermissionSelection<T>>());
  };
  const env = createPermissionEnvironment(userAgent);
  return { env, requests };
}
