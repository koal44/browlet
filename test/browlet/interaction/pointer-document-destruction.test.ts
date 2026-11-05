import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext, Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../../../src/browlet/dom/nodes/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import { PointerEventStream, type MouseButtonInput } from '../../../src/browlet/interaction/index';
import { EventModifierState, PointerEventImpl, type PointerInputEventType } from '../../../src/browlet/interaction/events/index';
import type { Element, PointerEvent } from '../../../src/browlet/platform';
import { userInteractionTaskSource } from '../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { project } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('retained pointer state during Document destruction', () => {
  it('clears pending and effective capture even though the destroyed tree stays connected', () => {
    const { child, stream, send, destroy } = createFixture();
    send('pointerdown', child.target, 1, 0);
    stream.setPointerCapture(child.target, 1);
    send('pointermove', child.target, 1);
    const notifications: string[] = [];
    for (const type of ['lostpointercapture', 'pointerout', 'pointerleave']) {
      child.platformTarget.addEventListener(type, () => notifications.push(type));
    }

    destroy(child.document);

    expect(child.target.isConnected).toBe(true);
    expect(stream.activeDocument === null).toBe(true);
    expect(stream.previousTarget).toBeNull();
    expect(stream.capture.pendingTargetOverride).toBeNull();
    expect(stream.capture.targetOverride).toBeNull();
    expect(notifications).toEqual([]);
    const hitTest = vi.fn(() => child.target);
    stream.updateAfterLayout(hitTest, 100);
    stream.suppress(hitTest);
    stream.dispatchActivation('contextmenu', 0);
    expect(hitTest).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });

  it('drops a completed activation without dispatching into the destroyed Document', () => {
    const { child, send, stream, destroy } = createFixture();
    send('pointerdown', child.target, 1, 0);
    send('pointerup', child.target, 0, 0);
    const clicked = vi.fn();
    child.platformTarget.addEventListener('click', clicked);
    destroy(child.document);
    stream.dispatchActivation('click', 1);
    expect(clicked.mock.calls.length).toBe(0);
  });

  it('preserves another Document\'s capture and boundaries in the same top-level map', () => {
    const { parent, child, top, stream, send, destroy } = createFixture();
    const other = new PointerEventStream(8, false, true, () => false);
    top.pointerEventStreams.set(8, other);
    send('pointerdown', child.target, 1, 0);
    stream.setPointerCapture(child.target, 1);
    send('pointermove', child.target, 1);
    send('pointerdown', parent.target, 1, 0, other);
    other.setPointerCapture(parent.target, 1);
    send('pointermove', parent.target, 1, -1, other);
    const entered = vi.fn();
    parent.platformTarget.addEventListener('pointerover', entered);

    destroy(child.document);

    expect(stream.activeDocument === null).toBe(true);
    expect(top.pointerEventStreams.get(8) === other).toBe(true);
    expect(other.activeDocument === parent.document).toBe(true);
    expect(other.previousTarget === parent.target).toBe(true);
    expect(other.capture.targetOverride === parent.target).toBe(true);
    expect(other.capture.pendingTargetOverride === parent.target).toBe(true);
    send('pointermove', parent.target, 1, -1, other);
    expect(entered).not.toHaveBeenCalled();
  });

  it('forgets only the destroyed Document\'s press targets when a stream has crossed Documents', () => {
    const { parent, child, stream, send, destroy } = createFixture();
    send('pointerdown', child.target, 1, 0);
    send('pointermove', parent.target, 5, 1);
    destroy(child.document);
    // Adoption after destruction must not resurrect the old button's click pair.
    parent.document.body!.appendChild(child.target);
    const clicks: string[] = [];
    child.platformTarget.addEventListener('click', () => clicks.push('old'));
    parent.platformTarget.addEventListener('auxclick', () => clicks.push('surviving'));
    send('pointermove', child.target, 4, 0);
    stream.dispatchActivation('click', 1);
    send('pointerup', parent.target, 0, 1);
    stream.dispatchActivation('auxclick', 1);
    expect(clicks).toEqual(['surviving']);
  });

  it('drops old queued input but preserves physical mouse buttons for the surviving Document', () => {
    const { userAgent, parent, child, top, destroy } = createFixture();
    const input = userAgent.mouseInput;
    vi.spyOn(input, 'hitTest').mockImplementation((document) => document === child.document ? child.target : parent.target);
    vi.spyOn(input, 'hasLockedElement').mockReturnValue(false);
    vi.spyOn(input, 'focusOnMouseDown').mockImplementation(() => {});
    vi.spyOn(input, 'notifyUserActivation').mockImplementation(() => {});
    const action: MouseButtonInput = {
      button: 0, pressed: true, click: false, doubleClick: false, contextMenu: false, clickCount: 1,
      screenX: 10, screenY: 20, clientX: 10, clientY: 20, modifiers: new EventModifierState(),
    };
    input.queueButton(action, child.document);
    child.document.env.responsibleEventLoop.runTaskTurn();
    child.platformTarget.setPointerCapture(1);
    input.queueMove(action, child.document);
    child.document.env.responsibleEventLoop.runTaskTurn();
    const mouse = top.pointerEventStreams.get(1)!;
    const received: PointerEvent[] = [];
    child.platformTarget.addEventListener('pointermove', (event) => received.push(event as PointerEvent));
    parent.platformTarget.addEventListener('pointermove', (event) => received.push(event as PointerEvent));

    destroy(child.document, () => { input.queueMove(action, child.document); });
    expect(child.document.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    input.queueMove(action, parent.document);
    parent.document.env.responsibleEventLoop.runTaskTurn();

    expect(received).toHaveLength(1);
    expect(received[0]!.target === parent.platformTarget).toBe(true);
    expect(received[0]!.buttons).toBe(1);
    expect(top.pointerEventStreams.get(1) === mouse).toBe(true);
    expect(mouse.activeDocument === parent.document).toBe(true);
    expect(mouse.capture.targetOverride).toBeNull();
  });
});

/** Real parent/child contexts, bindings, dispatch and destruction; only the input device is supplied. */
function createFixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const parentDocument = top.activeDocument!;
  const container = parentDocument.createElement('iframe') as HTMLIFrameElementImpl;
  parentDocument.body!.appendChild(container);
  const [, childDocument] = BrowsingContext.create(parentDocument, container, parentDocument.browsingContext!.group!);
  container.contentNavigable = new Navigable(DocumentState.create(childDocument), top);
  const parent = addTarget(parentDocument);
  const child = addTarget(childDocument);
  const stream = new PointerEventStream(7, false, true, () => false);
  top.pointerEventStreams.set(7, stream);
  const send = (
    type: PointerInputEventType, hit: NodeImpl, buttons: number, button = -1, inputStream = stream,
  ) => {
    const input = new PointerEventImpl('', {
      buttons, button, pointerType: 'mouse', view: hit.nodeDocument.getRelevantGlobalObject(),
    });
    const target = inputStream.prepareTarget(type, input, () => hit);
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.copyInputFrom(input);
    event.setPointerEventAttributes(type);
    inputStream.dispatchToTarget(event, target, () => hit, 1);
  };
  const destroy = (document: DocumentImpl, queueAfter?: () => void) => {
    document.env.realm.queueGlobalTask(userInteractionTaskSource, () => { document.destroy(); });
    queueAfter?.();
    expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(document.browsingContext === null).toBe(true);
  };
  return { userAgent, top, parent, child, stream, send, destroy };
}

function addTarget(document: DocumentImpl) {
  const target: ElementImpl = document.createElement('div');
  document.body!.appendChild(target);
  return { document, target, platformTarget: project(target) as Element };
}
