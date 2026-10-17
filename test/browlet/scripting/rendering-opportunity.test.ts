import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualUserAgent } from '../../support/browlet-agent';

import { getRelevantRealm } from '../../support/browlet-binding';
import {
  TopLevelTraversable, type Navigable,
} from '../../../src/browlet/browsing/navigation/navigable';
import {
  type RenderingOpportunityHost, type RenderingUpdateHooks,
  type RenderingUpdatePhase, renderingUpdatePhases, WindowRenderingProducer,
} from '../../../src/browlet/scripting/rendering-opportunity';
import {
  renderingTaskSource,
} from '../../../src/browlet/scripting/tasks';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import {
  Duration, monotonicClock, UnsafeMoment,
} from '../../../src/browlet/timing/clock';

afterEach(() => vi.restoreAllMocks());

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
    expect(agent.eventLoop.getTaskQueue(
      renderingTaskSource,
    ).size).toBe(1);

    agent.eventLoop.runTaskTurn();

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
    agent.eventLoop.runTaskTurn();

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
    agent.eventLoop.runTaskTurn();

    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();
  });

  it('consults Document render blocking before running any rendering phase', () => {
    const { agent, document, navigable } = createWindowFixture();
    document.body!.remove();
    vi.spyOn(document.env.timing, 'currentHighResolutionTime').mockReturnValue(new Duration(0));
    const manualHost = createManualRenderingHost(Array.from({ length: 6 }, (_, i) =>
      new UnsafeMoment(monotonicClock, i + 1)));
    const updateRenderingAndUserInterface = vi.fn();
    const producer = new WindowRenderingProducer(agent, manualHost.host, { updateRenderingAndUserInterface });
    producer.start();

    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();
    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();

    const script = document.head!.appendChild(document.createElement('script'));
    script.blockRendering();
    document.documentElement!.appendChild(document.createElement('body'));
    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();
    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();

    script.unblockRendering();
    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();
    expect(updateRenderingAndUserInterface).toHaveBeenCalledOnce();
    producer.stop();
  });

  it('resumes rendering after the cutoff even while a resource remains pending', () => {
    const { agent, document, navigable } = createWindowFixture();
    document.body!.remove();
    const script = document.head!.appendChild(document.createElement('script'));
    script.blockRendering();
    document.documentElement!.appendChild(document.createElement('body'));
    const now = vi.spyOn(document.env.timing, 'currentHighResolutionTime').mockReturnValue(new Duration(5000));
    const manualHost = createManualRenderingHost(Array.from({ length: 4 }, (_, i) =>
      new UnsafeMoment(monotonicClock, i + 1)));
    const updateRenderingAndUserInterface = vi.fn();
    const producer = new WindowRenderingProducer(agent, manualHost.host, { updateRenderingAndUserInterface });
    producer.start();

    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();
    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();

    now.mockReturnValue(new Duration(5001));
    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();
    expect(updateRenderingAndUserInterface).toHaveBeenCalledOnce();
    expect(document.renderBlockingElements.has(script)).toBe(true);
    producer.stop();
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

    expect(agent.eventLoop.getTaskQueue(
      renderingTaskSource,
    ).size).toBe(0);
  });
});

function createWindowFixture(): {
  agent: WindowAgent;
  document: NonNullable<Navigable['activeDocument']>;
  navigable: Navigable;
} {
  const navigable = TopLevelTraversable.create(
    createManualUserAgent(),
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
  host: RenderingOpportunityHost;
  setOpportunities: (navigables: Navigable[]) => void;
  signal: (navigables: Navigable[]) => void;
} {
  let notify: ((navigables: Navigable[]) => void) | null = null;
  let opportunities = new Set<Navigable>();
  const setOpportunities = (navigables: Navigable[]): void => {
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
