import { describe, expect, it } from 'vitest';
import { createTestDocument } from '../../support/dom';
import { createNewTopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { requestNodeEventLoopTurn } from '../../../src/browlet/integration/scripting';
import { unsafeSharedCurrentTime } from '../../../src/browlet/performance/high-resolution-time';
import { createTaskSource } from '../../../src/browlet/scripting/event-loop';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createMicrotaskQueue } from '../../../src/js-engine/index';

describe('Browser-owned Reporting scheduling', () => {
  it('runs on a later turn without requiring a Window or HTML checkpoint', async () => {
    const userAgent = new UserAgent();
    const trace: string[] = [];
    const completion = new Promise<void>((resolve) => {
      userAgent.queueReportingTask(() => { trace.push('report'); resolve(); });
    });
    expect(trace).toEqual([]);
    await completion;
    expect(trace).toEqual(['report']);
  });

  it('yields to runnable page tasks even when reporting was scheduled first', async () => {
    const userAgent = new UserAgent({
      createMicrotaskQueue, requestEventLoopTurn: requestNodeEventLoopTurn, unsafeSharedCurrentTime,
    });
    const traversable = createNewTopLevelTraversable(userAgent, null, '');
    const realm = getRelevantRealm(traversable.activeWindow!);
    const source = createTaskSource('reporting scheduling test');
    const trace: string[] = [];
    const completion = new Promise<void>((resolve) => {
      userAgent.queueReportingTask(() => { trace.push('report'); resolve(); });
    });
    realm.queueGlobalTask(source, () => { trace.push('first page task'); });
    realm.queueGlobalTask(source, () => { trace.push('second page task'); });
    await completion;
    expect(trace).toEqual(['first page task', 'second page task', 'report']);
  });

  it('does not wait for tasks whose Document is inactive', async () => {
    const userAgent = new UserAgent({
      createMicrotaskQueue, requestEventLoopTurn: requestNodeEventLoopTurn, unsafeSharedCurrentTime,
    });
    const traversable = createNewTopLevelTraversable(userAgent, null, '');
    const eventLoop = getRelevantRealm(traversable.activeWindow!).agent.eventLoop;
    const source = createTaskSource('inactive reporting scheduling test');
    const trace: string[] = [];
    eventLoop.queueTask(source, createTestDocument(), () => { trace.push('inactive task'); });
    await new Promise<void>((resolve) => {
      userAgent.queueReportingTask(() => { trace.push('report'); resolve(); });
    });
    expect(trace).toEqual(['report']);
    expect(eventLoop.getTaskQueue(source).size).toBe(1);
  });
});
