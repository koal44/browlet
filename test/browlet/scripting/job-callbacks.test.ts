import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { ErrorEvent } from '../../../src/browlet/platform';
import type { JSExecutionContext } from '../../../src/browlet/scripting/execution-context';
import { ClassicScript, JSModuleScript, type Script } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { getRelevantRealm } from '../../support/browlet-binding';
import { mockEventLoopTurns } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';
import { createSiblingWindow } from '../../support/windows';
import { itPassesWith } from '../../test-runtime';

// The existing approved missing-host-hook failures apply to stock Node and
// official addon bases; all assertions remain enabled on those backends.
const testJob = itPassesWith('hostHooks');

afterEach(() => vi.restoreAllMocks());

describe('HTML HostMakeJobCallback and HostCallJobCallback', () => {
  testJob('keeps repeated source evaluation separate from the calling HTML script', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const observations: (Script | null)[] = [];
      Reflect.set(f.realm.globalObject, 'observe', () => observations.push(f.loop.activeScript));
      const source = '() => Promise.resolve().then(() => observe())';
      f.realm.evaluate(source, 'evaluation.js');
      Reflect.set(f.realm.globalObject, 'registerFromEvaluation', f.realm.evaluate(source, 'evaluation.js'));
      const definingScript = f.script('globalThis.registerFromScript = () => Promise.resolve().then(() => observe())');
      expect(definingScript.run().type).toBe('normal');
      const callingScript = f.script('registerFromEvaluation(); registerFromScript();');
      expect(callingScript.run().type).toBe('normal');
      f.loop.performMicrotaskCheckpoint();

      expect(observations).toHaveLength(2);
      expect(observations[0]).toBeNull();
      expect(observations[1] === definingScript).toBe(true);
      expect(f.loop.executionContextStack).toEqual([]);
    });
  });

  for (const muted of [true, false]) {
    // Missing hooks already leave errors unmuted, so that control passes everywhere.
    const testRegistration = muted ? testJob : it;
    testRegistration(`keeps the registering function's muting instead of its caller's (muted: ${muted})`, async () => {
      await runInHostTask(() => {
        const f = fixture();
        const other = createSiblingWindow(f.browser);
        const events: ErrorEvent[] = [];
        other.addEventListener('error', (event) => {
          event.preventDefault();
          events.push(event as ErrorEvent);
        });
        Reflect.set(f.realm.globalObject, 'report', other.reportError.bind(other));
        const definingScript = f.script(`
          globalThis.register = () => Promise.resolve('private message').then(report);
        `, muted);
        expect(definingScript.run().type).toBe('normal');
        const callingScript = f.script('register()', !muted);
        expect(callingScript.run().type).toBe('normal');
        f.loop.performMicrotaskCheckpoint();

        expect(events.map(({ message }) => message)).toEqual([muted ? 'Script error.' : 'private message']);
        expect(events[0]!.error).toBe(muted ? null : 'private message');
        expect(f.loop.executionContextStack).toEqual([]);
        expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
      });
    });
  }

  testJob('captures a module registering callbacks before and after top-level await', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const observations: (Script | null)[] = [];
      const gate = f.realm.NativePromise.withResolvers<void>();
      Reflect.set(f.realm.globalObject, 'gate', gate.promise);
      Reflect.set(f.realm.globalObject, 'observe', () => observations.push(f.loop.activeScript));
      const script = new JSModuleScript(`
        Promise.resolve().then(() => observe());
        await gate;
        Promise.resolve().then(() => observe());
      `, f.env, f.env.apiBaseURL, new ScriptFetchOptions());
      script.compiled!.link();
      let completed = false;
      const rejected = vi.fn();
      script.run(true).observe(() => { completed = true; }, rejected);
      f.loop.performMicrotaskCheckpoint();
      expect(rejected).not.toHaveBeenCalled();
      expect(completed).toBe(false);
      expect(observations.map((value) => value === script)).toEqual([true]);

      gate.resolve();
      f.loop.performMicrotaskCheckpoint();
      expect(completed).toBe(true);
      expect(observations.map((value) => value === script)).toEqual([true, true]);
      expect(f.loop.executionContextStack).toEqual([]);
      expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  testJob('retains each script independently when the same platform method is registered twice', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const other = createSiblingWindow(f.browser);
      const events: ErrorEvent[] = [];
      other.addEventListener('error', (event) => {
        event.preventDefault();
        events.push(event as ErrorEvent);
      });
      // A foreign built-in callback has no script of its own. Its receiver
      // selects the reporting global; the registering script supplies muting.
      Reflect.set(f.realm.globalObject, 'report', other.reportError.bind(other));
      const first = f.script(`
        globalThis.pending = Promise.withResolvers();
        pending.promise.then(report);
        pending.resolve;
      `);
      const settle = first.run().value as (value: unknown) => void;
      const second = f.script('pending.promise.then(report)', true);
      expect(second.run().type).toBe('normal');
      expect(events).toEqual([]);
      settle('private message');
      f.loop.performMicrotaskCheckpoint();

      expect(events.map(({ message }) => message)).toEqual(['private message', 'Script error.']);
      expect(events[0]!.error).toBe('private message');
      expect(events[1]!.error).toBeNull();
      expect(f.loop.executionContextStack).toEqual([]);
      expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  testJob('restores a fresh script context and unwinds it after a throwing reaction', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const observations: { label: string; value: unknown; context: JSExecutionContext | null; }[] = [];
      Reflect.set(f.realm.globalObject, 'observe', (label: string, value: unknown) => {
        observations.push({ label, value, context: f.loop.runningExecutionContext });
      });
      const script = f.script(`
        observe('registration', undefined);
        globalThis.failure = {};
        Promise.resolve(17).then(value => {
          observe('fulfillment', value);
          throw failure;
        }).catch(error => observe('rejection', error === failure));
      `);
      expect(script.run().type).toBe('normal');
      f.loop.performMicrotaskCheckpoint();

      expect(observations.map(({ label, value }) => [label, value])).toEqual([
        ['registration', undefined], ['fulfillment', 17], ['rejection', true],
      ]);
      const original = observations[0]!.context;
      const fulfilled = observations[1]!.context;
      const rejected = observations[2]!.context;
      for (const context of [fulfilled, rejected]) {
        expect(context?.scriptOrModule === script.compiled, 'restored script record').toBe(true);
        expect(context?.realm === f.realm, 'script context realm').toBe(true);
        expect(context?.function).toBeNull();
        expect(context?.skipWhenDeterminingIncumbent).toBe(0);
        expect(context).not.toBe(original);
      }
      expect(fulfilled).not.toBe(rejected);
      expect(f.loop.executionContextStack).toEqual([]);
      expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  testJob('retains the registering script for foreign eval even when another script settles the Promise', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const other = createSiblingWindow(f.browser);
      const otherRealm = getRelevantRealm(other);
      const events: ErrorEvent[] = [];
      other.addEventListener('error', (event) => {
        event.preventDefault();
        events.push(event as ErrorEvent);
      });
      // HostMakeJobCallback's eval example needs the registering script because
      // eval has no ScriptOrModule of its own. Error muting exercises that path
      // before HostLoadImportedModule supplies the example's import() consumer.
      Reflect.set(f.realm.globalObject, 'foreignEval', Reflect.get(otherRealm.globalObject, 'eval'));
      const registeringScript = f.script(`
        globalThis.pending = Promise.withResolvers();
        pending.promise.then(foreignEval);
        pending.resolve;
      `, true);
      const registered = registeringScript.run();
      expect(registered.type).toBe('normal');
      expect(events).toEqual([]);
      Reflect.set(f.realm.globalObject, 'settle', registered.value);
      const settlingScript = f.script('settle(\'reportError("private message")\'); "settled";');
      expect(settlingScript.run()).toEqual({ type: 'normal', value: 'settled' });
      f.loop.performMicrotaskCheckpoint();

      // The unmuted settling script and eval's foreign realm must not replace
      // the muted script captured when the reaction was registered.
      expect(events.map(({ message }) => message)).toEqual(['Script error.']);
      expect(events[0]!.error).toBeNull();
      expect(f.loop.executionContextStack).toEqual([]);
      expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  testJob('preserves thenable receivers and restores the active script for nested registrations', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const observations: { label: string; value: unknown; script: Script | null; }[] = [];
      Reflect.set(f.realm.globalObject, 'observe', (label: string, value: unknown) => {
        observations.push({ label, value, script: f.loop.activeScript });
      });
      const script = f.script(`
        const thenable = {
          then(resolve, reject) {
            observe('thenable', this === thenable && typeof reject === 'function');
            Promise.resolve(42).then(value => observe('nested', value));
            resolve(17);
          }
        };
        Promise.resolve(thenable).then(value => observe('fulfilled', value));
      `);
      expect(script.run().type).toBe('normal');
      f.loop.performMicrotaskCheckpoint();

      expect(observations.map(({ label, value }) => [label, value])).toEqual([
        ['thenable', true], ['nested', 42], ['fulfilled', 17],
      ]);
      expect(observations.map((entry) => entry.script === script)).toEqual([true, true, true]);
      expect(f.loop.executionContextStack).toEqual([]);
      expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  testJob('keeps a registration without an HTML script scriptless during its callback', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const observations: { active: unknown; hasIncumbent: boolean; }[] = [];
      Reflect.set(f.realm.globalObject, 'observe', () => {
        observations.push({
          active: f.loop.activeScript,
          hasIncumbent: f.loop.backupIncumbentEnvironmentStack.at(-1) === f.env,
        });
      });
      // This convenience entry has an explicit context but no parsed HTML script.
      f.realm.evaluate('Promise.resolve().then(() => observe())', 'scriptless.js');

      expect(observations).toEqual([{ active: null, hasIncumbent: true }]);
      expect(f.loop.executionContextStack).toEqual([]);
      expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  it('leaves unrelated Node callbacks outside the HTML stack', async () => {
    const f = fixture();
    const value = {};
    const result = await Promise.resolve(value).then((received) => {
      expect(f.loop.executionContextStack).toEqual([]);
      expect(f.loop.backupIncumbentEnvironmentStack).toEqual([]);
      return received;
    });
    expect(result).toBe(value);
  });
});

function fixture() {
  mockEventLoopTurns();
  const browser = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(browser.window);
  const { env } = realm;
  return {
    browser, realm, env, loop: env.responsibleEventLoop,
    script: (source: string, muted = false) => new ClassicScript(
      source, env, env.apiBaseURL, new ScriptFetchOptions(), muted,
    ),
  };
}
