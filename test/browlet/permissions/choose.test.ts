import { describe, expect, it } from 'vitest';

import {
  PermissionFeature, originPermissionKey, PermissionStore, type PermissionChoiceRequest, type PermissionSelection,
} from '../../../src/permissions/index';
import { Browlet } from '../../../src/browlet/browlet';
import { permissionsTaskSource } from '../../../src/browlet/scripting/tasks';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Permissions §5.3: browser host chooser', () => {
  it('adapts an asynchronous host selection with origins and prompt details, without queueing a decision', async () => {
    let finish!: () => void;
    const prompts: (PermissionChoiceRequest<unknown> & { origin: string; topLevelOrigin: string; })[] = [];
    const browser = new Browlet({
      route: () => '',
      permissionChooser: <T>(request: PermissionChoiceRequest<T> & { origin: string; topLevelOrigin: string; }) => {
        prompts.push(request);
        const result = Promise.withResolvers<PermissionSelection<T>>();
        finish = () => { result.resolve(request.options.slice(-1)); };
        return result.promise;
      },
    });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    // No installed browser API currently consumes the chooser; use a synthetic feature.
    env.userAgent.permissionStore = new PermissionStore([new PermissionFeature('test-choice', originPermissionKey)]);
    const options = [{ id: 'first' }, { id: 'second' }];
    const result = env.permissions.promptUserToChoose(options, 'test-choice', false, 'Choose one device');
    expect(prompts).toEqual([{
      descriptor: { name: 'test-choice' }, options, allowMultiple: false, extraInformation: 'Choose one device',
      origin: 'https://example.test', topLevelOrigin: 'https://example.test',
    }]);
    finish();
    const selected = await result;
    expect(selected).toEqual([options[1]]);
    expect(selected[0]).toBe(options[1]);
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
  });

  it('denies selection without a configured host chooser', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.permissionStore = new PermissionStore([new PermissionFeature('test-choice', originPermissionKey)]);
    expect(await env.permissions.promptUserToChoose(['first'], 'test-choice', false, undefined)).toBe('denied');
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it.each(['throw', 'reject', 'invalid'] as const)('propagates a host %s without storing a decision', async (kind) => {
    const error = new Error('Chooser UI failed');
    const browser = new Browlet({
      route: () => '',
      permissionChooser: () => {
        if (kind === 'throw') throw error;
        if (kind === 'reject') return Promise.reject(error);
        return true as unknown as 'denied';
      },
    });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.permissionStore = new PermissionStore([new PermissionFeature('test-choice', originPermissionKey)]);
    const result = env.permissions.promptUserToChoose(['first'], 'test-choice', false, undefined);
    if (kind === 'invalid') await expect(result).rejects.toThrow('must return an array or denied');
    else await expect(result).rejects.toBe(error);
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
  });
});
