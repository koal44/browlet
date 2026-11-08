import { afterEach, describe, expect, it, vi } from 'vitest';

import { JSRealm } from '../../../src/js-engine/index';
import type { TaskSourceKey } from '../../../src/infra/index';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import { jsEngineTaskSource, taskSources } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

// Control only the external engine-completion notification. HTML environments,
// Document lifetime, task scheduling, and script entry remain real on every base.
describe('WebAssembly completion task delivery', () => {
  it.each(['engine', 'network'] as const)('waits for its Document and enters its owning environment (%s)', async (source) => {
    const { document, traversable, notify } = fixture();
    const { env } = document;
    const loop = env.responsibleEventLoop;
    const complete = vi.fn(() => {
      expect(loop.currentlyRunningTask?.source).toBe(taskSources[source]);
      expect(loop.currentlyRunningTask?.document).toBe(document);
      expect(loop.entryExecutionContext).toBe(env.realm.executionContext);
    });
    const activeEntry = traversable.activeSessionHistoryEntry;
    traversable.activeSessionHistoryEntry = env.createSessionHistoryEntry(activeEntry.url, new DocumentState());

    notify(complete, source);
    expect(loop.runTaskTurn()).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    traversable.activeSessionHistoryEntry = activeEntry;
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });

    expect(complete).toHaveBeenCalledOnce();
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.currentlyRunningTask).toBeNull();
  });

  it.each(['engine', 'network'] as const)('discards queued and later completions when its Document is destroyed (%s)', async (source) => {
    const { document, notify } = fixture();
    const loop = document.env.responsibleEventLoop;
    const complete = vi.fn();
    loop.queueTask(jsEngineTaskSource, document, { run: () => { document.destroy(); } });
    notify(complete, source);
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });

    expect(loop.getTaskQueue(taskSources[source]).size).toBe(0);
    notify(complete, source);
    expect(loop.getTaskQueue(taskSources[source]).size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });
});

type CompletionScheduler = (complete: () => void, source: TaskSourceKey) => void;

function fixture() {
  const callbacks = new Map<JSRealm, CompletionScheduler>();
  vi.spyOn(JSRealm.prototype, 'setWasmAsyncCompletionCallback').mockImplementation(function(this: JSRealm, callback) {
    if (callback !== undefined) callbacks.set(this, callback);
  });
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = traversable.activeDocument!;
  return { document, traversable, notify: callbacks.get(document.env.realm)! };
}
