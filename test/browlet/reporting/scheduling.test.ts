import { describe, expect, it } from 'vitest';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createTestDocument } from '../../support/dom';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createTaskSource } from '../../../src/browlet/scripting/event-loop';

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
    const userAgent = new UserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
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
    const userAgent = new UserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
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
