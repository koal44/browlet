import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { Window } from '../../../../src/browlet/platform';
import type { PermissionState } from '../../../../src/permissions/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §9.2: write permission', () => {
  it('registers both descriptor aspects with prompt defaults and Web IDL boolean conversion', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      const permissions = (window as unknown as Window).navigator.permissions;
      const base = await permissions.query({ name: 'clipboard-write' });
      const weak = await permissions.query({ name: 'clipboard-write', allowWithoutGesture: false });
      const strong = await permissions.query({ name: 'clipboard-write', allowWithoutGesture: 'yes' });
      return [base.name, base.state, weak.state, strong.state];
    })).toEqual(['clipboard-write', 'prompt', 'prompt', 'prompt']);
    expect(f.prompt).not.toHaveBeenCalled();
  });

  it.each([
    ['prompt', 'granted', 'granted', 'granted'],
    ['denied', 'prompt', 'denied', 'denied'],
    ['granted', 'denied', 'granted', 'denied'],
    ['denied', 'granted', 'denied', 'denied'],
  ] as const)('resolves weaker %s / stronger %s consistently', async (weak, strong, weakResult, strongResult) => {
    const f = await createFixture();
    record(f, false, weak); record(f, true, strong);
    expect(await f.browser.evaluate(async () => {
      const permissions = (window as unknown as Window).navigator.permissions;
      return [(await permissions.query({ name: 'clipboard-write', allowWithoutGesture: false })).state,
        (await permissions.query({ name: 'clipboard-write', allowWithoutGesture: true })).state];
    })).toEqual([weakResult, strongResult]);
  });

  it('uses a no-gesture grant without consulting activation, provenance or prompting', async () => {
    const f = await createFixture(); record(f, true, 'granted');
    expect(await writeEmpty(f.browser)).toEqual({ accepted: true, promise: true });
    expect(f.activation).not.toHaveBeenCalled(); expect(f.copy).not.toHaveBeenCalled();
    expect(f.prompt).not.toHaveBeenCalled();
  });

  it('accepts an activated native Cut/Copy interaction without asking permission', async () => {
    const f = await createFixture(); f.copy.mockReturnValue(true);
    expect(await writeEmpty(f.browser)).toMatchObject({ accepted: true });
    expect(f.prompt).not.toHaveBeenCalled();
  });

  it.each([true, false])('requests the correct descriptor with activation=%s', async (activation) => {
    const f = await createFixture(); f.activation.mockReturnValue(activation);
    expect(await writeEmpty(f.browser)).toMatchObject({ accepted: true });
    expect(f.prompt).toHaveBeenCalledExactlyOnceWith({
      descriptor: { name: 'clipboard-write', allowWithoutGesture: !activation },
      origin: 'https://clipboard.test', topLevelOrigin: 'https://clipboard.test',
    });
    expect(f.copy).toHaveBeenCalledTimes(activation ? 1 : 0);
  });

  it('denies the stronger request when the weaker permission is denied', async () => {
    const f = await createFixture(); record(f, false, 'denied'); f.activation.mockReturnValue(false);
    const tasks = vi.spyOn(f.env, 'queueTask');
    expect(await writeEmpty(f.browser)).toMatchObject({ error: 'NotAllowedError', realm: true, promise: true });
    expect(f.prompt).not.toHaveBeenCalled();
    expect(tasks.mock.calls.map(([source]) => source)).toEqual(['automation', 'permissions']);
  });

  it('does not treat a denied prompt result as a truthy permission grant', async () => {
    const f = await createFixture(); f.prompt.mockReturnValue(false);
    expect(await writeEmpty(f.browser)).toMatchObject({ error: 'NotAllowedError', realm: true });
  });

  it('waits for consent and retains the calling task activation facts', async () => {
    const f = await createFixture();
    const answer = Promise.withResolvers<boolean>(); const asked = Promise.withResolvers<void>();
    f.prompt.mockImplementation(() => { asked.resolve(); return answer.promise; });
    let settled = false;
    const result = writeEmpty(f.browser).then((value) => { settled = true; return value; });
    await asked.promise;
    expect(settled).toBe(false); f.activation.mockReturnValue(false);
    answer.resolve(true);
    expect(await result).toMatchObject({ accepted: true });
    expect(f.prompt.mock.calls[0]![0].descriptor).toEqual({ name: 'clipboard-write', allowWithoutGesture: false });
    expect(f.activation).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale request after consent, before native data work', async () => {
    const f = await createFixture();
    const answer = Promise.withResolvers<boolean>(); const asked = Promise.withResolvers<void>();
    f.prompt.mockImplementation(() => { asked.resolve(); return answer.promise; });
    const write = vi.spyOn(f.system, 'writeItems');
    const result = writeEmpty(f.browser); await asked.promise;
    f.focus.mockReturnValue(false); answer.resolve(true);
    expect(await result).toMatchObject({ error: 'NotAllowedError' });
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps missing native provenance observable instead of inferring it from activation', async () => {
    const f = await createFixture(); f.copy.mockRestore();
    expect(await writeEmpty(f.browser)).toMatchObject({ message: 'Native Cut/Copy interaction provenance is not implemented' });
    expect(f.prompt).not.toHaveBeenCalled();
  });

  it('uses the existing host prompt default of denial', async () => {
    const f = await createFixture(); f.prompt.mockRestore();
    expect(await writeEmpty(f.browser)).toMatchObject({ error: 'NotAllowedError' });
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '' }); await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env;
  const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const activation = vi.spyOn(env.window, 'hasTransientActivation').mockReturnValue(true);
  const copy = vi.spyOn(system, 'isCopyInteraction').mockReturnValue(false);
  const prompt = vi.spyOn(env.userAgent, 'onPermissionPrompt').mockReturnValue(true);
  return { browser, env, document, system, focus, activation, copy, prompt };
}
function record(f: Awaited<ReturnType<typeof createFixture>>, allowWithoutGesture: boolean, state: PermissionState) {
  f.env.userAgent.permissionStore.setEntry({ name: 'clipboard-write', allowWithoutGesture }, f.env.topLevelOrigin, state);
}
async function writeEmpty(browser: Browlet) {
  return browser.evaluate(async () => {
    const p = (window as unknown as Window).navigator.clipboard.write([]);
    try { await p; return { accepted: true, promise: p instanceof Promise }; }
    catch (error) { return {
      error: (error as Error).name, message: (error as Error).message,
      realm: error instanceof DOMException, promise: p instanceof Promise,
    }; }
  });
}
