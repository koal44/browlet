import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { InternalError, internalType } from '../../src/infra/index';
import { JSRealm, createMicrotaskQueue } from '../../src/js-engine/index';
import { NodePromise } from '../../src/js-engine/node-promise';
import { Browlet } from '../../src/browlet/browlet';
import { idlType } from '../../src/web-idl/core/index';

import { getRelevantRealm } from './browlet-binding';

/** Exercise the real host error route while retaining diagnostics for assertions. */
async function main(): Promise<void> {
  if (process.argv.includes('--fatal')) {
    const queue = createMicrotaskQueue();
    const realm = new JSRealm(queue);
    realm.InternalPromise.resolve(undefined, internalType<void>()).observe(() => {
      throw new Error('unhandled internal observer failure');
    }, () => { assert.fail('Unexpected source rejection'); });
    queue.performMicrotaskCheckpoint();
    await nextTurn();
    assert.fail('The observer exception should have terminated this process');
  }

  const hostErrors: unknown[] = [];
  const nodeRejections: unknown[] = [];
  const authorRejections: unknown[] = [];
  process.on('uncaughtException', (error, origin) => {
    assert.equal(origin, 'uncaughtException', 'observer failures are host exceptions, not unhandled rejections');
    hostErrors.push(error);
  });
  process.on('unhandledRejection', (reason) => { nodeRejections.push(reason); });

  // Keep this realm outside HTML's automatic wakeups: after the observer runs,
  // its failure must reach Node without another checkpoint on its selected queue.
  const queue = createMicrotaskQueue();
  const standaloneRealm = new JSRealm(queue);
  const queueFailure = new Error('standalone observer failed');
  let queueObserverRan = false;
  standaloneRealm.InternalPromise.resolve(undefined, internalType<void>()).observe(() => {
    queueObserverRan = true;
    throw queueFailure;
  }, () => { assert.fail('Unexpected source rejection'); });
  await nextTurn();
  assert.equal(queueObserverRan, queue.kind !== 'explicit', 'observation retains the selected queue');
  queue.performMicrotaskCheckpoint();
  await nextTurn();
  assert.equal(queueObserverRan, true);
  assert.deepEqual(hostErrors, [queueFailure], 'failure reporting needs no further realm checkpoint');

  const browser = new Browlet({ route: () => '', reporting: false });
  const realm = getRelevantRealm(browser.window);
  const loop = realm.agent.eventLoop;
  const P = realm.env.InternalPromise;
  const type = internalType<void>();
  browser.window.addEventListener('unhandledrejection', (event) => {
    authorRejections.push(event);
    event.preventDefault();
  });

  const fulfillmentFailure = new InternalError('fulfillment observer failed');
  const rejectionFailure = new Error('rejection observer failed');
  const conversionFailure = new InternalError('conversion-failure observer failed');
  const nodeFailure = new InternalError('Node observer failed');
  const declaredFulfillmentFailure = new Error('declared-result fulfillment observer failed');
  const declaredRejectionFailure = new Error('declared-result rejection observer failed');
  const primitiveFailures: unknown[] = [undefined, 'primitive observer failure'];
  const originalReason = new Error('original operation rejected');
  const chainFailure = new Error('chained operation failed');
  const conversionReason = new Error('result conversion failed');
  const observed: unknown[] = [];
  const unexpected: unknown[] = [];
  let fulfillmentRan = false;
  let siblingRan = false;

  const fulfilled = P.resolve(undefined, type);
  fulfilled.observe(() => {
    fulfillmentRan = true;
    throw fulfillmentFailure;
  }, (reason) => { unexpected.push(reason); });
  fulfilled.observe(() => { siblingRan = true; }, (reason) => { unexpected.push(reason); });
  P.reject(originalReason, type).observe(() => { unexpected.push('fulfilled rejection'); }, (reason) => {
    observed.push(reason);
    throw rejectionFailure;
  });
  P.fromNative(Promise.resolve(), () => { throw conversionReason; }, type).observe(
    () => { unexpected.push('fulfilled conversion'); },
    (reason) => { unexpected.push(reason); },
    (reason) => { observed.push(reason); throw conversionFailure; },
  );
  NodePromise.resolve(undefined, type).observe(() => { throw nodeFailure; }, (reason) => { unexpected.push(reason); });
  P.resolve(42, idlType.double).observe((value) => {
    observed.push(value);
    throw declaredFulfillmentFailure;
  }, (reason) => { unexpected.push(reason); });
  P.reject(originalReason, idlType.double).observe(() => { unexpected.push('fulfilled declared rejection'); }, (reason) => {
    observed.push(reason);
    throw declaredRejectionFailure;
  });
  for (const failure of primitiveFailures) {
    P.resolve(undefined, type).observe(() => { throw failure; }, (reason) => { unexpected.push(reason); });
  }

  // Ordinary source rejection and a returned chain's rejection remain available
  // to their callers. They must not be promoted to host failures.
  P.reject(originalReason, type).observe(() => { unexpected.push('fulfilled failure'); }, (reason) => { observed.push(reason); });
  P.resolve(undefined, type).then(() => { throw chainFailure; })
    .observe(() => { unexpected.push('fulfilled failed chain'); }, (reason) => { observed.push(reason); });

  // Author Promise reactions retain their normal exception-to-rejection behavior.
  const author = browser.evaluate(() => Promise.resolve().then(() => {
    throw new Error('author callback failed');
  }).catch((error: Error) => error.message));

  // Stock queues run on Node turns; addon queues also need HTML checkpoints and
  // the queued rejection-notification tasks before absence of leaks is meaningful.
  for (let round = 0; round < 6; round++) {
    await nextTurn();
    loop.performMicrotaskCheckpoint();
    while (loop.runTaskTurn()) { /* Drain reporting tasks as well as reactions. */ }
  }

  assert.equal(fulfillmentRan, true, 'the observer actually ran');
  assert.equal(siblingRan, true, 'a failed observer does not change its source or a sibling observer');
  assert.deepEqual(authorRejections, [], 'internal observer failures must not reach author rejection events');
  assert.deepEqual(nodeRejections, [], 'internal observation must not leave a rejected native Promise unowned');
  const failures = [queueFailure, fulfillmentFailure, rejectionFailure, conversionFailure, nodeFailure,
    declaredFulfillmentFailure, declaredRejectionFailure, ...primitiveFailures];
  assert.equal(hostErrors.length, failures.length, 'each failed observer is reported exactly once');
  for (const error of failures) {
    assert.equal(hostErrors.filter((reported) => reported === error).length, 1, 'host reporting preserves thrown identity');
  }
  assert.deepEqual(unexpected, [], 'observer throws do not invoke the original source rejection handler');
  assert.equal(observed.filter((value) => value === originalReason).length, 3);
  assert.equal(observed.filter((value) => value === 42).length, 1);
  assert.equal(observed.filter((value) => value === conversionReason).length, 1);
  assert.equal(observed.filter((value) => value === chainFailure).length, 1);
  assert.equal(await author, 'author callback failed');
  assert.deepEqual(loop.executionContextStack, []);
  assert.deepEqual(loop.backupIncumbentEnvironmentStack, []);
  console.log('PASS: internal observer failure ownership');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
