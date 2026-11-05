import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { Element, PointerEvent } from '../../../../src/browlet/platform';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { PointerEventStream } from '../../../../src/browlet/interaction/index';
import { PointerEventImpl, type PointerInputEventType, type PointerEventSamples } from '../../../../src/browlet/interaction/events/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('Pointer Events §9: trusted sample lists', () => {
  it.each(['pointermove', 'pointerrawupdate'] as const)('supplies one coalesced sample for an unbatched %s', async (type) => {
    const { browser, target, send } = await createFixture();
    const received: PointerEvent[] = [];
    target.addEventListener(type, (event) => received.push(event as PointerEvent));
    const event = send(type);
    expect(received).toHaveLength(1);
    const samples = received[0]!.getCoalescedEvents();
    expect(samples).toHaveLength(1);
    const sample = samples[0]!;
    expect([sample.type, sample.target === target, sample.currentTarget, sample.eventPhase,
      sample.isTrusted, sample.bubbles, sample.cancelable, sample.composed]).toEqual([
      type, true, null, 0, true, false, false, false,
    ]);
    expect([sample.pointerId, sample.pointerType, sample.isPrimary, sample.clientX, sample.clientY,
      sample.pressure, sample.timeStamp]).toEqual([7, 'pen', true, 12.5, 23.5, 0.75, event.timeStamp]);
    expect([sample.getCoalescedEvents(), sample.getPredictedEvents(), sample.composedPath()]).toEqual([[], [], []]);
    expect(sample instanceof browser.window.PointerEvent).toBe(true);
    expect(sample).not.toBe(received[0]);
  });

  it('retains measurements while normalizing sample identity and independent event state', async () => {
    const { browser, target, send } = await createFixture();
    const child = new PointerEventImpl('child');
    const source = new PointerEventImpl('source', {
      pointerId: 91, pointerType: 'touch', isPrimary: false, clientX: 4.5, clientY: 6.5,
      screenX: 8.5, screenY: 9.5, pressure: 0.25, width: 9, height: 8, tiltX: 30, tiltY: -20,
      movementX: 2.5, movementY: -1.5, button: -1, buttons: 3, ctrlKey: true, detail: 12,
      view: getRelevantRealm(browser.window).env.window, relatedTarget: unwrap<ElementImpl>(target),
      bubbles: true, cancelable: true, composed: true, coalescedEvents: [child], predictedEvents: [child],
    }, 90);
    source.preventDefault();
    source.stopPropagation();
    const predicted = new PointerEventImpl('future', { clientX: 18.5, pressure: 0.5 }, 110);
    const samples = { coalescedEvents: [source], predictedEvents: [predicted] };
    const event = send('pointermove', target, samples);
    const actual = event.getCoalescedEvents()[0]!;
    expect([actual.type, actual.pointerId, actual.pointerType, actual.isPrimary, actual.isTrusted]).toEqual([
      'pointermove', 7, 'pen', true, true,
    ]);
    expect([actual.clientX, actual.clientY, actual.screenX, actual.screenY, actual.pressure,
      actual.width, actual.height, actual.tiltX, actual.tiltY, actual.movementX, actual.movementY,
      actual.button, actual.buttons, actual.ctrlKey, actual.timeStamp, actual.view === source.view]).toEqual([
      4.5, 6.5, 8.5, 9.5, 0.25, 9, 8, 30, -20, 2.5, -1.5, -1, 3, true, 90, true,
    ]);
    expect([actual.bubbles, actual.cancelable, actual.composed, actual.detail, actual.relatedTarget,
      actual.defaultPrevented, actual.propagationStopped, actual.getCoalescedEvents(), actual.getPredictedEvents()])
      .toEqual([false, false, false, 0, null, false, false, [], []]);
    expect(event.getPredictedEvents().map((sample) => [sample.type, sample.clientX, sample.timeStamp,
      sample.pointerId, sample.pointerType, sample.isPrimary, sample.isTrusted])).toEqual([
      ['pointermove', 18.5, 110, 7, 'pen', true, true],
    ]);
    expect([source.pointerId, source.pointerType, source.isPrimary, source.isTrusted, source.defaultPrevented,
      source.getCoalescedEvents()[0] === child, source.getPredictedEvents()[0] === child]).toEqual([
      91, 'touch', false, false, true, true, true,
    ]);
    expect(actual).not.toBe(source);
    source.clientX = 999;
    samples.coalescedEvents.length = 0;
    expect(event.getCoalescedEvents()).toHaveLength(1);
    expect(actual.clientX).toBe(4.5);
    expect(getRelevantRealm(actual)).toBe(getRelevantRealm(browser.window));
  });

  it('creates separate raw and move samples from the same chronological inputs', async () => {
    const { target, send } = await createFixture();
    const samples = {
      coalescedEvents: [new PointerEventImpl('', { clientX: 1 }, 90), new PointerEventImpl('', { clientX: 2 }, 100)],
      predictedEvents: [new PointerEventImpl('', { clientX: 3 }, 110)],
    };
    const raw = send('pointerrawupdate', target, samples);
    const move = send('pointermove', target, samples);
    expect(raw.getCoalescedEvents().map((sample) => [sample.type, sample.clientX, sample.timeStamp])).toEqual([
      ['pointerrawupdate', 1, 90], ['pointerrawupdate', 2, 100],
    ]);
    expect(move.getCoalescedEvents().map((sample) => [sample.type, sample.clientX, sample.timeStamp])).toEqual([
      ['pointermove', 1, 90], ['pointermove', 2, 100],
    ]);
    expect(raw.getCoalescedEvents()[0]).not.toBe(move.getCoalescedEvents()[0]);
    expect(raw.getPredictedEvents()).toEqual([]);
    expect(move.getPredictedEvents()).toHaveLength(1);
  });

  it('accepts equal timestamps and empty prediction without changing measured time', async () => {
    const { target, send } = await createFixture();
    const samples = {
      coalescedEvents: [new PointerEventImpl('', {}, 100), new PointerEventImpl('', {}, 100)],
      predictedEvents: [new PointerEventImpl('', {}, 100), new PointerEventImpl('', {}, 100)],
    };
    const event = send('pointermove', target, samples);
    expect(event.getCoalescedEvents().map((sample) => sample.timeStamp)).toEqual([100, 100]);
    expect(event.getPredictedEvents().map((sample) => sample.timeStamp)).toEqual([100, 100]);
    const single = send('pointermove', target, { coalescedEvents: [], predictedEvents: [] });
    expect(single.getCoalescedEvents()).toHaveLength(1);
    expect(single.getPredictedEvents()).toEqual([]);
  });

  it.each([
    { coalesced: [95, 90], predicted: [] },
    { coalesced: [101], predicted: [] },
    { coalesced: [90], predicted: [99] },
    { coalesced: [90], predicted: [120, 110] },
  ])('rejects invalid producer chronology before delivering input: %j', async ({ coalesced, predicted }) => {
    const { target, send } = await createFixture();
    let calls = 0;
    target.addEventListener('pointermove', () => calls++);
    const samples = {
      coalescedEvents: coalesced.map((timeStamp) => new PointerEventImpl('', {}, timeStamp)),
      predictedEvents: predicted.map((timeStamp) => new PointerEventImpl('', {}, timeStamp)),
    };
    expect(() => send('pointermove', target, samples)).toThrow('Pointer samples must be chronological');
    expect(calls).toBe(0);
  });

  it.each(['pointerdown', 'pointerup', 'pointercancel', 'pointerover', 'pointerenter', 'pointerout', 'pointerleave',
    'gotpointercapture', 'lostpointercapture', 'click', 'auxclick', 'contextmenu'])(
    'leaves sample lists empty for trusted %s', async (type) => {
      const { target } = await createFixture();
      const owner = unwrap<ElementImpl>(target);
      const event = owner.createTrustedEvent(PointerEventImpl);
      event.type = type;
      const sample = new PointerEventImpl('');
      event.initializeSampleLists({ coalescedEvents: [sample], predictedEvents: [sample] }, owner);
      expect([event.getCoalescedEvents(), event.getPredictedEvents()]).toEqual([[], []]);
    },
  );

  it.each(['coalescedEvents', 'predictedEvents'] as const)('updates retained %s across a closed shadow root', async (list) => {
    const { browser, target: host } = await createFixture();
    const shadow = host.attachShadow({ mode: 'closed' });
    const inner = browser.document.createElement('span');
    shadow.append(inner);
    const sample = new browser.window.PointerEvent('pointermove');
    const parent = new browser.window.PointerEvent('pointermove', { bubbles: true, composed: true, [list]: [sample] });
    const event = unwrap<PointerEventImpl>(parent);
    event.isTrusted = true;
    const targets: boolean[] = [];
    browser.document.addEventListener('pointermove', () => targets.push(sample.target === host), true);
    inner.addEventListener('pointermove', () => targets.push(sample.target === inner));
    browser.document.addEventListener('pointermove', () => targets.push(sample.target === host));
    unwrap<ElementImpl>(inner).dispatch(event);
    expect(targets).toEqual([true, true, true]);
    expect(sample.target === host).toBe(true);
  });

  it('clears sample targets when DOM cleans up non-composed shadow dispatch', async () => {
    const { browser, target: host } = await createFixture();
    const shadow = host.attachShadow({ mode: 'closed' });
    const inner = browser.document.createElement('span');
    shadow.append(inner);
    const sample = new browser.window.PointerEvent('pointermove');
    const parent = new browser.window.PointerEvent('pointermove', { coalescedEvents: [sample], predictedEvents: [sample] });
    const event = unwrap<PointerEventImpl>(parent);
    event.isTrusted = true;
    let during = false;
    inner.addEventListener('pointermove', () => { during = sample.target === inner; });
    unwrap<ElementImpl>(inner).dispatch(event);
    expect(during).toBe(true);
    expect([parent.target, sample.target, sample.currentTarget, sample.composedPath()]).toEqual([null, null, null, []]);
  });

  it('keeps sample trust and targets when author code redispatches or reinitializes the parent', async () => {
    const { browser, target, send } = await createFixture();
    let received: PointerEvent | undefined;
    target.addEventListener('pointermove', (event) => { received = event as PointerEvent; });
    send('pointermove');
    const parent = received!;
    const sample = parent.getCoalescedEvents()[0]!;
    browser.document.dispatchEvent(parent);
    expect([parent.isTrusted, parent.target === browser.document, sample.isTrusted, sample.target === target]).toEqual([
      false, true, true, true,
    ]);
    expect(parent.getCoalescedEvents()[0]).toBe(sample);
    parent.initEvent('renamed');
    expect([parent.target, sample.isTrusted, sample.target === target, parent.getCoalescedEvents()[0] === sample])
      .toEqual([null, true, true, true]);
    browser.document.dispatchEvent(sample);
    expect([sample.isTrusted, sample.getCoalescedEvents(), sample.getPredictedEvents()]).toEqual([false, [], []]);
  });

  it('suppresses insecure raw delivery before preparing samples', async () => {
    const { target, send } = await createFixture(false);
    let calls = 0;
    target.addEventListener('pointerrawupdate', () => calls++);
    const event = send('pointerrawupdate', target, {
      coalescedEvents: [new PointerEventImpl('', {}, 101)], predictedEvents: [],
    });
    expect(calls).toBe(0);
    expect(event.getCoalescedEvents()).toEqual([]);
  });
});

/** Real target-realm allocation and Binding dispatch, with normalized input supplied by the test. */
async function createFixture(secure = true) {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(`${secure ? 'https' : 'http'}://pointer.test/`);
  const target = browser.document.createElement('div');
  browser.document.body!.append(target);
  const stream = new PointerEventStream(7, false, true, () => false);
  const send = (type: PointerInputEventType, hit: Element = target, samples?: PointerEventSamples) => {
    const input = new PointerEventImpl(type, {
      pointerType: 'pen', isPrimary: true, clientX: 12.5, clientY: 23.5, pressure: 0.75, buttons: 1,
    }, 100);
    const selected = stream.prepareTarget(type, input, () => unwrap<ElementImpl>(hit));
    const event = selected.createTrustedEvent(PointerEventImpl);
    event.copyInputFrom(input);
    event.setPointerEventAttributes(type);
    stream.dispatchToTarget(event, selected, () => null, 1, samples);
    return event;
  };
  return { browser, target, stream, send };
}
