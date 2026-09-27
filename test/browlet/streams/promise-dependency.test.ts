import { idlType } from '../../../src/web-idl/core/index';
import { describe, expect } from 'vitest';
import { itPassesWith } from '../../test-runtime';
import { Browlet } from '../../../src/browlet/browlet';
import { getBindingContext, getRelevantRealm } from '../../../src/browlet/bindings';
import { ReadableStreamImpl, WritableStreamImpl } from '../../../src/streams/index';

describe('Streams Promise dependencies', () => {
  itPassesWith('explicitQueues')('reads an iterator result in the consuming stream destination', () => {
    const a = createOwner();
    const b = createOwner();
    const next = b.Promise.withResolvers(idlType.DOMString);
    const stream = ReadableStreamImpl.from({
      next: () => next.promise,
      return: () => b.Promise.resolve(undefined, idlType.undefined),
    }, a.env);
    const chunks: unknown[] = [];
    stream.getReader({}).read().observe((value) => { chunks.push(value); }, (error) => { throw error; });
    next.resolve('chunk');
    a.queue.performMicrotaskCheckpoint();
    expect(chunks).toEqual([{ value: 'chunk', done: false }]);
  });

  itPassesWith('explicitQueues')('pipes between owners without moving the source continuation to the destination queue', () => {
    const a = createOwner();
    const b = createOwner();
    const source = new ReadableStreamImpl({}, {}, a.env);
    const chunks: unknown[] = [];
    const destination = new WritableStreamImpl({
      write(chunk) { chunks.push(chunk); },
    }, {}, b.env);
    a.queue.performMicrotaskCheckpoint();
    b.queue.performMicrotaskCheckpoint();
    source.enqueueChunk('chunk');
    source.close();
    let finished = false;
    source.pipeTo(destination, {
      preventAbort: false, preventCancel: false, preventClose: false,
    }).observe(() => { finished = true; }, (error) => { throw error; });

    a.queue.performMicrotaskCheckpoint();
    expect(chunks).toEqual(['chunk']);
    expect(finished).toBe(false);
    for (let turn = 0; turn < 3; turn++) {
      b.queue.performMicrotaskCheckpoint();
      a.queue.performMicrotaskCheckpoint();
    }
    expect(finished).toBe(true);
    expect(source.locked).toBe(false);
    expect(destination.locked).toBe(false);
  });
});

function createOwner() {
  const { window } = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(window);
  const env = getBindingContext(realm).getEnvironment();
  return { queue: realm.agent.eventLoop, Promise: env.exec.Promise, env };
}
