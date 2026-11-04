import { assert, describe, expect, it, vi } from 'vitest';

import { BrowsingContext, BrowsingContextGroup } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { AgentCluster } from '../../../../src/browlet/scripting/agents';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { InternalError } from '../../../../src/infra/index';
import { obtainURLOrigin, parseURL, type Origin } from '../../../../src/url/index';
import { collectGarbage } from '../../../support/garbage-collection';

describe('browsing context group membership', () => {
  it('registers the group before creating its first context and Document', () => {
    const userAgent = new UserAgent();
    const createWindowEnvironment = userAgent.createWindowEnvironment;
    const create = vi.spyOn(userAgent, 'createWindowEnvironment').mockImplementation((init) => {
      expect(userAgent.browsingContextGroupSet.size).toBe(1);
      const [group] = userAgent.browsingContextGroupSet;
      assert(group !== undefined);
      expect(group.browsingContextSet.size).toBe(0);
      expect(group.crossOriginIsolationMode).toBe('none');
      return createWindowEnvironment(init);
    });

    const [group, document] = BrowsingContextGroup.create(userAgent);
    const context = document.browsingContext!;
    expect(create).toHaveBeenCalledOnce();
    expect(document.URL).toBe('about:blank');
    expect(context.activeDocument).toBe(document);
    expect(context.group).toBe(group);
    expect(group.browsingContextSet).toEqual(new Set([context]));
    expect(userAgent.browsingContextGroupSet).toEqual(new Set([group]));
    expect(context.isAuxiliary).toBe(false);
  });

  it('preserves context order and unregisters only the group whose last context was removed', () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const otherGroup = userAgent.createBrowsingContextGroup();
    const first = new BrowsingContext();
    const second = new BrowsingContext();
    const other = new BrowsingContext();
    expect(first.group).toBeNull();

    group.append(first);
    group.append(second);
    group.append(first);
    otherGroup.append(other);
    expect([...group.browsingContextSet]).toEqual([first, second]);

    group.remove(first);
    expect(first.group).toBeNull();
    expect(second.group).toBe(group);
    expect([...group.browsingContextSet]).toEqual([second]);
    expect([...userAgent.browsingContextGroupSet]).toEqual([group, otherGroup]);

    group.remove(second);
    expect(second.group).toBeNull();
    expect(group.browsingContextSet.size).toBe(0);
    expect([...userAgent.browsingContextGroupSet]).toEqual([otherGroup]);
    expect(other.group).toBe(otherGroup);
  });

  it('rejects inconsistent membership without disturbing either group', () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const otherGroup = userAgent.createBrowsingContextGroup();
    const context = new BrowsingContext();
    group.append(context);

    expect(() => { otherGroup.append(context); }).toThrow(InternalError);
    expect(() => { otherGroup.remove(context); }).toThrow(InternalError);
    expect(() => { userAgent.removeBrowsingContextGroup(group); }).toThrow(InternalError);
    expect(context.group).toBe(group);
    expect([...group.browsingContextSet]).toEqual([context]);
    expect(otherGroup.browsingContextSet.size).toBe(0);
    expect([...userAgent.browsingContextGroupSet]).toEqual([group, otherGroup]);
  });
});

describe('browsing context group cluster lifetime', () => {
  it.each([false, true])('collects an unreachable cluster while retaining its original origin-keying choice (%s)', async (originKeyed) => {
    const group = new UserAgent().createBrowsingContextGroup();
    const origin = obtainURLOrigin(parseURL('https://example.com/').url!);
    const collected = createCollectibleCluster(group, origin, originKeyed);
    const key = group.historicalAgentClusterKeyMap.get(origin)!;

    await collectGarbage([collected]);

    expect(collected.deref() === undefined).toBe(true);
    expect([...group.agentClusterMap.values()]).toEqual([]);
    expect(group.agentClusterMap.get(key)).toBeUndefined();
    expect(group.historicalAgentClusterKeyMap.has(origin)).toBe(true);
    expect(group.historicalAgentClusterKeyMap.get(origin)).toBe(key);

    const replacement = group.obtainSimilarOriginWindowAgent(origin, !originKeyed);
    expect(replacement.agentCluster!.isOriginKeyed).toBe(originKeyed);
    expect(group.agentClusterMap.get(key)).toBe(replacement.agentCluster);
  });

  it('retains live clusters in insertion order and appends a recreated collected entry', async () => {
    const group = new UserAgent().createBrowsingContextGroup();
    const origin = obtainURLOrigin(parseURL('https://example.com/').url!);
    const otherOrigin = obtainURLOrigin(parseURL('https://other.test/').url!);
    const collected = createCollectibleCluster(group, origin, true);
    const live = group.obtainSimilarOriginWindowAgent(otherOrigin, true).agentCluster!;

    await collectGarbage([collected]);
    expect(collected.deref() === undefined).toBe(true);
    expect(group.agentClusterMap.get(otherOrigin)).toBe(live);

    const replacement = new AgentCluster('none');
    group.agentClusterMap.set(origin, replacement);
    expect([...group.agentClusterMap.values()]).toEqual([live, replacement]);

    const equivalentOrigin = obtainURLOrigin(parseURL('https://other.test/again').url!);
    group.agentClusterMap.set(equivalentOrigin, live);
    expect([...group.agentClusterMap.values()]).toEqual([live, replacement]);
    expect(group.agentClusterMap.get(equivalentOrigin)).toBe(live);
  });
});

/** Keep the group's entry without retaining its agent or cluster in the test job. */
function createCollectibleCluster(
  group: BrowsingContextGroup, origin: Origin, originKeyed: boolean,
): WeakRef<AgentCluster> {
  const agent = group.obtainSimilarOriginWindowAgent(origin, originKeyed);
  return new WeakRef(agent.agentCluster!);
}
