import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualUserAgent } from '../../support/browlet-agent';

import { getRelevantRealm } from '../../support/browlet-binding';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import { Navigable } from '../../../src/browlet/browsing/navigation/navigable';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import {
  type RenderingOpportunityHost, type RenderingUpdateHooks,
  type RenderingUpdateContext, type RenderingUpdatePhase, renderingUpdatePhases, WindowRenderingController,
} from '../../../src/browlet/scripting/rendering-opportunity';
import {
  renderingTaskSource,
} from '../../../src/browlet/scripting/tasks';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import {
  Duration, monotonicClock, UnsafeMoment,
} from '../../../src/timing/clock';

afterEach(() => vi.restoreAllMocks());

describe('Window rendering controller', () => {
  it('queues an ordered rendering update on its event loop', () => {
    const { agent, document, navigable } = createWindowFixture();
    const frameTimestamp = new UnsafeMoment(monotonicClock, 10);
    const styleAndLayoutStartTime = new UnsafeMoment(monotonicClock, 20);
    const manualHost = createManualRenderingHost([
      frameTimestamp,
      styleAndLayoutStartTime,
    ]);
    const phases: RenderingUpdatePhase[] = [];
    const contexts: RenderingUpdateContext[] = [];
    const hookPhases = renderingUpdatePhases.filter((phase) => phase !== 'runAnimationFrameCallbacks');
    const hooks: RenderingUpdateHooks = {};
    for (const phase of hookPhases) {
      hooks[phase] = (context) => {
        phases.push(phase);
        contexts.push(context);
      };
    }
    document.animationFrameController.request(() => { phases.push('runAnimationFrameCallbacks'); });
    const controller = new WindowRenderingController(
      agent,
      manualHost.host,
      hooks,
    );

    controller.start();
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
    const styleAndLayoutIndex = hookPhases.indexOf(
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
    const controller = new WindowRenderingController(agent, manualHost.host, {
      updateRenderingAndUserInterface,
    });

    controller.start();
    manualHost.signal([navigable]);
    manualHost.setOpportunities([]);
    agent.eventLoop.runTaskTurn();

    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();
  });

  it('processes parents before children even when the child Window was registered first', () => {
    const { agent, document, navigable } = createWindowFixture();
    const child = createDocumentInAgent(document);
    const parent = createDocumentInAgent(document);
    const parentNavigable = attachChildDocument(parent, appendFrame(document));
    const childNavigable = attachChildDocument(child, appendFrame(parent));
    const visited: DocumentImpl[] = [];
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10), new UnsafeMoment(monotonicClock, 20),
    ]);
    const controller = new WindowRenderingController(agent, manualHost.host, {
      runResizeSteps: ({ document }) => { visited.push(document); },
    });
    controller.start();
    manualHost.signal([navigable, childNavigable, parentNavigable]);

    agent.eventLoop.runTaskTurn();

    const expectedOrder = [document, parent, child];
    expect(visited.map((current) => expectedOrder.indexOf(current))).toEqual([0, 1, 2]);
    controller.stop();
  });

  it('orders sibling frames through shadow trees before the host\'s light children', () => {
    const { agent, document, navigable } = createWindowFixture();
    const lightChild = createDocumentInAgent(document);
    const shadowChild = createDocumentInAgent(document);
    const host = document.body!.appendChild(document.createElement('div'));
    const lightFrame = host.appendChild(appendFrame(document));
    const shadow = host.attachShadow({
      mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const shadowFrame = shadow.appendChild(appendFrame(document));
    const lightNavigable = attachChildDocument(lightChild, lightFrame);
    const shadowNavigable = attachChildDocument(shadowChild, shadowFrame);
    const visited: DocumentImpl[] = [];
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10), new UnsafeMoment(monotonicClock, 20),
    ]);
    const controller = new WindowRenderingController(agent, manualHost.host, {
      runResizeSteps: ({ document }) => { visited.push(document); },
    });
    controller.start();
    manualHost.signal([navigable, lightNavigable, shadowNavigable]);

    agent.eventLoop.runTaskTurn();

    const expectedOrder = [document, shadowChild, lightChild];
    expect(visited.map((current) => expectedOrder.indexOf(current))).toEqual([0, 1, 2]);
    controller.stop();
  });

  it('keeps one document order through an update and observes moved containers in the next task', () => {
    const { agent, document, navigable } = createWindowFixture();
    const first = createDocumentInAgent(document);
    const second = createDocumentInAgent(document);
    const firstFrame = appendFrame(document);
    const secondFrame = appendFrame(document);
    const firstNavigable = attachChildDocument(first, firstFrame);
    const secondNavigable = attachChildDocument(second, secondFrame);
    const visited: DocumentImpl[] = [];
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10), new UnsafeMoment(monotonicClock, 20),
      new UnsafeMoment(monotonicClock, 30),
    ]);
    const controller = new WindowRenderingController(agent, manualHost.host, {
      runResizeSteps: ({ document: current }) => {
        if (current === document) document.body!.insertBefore(secondFrame, firstFrame);
      },
      runScrollSteps: ({ document }) => { visited.push(document); },
    });
    controller.start();
    manualHost.signal([navigable, firstNavigable, secondNavigable]);

    agent.eventLoop.runTaskTurn();
    const originalOrder = [document, first, second];
    expect(visited.map((current) => originalOrder.indexOf(current))).toEqual([0, 1, 2]);
    visited.length = 0;
    agent.eventLoop.runTaskTurn();
    expect(visited.map((current) => originalOrder.indexOf(current))).toEqual([0, 2, 1]);
    controller.stop();
  });

  it('flushes autofocus candidates only for top-level traversables', () => {
    const { agent, document, navigable } = createWindowFixture();
    const child = createDocumentInAgent(document);
    const childNavigable = attachChildDocument(child, appendFrame(document));
    const visited: DocumentImpl[] = [];
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10), new UnsafeMoment(monotonicClock, 20),
    ]);
    const controller = new WindowRenderingController(agent, manualHost.host, {
      flushAutofocusCandidates: ({ document }) => { visited.push(document); },
    });
    controller.start();
    manualHost.signal([navigable, childNavigable]);

    agent.eventLoop.runTaskTurn();

    expect(visited).toHaveLength(1);
    expect(visited[0]).toBe(document);
    controller.stop();
  });

  it.each(['filtered', 'other-agent'] as const)('orders siblings when their parent is %s', (parentState) => {
    const { agent, document, navigable } = createWindowFixture();
    const parentNavigable = parentState === 'other-agent'
      ? TopLevelTraversable.create(document.env.userAgent, null, '')
      : navigable;
    const parent = parentNavigable.activeDocument!;
    const second = createDocumentInAgent(document);
    const first = createDocumentInAgent(document);
    const firstNavigable = attachChildDocument(first, appendFrame(parent));
    const secondNavigable = attachChildDocument(second, appendFrame(parent));
    const visited: DocumentImpl[] = [];
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10), new UnsafeMoment(monotonicClock, 20),
    ]);
    const controller = new WindowRenderingController(agent, manualHost.host, {
      filters: { hasHiddenVisibilityState: (candidate) => candidate === parent },
      runResizeSteps: ({ document }) => { visited.push(document); },
    });
    controller.start();
    manualHost.signal([parentNavigable, firstNavigable, secondNavigable]);

    agent.eventLoop.runTaskTurn();

    const expectedOrder = [first, second];
    expect(visited.map((current) => expectedOrder.indexOf(current))).toEqual([0, 1]);
    if (parentState === 'other-agent') expect(parent.env.responsibleEventLoop).not.toBe(agent.eventLoop);
    controller.stop();
  });

  it('skips rendering when no visual effect or animation-frame callback is pending', () => {
    const { agent, navigable } = createWindowFixture();
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10),
      new UnsafeMoment(monotonicClock, 20),
    ]);
    const updateRenderingAndUserInterface = vi.fn();
    const controller = new WindowRenderingController(agent, manualHost.host, {
      filters: {
        wouldRenderingHaveVisibleEffect: () => false,
      },
      updateRenderingAndUserInterface,
    });

    controller.start();
    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();

    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();
  });

  it('consults Document render blocking before running any rendering phase', () => {
    const { agent, document, navigable } = createWindowFixture();
    document.body!.remove();
    vi.spyOn(document.env, 'currentHighResolutionTime').mockReturnValue(new Duration(0));
    const manualHost = createManualRenderingHost(Array.from({ length: 6 }, (_, i) =>
      new UnsafeMoment(monotonicClock, i + 1)));
    const updateRenderingAndUserInterface = vi.fn();
    const controller = new WindowRenderingController(agent, manualHost.host, { updateRenderingAndUserInterface });
    controller.start();

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
    controller.stop();
  });

  it('resumes rendering after the cutoff even while a resource remains pending', () => {
    const { agent, document, navigable } = createWindowFixture();
    document.body!.remove();
    const script = document.head!.appendChild(document.createElement('script'));
    script.blockRendering();
    document.documentElement!.appendChild(document.createElement('body'));
    const now = vi.spyOn(document.env, 'currentHighResolutionTime').mockReturnValue(new Duration(5000));
    const manualHost = createManualRenderingHost(Array.from({ length: 4 }, (_, i) =>
      new UnsafeMoment(monotonicClock, i + 1)));
    const updateRenderingAndUserInterface = vi.fn();
    const controller = new WindowRenderingController(agent, manualHost.host, { updateRenderingAndUserInterface });
    controller.start();

    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();
    expect(updateRenderingAndUserInterface).not.toHaveBeenCalled();

    now.mockReturnValue(new Duration(5001));
    manualHost.signal([navigable]);
    agent.eventLoop.runTaskTurn();
    expect(updateRenderingAndUserInterface).toHaveBeenCalledOnce();
    expect(document.renderBlockingElements.has(script)).toBe(true);
    controller.stop();
  });

  it('stops observing without queueing another rendering task', () => {
    const { agent, navigable } = createWindowFixture();
    const manualHost = createManualRenderingHost([
      new UnsafeMoment(monotonicClock, 10),
    ]);
    const controller = new WindowRenderingController(agent, manualHost.host);

    controller.start();
    controller.stop();
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

function createDocumentInAgent(source: DocumentImpl): DocumentImpl {
  const sourceEnv = source.env;
  const agent = sourceEnv.realm.agent;
  if (!(agent instanceof WindowAgent)) throw new Error('Expected a Window agent');
  const env = sourceEnv.userAgent.createWindowEnvironment({
    agent, userAgent: sourceEnv.userAgent,
    creationURL: sourceEnv.creationURL, origin: sourceEnv.origin, parent: null,
    topLevelCreationURL: sourceEnv.creationURL, topLevelOrigin: sourceEnv.origin,
  });
  const document = env.createDocument();
  document.type = 'html';
  document.contentType = 'text/html';
  document.origin = source.origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  document.populateWithHTMLHeadBody();
  return document;
}

function appendFrame(document: DocumentImpl): HTMLIFrameElementImpl {
  return document.body!.appendChild(document.createElement('iframe')) as HTMLIFrameElementImpl;
}

function attachChildDocument(document: DocumentImpl, container: HTMLIFrameElementImpl): Navigable {
  // Connect real implementation owners through the existing seam until child creation is implemented.
  const navigable = new Navigable(DocumentState.create(document), container.nodeDocument.getNodeNavigable());
  container.contentNavigable = navigable;
  return navigable;
}
