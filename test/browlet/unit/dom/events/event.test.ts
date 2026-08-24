import { describe, expect, it } from 'vitest';
import {
  CustomEventImpl, EventImpl,
} from '../../../../../src/browlet/dom/events/event';

describe('EventImpl', () => {
  it('constructs an initialized event', () => {
    const before = performance.now();
    const event = new EventImpl('ready', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    const after = performance.now();

    expect(event.type).toBe('ready');
    expect(event.target).toBeNull();
    expect(event.srcElement).toBeNull();
    expect(event.currentTarget).toBeNull();
    expect(event.composedPath()).toEqual([]);
    expect(event.eventPhase).toBe(EventImpl.NONE);
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(event.isTrusted).toBe(false);
    expect(event.timeStamp).toBeGreaterThanOrEqual(before);
    expect(event.timeStamp).toBeLessThanOrEqual(after);
  });

  it('defines every event phase constant', () => {
    const event = new EventImpl('phase');

    expect(EventImpl.NONE).toBe(0);
    expect(EventImpl.CAPTURING_PHASE).toBe(1);
    expect(EventImpl.AT_TARGET).toBe(2);
    expect(EventImpl.BUBBLING_PHASE).toBe(3);
    expect(event.NONE).toBe(EventImpl.NONE);
    expect(event.CAPTURING_PHASE).toBe(EventImpl.CAPTURING_PHASE);
    expect(event.AT_TARGET).toBe(EventImpl.AT_TARGET);
    expect(event.BUBBLING_PHASE).toBe(EventImpl.BUBBLING_PHASE);
  });

  it('sets propagation flags without allowing cancelBubble to clear them', () => {
    const event = new EventImpl('propagation');

    expect(event.cancelBubble).toBe(false);

    event.stopPropagation();
    expect(event.cancelBubble).toBe(true);

    event.cancelBubble = false;
    expect(event.cancelBubble).toBe(true);
  });

  it('stops propagation when immediate propagation is stopped', () => {
    const event = new EventImpl('propagation');

    event.stopImmediatePropagation();

    expect(event.cancelBubble).toBe(true);
  });

  it('cancels only cancelable events', () => {
    const cancelable = new EventImpl('cancelable', { cancelable: true });
    const fixed = new EventImpl('fixed');

    cancelable.preventDefault();
    fixed.preventDefault();

    expect(cancelable.defaultPrevented).toBe(true);
    expect(cancelable.returnValue).toBe(false);
    expect(fixed.defaultPrevented).toBe(false);
    expect(fixed.returnValue).toBe(true);
  });

  it('uses returnValue as the legacy cancellation API', () => {
    const event = new EventImpl('cancelable', { cancelable: true });

    event.returnValue = false;
    expect(event.defaultPrevented).toBe(true);

    event.returnValue = true;
    expect(event.defaultPrevented).toBe(true);
  });

  it('reinitializes legacy mutable state without changing composed or timeStamp', () => {
    const event = new EventImpl('before', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    const timeStamp = event.timeStamp;
    event.stopPropagation();
    event.preventDefault();

    event.initEvent('after');

    expect(event.type).toBe('after');
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(false);
    expect(event.composed).toBe(true);
    expect(event.cancelBubble).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(event.isTrusted).toBe(false);
    expect(event.timeStamp).toBe(timeStamp);
  });

});

describe('CustomEventImpl', () => {
  it('constructs an event carrying arbitrary detail', () => {
    const detail = { answer: 42 };
    const event = new CustomEventImpl('answer', {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail,
    });

    expect(event).toBeInstanceOf(EventImpl);
    expect(event.type).toBe('answer');
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.detail).toBe(detail);
  });

  it('defaults detail to null', () => {
    expect(new CustomEventImpl('empty').detail).toBeNull();
    expect(new CustomEventImpl('undefined', { detail: undefined }).detail)
      .toBeNull();
  });

  it('reinitializes the event and its detail', () => {
    const event = new CustomEventImpl('before', {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: 'before',
    });
    event.stopPropagation();
    event.preventDefault();

    event.initCustomEvent('after', false, false, 'after');

    expect(event.type).toBe('after');
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(false);
    expect(event.composed).toBe(true);
    expect(event.cancelBubble).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(event.detail).toBe('after');
  });
});
