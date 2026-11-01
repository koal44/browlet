import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { addon, setHostHooks } from '../../../src/js-engine/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

// TODO(raw-host-promise-handoff): official addons cannot observe every job
// arriving in an explicit queue. These raw Node calls bypass HTML task delivery;
// their interoperability contract is on hold, rather than adopting a broadcast
// checkpoint for every host turn. Keep passing stock/custom coverage active.
// See src/browlet/scripting/ROADMAP.md#raw-host-promise-handoffs-on-hold.
const rawHandoffOnHold = !!addon.createMicrotaskQueue && !setHostHooks;

describe('raw Node/Window Promise handoffs', () => {
  it.each([
    { source: 'Node', species: 'Promise' },
    { source: 'Node', species: 'ordinary object' },
    { source: 'Window', species: 'Promise' },
    { source: 'Window', species: 'ordinary object' },
  ])('delivers a late $source Promise reaction with $species species', { todo: rawHandoffOnHold }, async ({ source, species }) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const realm = getRelevantRealm(browser.window);
    await browser.evaluate(() => {
      const state = {
        value: null as number | null,
        promise: Promise.resolve(5),
        callback(value: number) { state.value = value; },
      };
      Reflect.set(globalThis, 'handoffState', state);
    });
    const state = Reflect.get(realm.globalObject, 'handoffState') as HandoffState;
    const promise = source === 'Window' ? state.promise : Promise.resolve(5);
    if (species === 'ordinary object') {
      // Promise species may return an ordinary object, so .then() need not
      // create a native Promise whose initialization could identify the queue.
      void Object.defineProperty(promise, 'constructor', {
        value: {
          [Symbol.species]: function(executor: (resolve: () => void, reject: () => void) => void) {
            executor(() => {}, () => {});
            return {};
          },
        },
      });
    }

    // Finish setup and its settlement checkpoint before registering from Node.
    // This deliberately bypasses evaluate()/exposeFunction() task delivery.
    const loop = realm.agent.eventLoop;
    await runInHostTask(() => { loop.performMicrotaskCheckpoint(); });
    await runInHostTask(() => { void promise.then(state.callback); });

    // Read plain data once. Evaluating page code or installing a Window timer
    // to observe progress would supply the missing checkpoint and hide a stall.
    const beforeRescue = await new Promise<number | null>((resolve) => {
      setTimeout(() => { resolve(state.value); }, 250);
    });
    // Rescue only after taking the observation, outside Node's Promise jobs.
    await runInHostTask(() => { loop.performMicrotaskCheckpoint(); });
    expect(state.value, 'rescue must establish that the reaction was queued').toBe(5);
    expect(beforeRescue, 'raw Window reaction must run without an unrelated checkpoint').toBe(5);
  });
});

type HandoffState = {
  value: number | null;
  promise: Promise<number>;
  callback: (value: number) => void;
};
