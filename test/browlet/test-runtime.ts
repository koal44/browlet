import { getRelevantRealm } from '../../src/browlet/bindings';

/*
 * Direct calls from Vitest do not enter Browlet through an HTML script or
 * task boundary. End that test-controlled host entry explicitly so a
 * compatible Node can drain the Agent's isolated JavaScript microtask queue.
 */
export function performTestMicrotaskCheckpoint(global: object): void {
  const eventLoop = getRelevantRealm(global).agent.eventLoop;
  if (eventLoop.microtaskQueue.kind === 'explicit') {
    eventLoop.performMicrotaskCheckpoint();
  }
}

/*
 * Attach the Vitest-realm observer before checkpointing. Awaiting a Promise
 * from an explicit V8 queue would otherwise install its reaction after the
 * last Browlet checkpoint and leave that reaction pending.
 */
export function observeBrowletPromise<Result>(
  global: object,
  promise: Promise<Result>,
): Promise<Result> {
  const realm = getRelevantRealm(global);
  const completion = Promise.withResolvers<Result>();
  Reflect.apply(realm.intrinsics.promise.then, promise, [
    completion.resolve,
    completion.reject,
  ]);
  return completion.promise;
}
