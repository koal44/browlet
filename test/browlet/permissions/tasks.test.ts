import { describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { permissionsTaskSource, storageTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../support/browlet-agent';

describe('Permissions §3.4: permissions task source', () => {
  it('queues work on the owning global and keeps permissions separate from storage work', () => {
    const userAgent = createManualUserAgent();
    const env = TopLevelTraversable.create(userAgent, null, '').activeWindow!.env;
    const otherEnv = TopLevelTraversable.create(userAgent, null, '').activeWindow!.env;
    const loop = env.responsibleEventLoop;
    const trace: string[] = [];
    env.queueTask('permissions', () => { trace.push('first'); });
    env.queueTask('permissions', () => { trace.push('second'); });

    expect(trace).toEqual([]);
    expect([...loop.getTaskQueue(permissionsTaskSource)].map((task) => task.document))
      .toEqual([env.getAssociatedDocument(), env.getAssociatedDocument()]);
    expect(loop.getTaskQueue(storageTaskSource).size).toBe(0);
    expect(otherEnv.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(trace).toEqual(['first', 'second']);
  });

  it('removes pending permission work when its Document is destroyed', () => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const env = traversable.activeWindow!.env;
    const document = traversable.activeDocument!;
    const steps = vi.fn();
    env.queueTask('permissions', () => { document.destroy(); });
    env.queueTask('permissions', steps);
    env.responsibleEventLoop.runTaskTurn();
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(steps).not.toHaveBeenCalled();
  });
});
