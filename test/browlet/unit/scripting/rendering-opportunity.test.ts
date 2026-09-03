import { describe, expect, it, vi } from 'vitest';

import {
  getRelevantRealm,
} from '../../../../src/browlet/bindings';
import {
  createNewTopLevelTraversable, type Navigable,
} from '../../../../src/browlet/browsing/navigable';
import {
  EventLoop, type EventLoopOptions,
} from '../../../../src/browlet/scripting/event-loop';
import {
  type RenderingOpportunityHost, type RenderingUpdateHooks,
  type RenderingUpdatePhase, renderingUpdatePhases, WindowRenderingProducer,
} from '../../../../src/browlet/scripting/rendering-opportunity';
import {
  renderingTaskSource,
} from '../../../../src/browlet/scripting/tasks';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import {
  monotonicClock, UnsafeMoment,
} from '../../../../src/browlet/performance/clock';
import { UserAgent } from '../../../../src/browlet/user-agent';

describe('Window rendering producer', () => {
  it('queues an ordered rendering update on its event loop', () => {
    const { agent, document, navigable } = createWindowFixture();
    const frameTimestamp = new UnsafeMoment(monotonicClock, 10);
    const styleAndLayoutStartTime = new UnsafeMoment(monotonicClock, 20);
    const manualHost = createManualRenderingHost([
      frameTimestamp,
      styleAndLayoutStartTime,
    ]);
    const phases: RenderingUpdatePhase[] = [];
    const contexts: Parameters<NonNullable<
      RenderingUpdateHooks[RenderingUpdatePhase]
    >>[0][] = [];
    const hooks = Object.fromEntries(renderingUpdatePhases.map((phase) => [
      phase,
      (context: typeof contexts[number]) => {
        phases.push(phase);
        contexts.push(context);
      },
    ])) as RenderingUpdateHooks;
    const producer = new WindowRenderingProducer(
      agent,
      manualHost.host,
      hooks,
    );

    producer.start();
    manualHost.signal([navigable]);

    expect(phases).toEqual([]);
    expect(agent.eventLoop.lastRenderOpportunityTime).toBe(frameTimestamp);
    expect(EventLoop.getTaskQueue(
      agent.eventLoop,
      renderingTaskSource,
    ).size).toBe(1);

    agent.eventLoop.runTaskTurn(createEventLoopOptions());

    expect(phases).toEqual(renderingUpdatePhases);
    expect(contexts.every((context) =>
      context.document === document &&
      context.frameTimestamp === frameTimestamp,
    )).toBe(true);
    const styleAndLayoutIndex = renderingUpdatePhases.indexOf(
      'recalculateStylesUpdateLayoutAndResizeObservations',
    );
    expect(contexts.slice(0, styleAndLayoutIndex).every((context) =>
      context.unsafeStyleAndLayoutStartTime === null,
    )).toBe(true);
    expect(contexts.slice(styleAndLayoutIndex).every((context) =>
      context.unsafeStyleAndLayoutStartTime === styleAndLayoutStartTime,
    )).toBe(true);
  });

  it('rechecks the rendering opportunity when the task runs', () => {
    const { agent, navigable } = createWindowFixture();
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10),
      new UnsafeMoment(monotonicClock, 20),
    ]);
    const updateRenderingAndUserInterface = vi.fn();
    const producer = new WindowRenderingProducer(agent, manualHost.host, {
      updateRenderingAndUserInterface,
    });

    producer.start();
    manualHost.signal([navigable]);
    manualHost.setOpportunities([]);
    agent.eventLoop.runTaskTurn(createEventLoopOptions());

    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();
  });

  it('applies the unnecessary-rendering filter only when both inputs exist', () => {
    const { agent, navigable } = createWindowFixture();
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10),
      new UnsafeMoment(monotonicClock, 20),
    ]);
    const updateRenderingAndUserInterface = vi.fn();
    const producer = new WindowRenderingProducer(agent, manualHost.host, {
      filters: {
        hasAnimationFrameCallbacks: () => false,
        wouldRenderingHaveVisibleEffect: () => false,
      },
      updateRenderingAndUserInterface,
    });

    producer.start();
    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn(createEventLoopOptions());

    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();
  });

  it('stops observing without queueing another rendering task', () => {
    const { agent, navigable } = createWindowFixture();
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10),
    ]);
    const producer = new WindowRenderingProducer(agent, manualHost.host);

    producer.start();
    producer.stop();
    manualHost.signal([navigable]);

    expect(EventLoop.getTaskQueue(
      agent.eventLoop,
      renderingTaskSource,
    ).size).toBe(0);
  });
});

function createWindowFixture(): {
  readonly agent: WindowAgent;
  readonly document: NonNullable<Navigable['activeDocument']>;
  readonly navigable: Navigable;
} {
  const navigable = createNewTopLevelTraversable(
    new UserAgent(),
    null,
    '',
  );
  const window = navigable.activeWindow;
  const document = navigable.activeDocument;
  if (window === null || document === null) {
    throw new Error('Expected a complete top-level traversable');
  }

  const agent = getRelevantRealm(window).agent;
  if (!(agent instanceof WindowAgent)) {
    throw new Error('Expected a Window agent');
  }
  return { agent, document, navigable };
}

function createManualRenderingHost(times: UnsafeMoment[]): {
  readonly host: RenderingOpportunityHost;
  readonly setOpportunities: (navigables: readonly Navigable[]) => void;
  readonly signal: (navigables: readonly Navigable[]) => void;
} {
  let notify: ((navigables: readonly Navigable[]) => void) | null = null;
  let opportunities = new Set<Navigable>();
  const setOpportunities = (navigables: readonly Navigable[]): void => {
    opportunities = new Set(navigables);
  };
  return {
    host: {
      hasRenderingOpportunity: (navigable) =>
        opportunities.has(navigable),
      observeRenderingOpportunities(nextNotify) {
        notify = nextNotify;
        return () => { notify = null; };
      },
      unsafeSharedCurrentTime() {
        const time = times.shift();
        if (time === undefined) throw new Error('Unexpected clock read');
        return time;
      },
    },
    setOpportunities,
    signal(navigables) {
      setOpportunities(navigables);
      notify?.(navigables);
    },
  };
}

function createEventLoopOptions(): EventLoopOptions {
  return {
    createMicrotaskQueue: () => ({
      kind: 'ambient',
      enqueueMicrotask: (steps) => { queueMicrotask(steps); },
      performMicrotaskCheckpoint() {},
    }),
    requestEventLoopTurn() {},
    unsafeSharedCurrentTime: () =>
      new UnsafeMoment(monotonicClock, 0),
  };
}
