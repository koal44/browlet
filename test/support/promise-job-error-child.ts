import assert from 'node:assert/strict';

import { Browlet } from '../../src/browlet/browlet';
import type { ErrorEvent } from '../../src/browlet/platform';
import { getRelevantRealm } from './browlet-binding';
import { createSiblingWindow } from './windows';

async function main(): Promise<void> {
  const hostErrors: unknown[] = [];
  process.on('uncaughtException', (error) => { hostErrors.push(error); });
  const browser = new Browlet({ route: () => '', reporting: false });
  const caller = getRelevantRealm(browser.window);
  const foreignWindow = createSiblingWindow(browser);
  const handlerRealm = getRelevantRealm(foreignWindow);
  const loop = caller.agent.eventLoop;
  const reports: { owner: string; error: unknown; }[] = [];
  let cleanedUpBeforeReporting = false;
  for (const realm of [caller, handlerRealm]) {
    const reportException = realm.reportException.bind(realm);
    realm.reportException = (exception) => {
      cleanedUpBeforeReporting = loop.executionContextStack.length === 0 &&
        loop.backupIncumbentEnvironmentStack.length === 0;
      reportException(exception);
    };
  }
  browser.window.addEventListener('error', (event) => {
    event.preventDefault();
    reports.push({ owner: 'caller', error: (event as ErrorEvent).error });
  });
  foreignWindow.addEventListener('error', (event) => {
    event.preventDefault();
    reports.push({ owner: 'handler', error: (event as ErrorEvent).error });
  });
  Reflect.set(caller.globalObject, 'foreignHandler', handlerRealm.evaluate('(value => value)', 'handler.js'));
  const failure = {};
  Reflect.set(caller.globalObject, 'failure', failure);
  const observations: string[] = [];
  Reflect.set(caller.globalObject, 'observe', (value: string) => { observations.push(value); });
  const revoked = process.argv[2] === 'revoked';
  Reflect.set(caller.globalObject, 'revokedHandler', revoked);

  // The derived promise's custom settlement functions throw, so the entire
  // engine job completes abruptly rather than rejecting an ordinary Promise.
  // Exercise both a successful foreign handler and a revoked Proxy handler.
  caller.evaluate(`
    const promise = Promise.resolve(17);
    promise.constructor = {
      [Symbol.species]: class {
        constructor(executor) {
          executor(() => { throw failure; }, () => { throw failure; });
        }
      }
    };
    if (revokedHandler) {
      const { proxy, revoke } = Proxy.revocable(() => {}, {});
      revoke();
      promise.then(proxy, foreignHandler);
    } else {
      promise.then(foreignHandler);
    }
    Promise.resolve().then(() => { throw failure; })
      .catch(error => observe(error === failure ? 'rejected normally' : 'wrong rejection'));
    queueMicrotask(() => observe('following microtask'));
  `, 'abrupt-job.js');
  // Stock queues can finish outside the explicit checkpoint. Their Node error
  // listener above prevents a process crash from hiding the failed assertions.
  await new Promise<void>((resolve) => setImmediate(resolve));

  // ECMAScript uses the current realm when GetFunctionRealm cannot inspect a
  // revoked Proxy. V8 can still select the other handler's realm for its queue.
  assert.deepEqual(reports, [{ owner: revoked ? 'caller' : 'handler', error: failure }],
    'an abrupt Promise job reports to its specified realm, not merely its queue realm');
  assert.equal(reports[0]!.error, failure, 'preserve the thrown value identity');
  assert.equal(cleanedUpBeforeReporting, true, 'report only after script and callback cleanup');
  assert.deepEqual(hostErrors, [], 'browser Promise job errors must not reach Node');
  assert.deepEqual(observations, ['following microtask', 'rejected normally']);
  assert.deepEqual(loop.executionContextStack, []);
  assert.deepEqual(loop.backupIncumbentEnvironmentStack, []);
  assert.equal(loop.currentlyRunningTask, null);
  console.log('PASS: Promise job error reporting');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
