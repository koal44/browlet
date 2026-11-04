import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { MouseEventImpl } from '../../../../src/browlet/interaction/events/index';
import { getRelevantRealm } from '../../../support/browlet-binding';

// Internal algorithms use converted coordinates, independently of native input delivery.
class MouseMovementEvent extends MouseEventImpl {
  constructor(type: string, screenX = 0, screenY = 0) {
    super(type, { screenX, screenY });
  }
}

describe('UI Events §5: mouse movement', () => {
  it('initializes relative motion without changing coordinates or event state', () => {
    const event = new MouseMovementEvent('mousemove', 30, 400);
    expect([event.movementX, event.movementY]).toEqual([0, 0]);
    event.movementX = 7;
    event.movementY = -9;
    event.isTrusted = true;
    event.initializePointerLockAttributes();
    expect([event.movementX, event.movementY, event.screenX, event.screenY, event.type, event.isTrusted])
      .toEqual([0, 0, 30, 400, 'mousemove', true]);
  });

  it('starts with unknown position and reports zero for the first move', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).env.window;
    expect(window.lastMouseMove).toBeUndefined();
    const event = new MouseMovementEvent('mousemove', -40, 300);
    event.movementX = 7;
    event.movementY = -9;
    window.setPointerLockAttributesForMousemove(event);
    expect([event.movementX, event.movementY]).toEqual([0, 0]);
    expect(window.lastMouseMove).toEqual({ x: -40, y: 300 });
  });

  it('uses independent X/Y deltas and copies each position rather than retaining the event', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).env.window;
    const first = new MouseMovementEvent('mousemove', 100, 400);
    window.setPointerLockAttributesForMousemove(first);
    first.screenX = 900;
    first.screenY = 800;
    const results = [[130, 412], [130, 445], [154, 445], [-10, -20], [-10, -20]].map(([x, y]) => {
      const event = new MouseMovementEvent('mousemove', x, y);
      window.setPointerLockAttributesForMousemove(event);
      return [event.movementX, event.movementY];
    });
    expect(results).toEqual([[30, 12], [0, 33], [24, 0], [-164, -465], [0, 0]]);
  });

  it.each(['mousedown', 'mouseup', 'click', 'pointermove', 'MouseMove'])(
    'leaves %s and the previous mousemove position unchanged', (type) => {
      const browser = new Browlet({ route: () => '' });
      const window = getRelevantRealm(browser.window).env.window;
      const ignored = new MouseMovementEvent(type, 900, 800);
      ignored.movementX = 7;
      ignored.movementY = -9;
      window.setPointerLockAttributesForMousemove(ignored);
      expect(window.lastMouseMove).toBeUndefined();
      window.setPointerLockAttributesForMousemove(new MouseMovementEvent('mousemove', 100, 400));
      window.setPointerLockAttributesForMousemove(ignored);
      expect([ignored.movementX, ignored.movementY]).toEqual([7, -9]);
      expect(window.lastMouseMove).toEqual({ x: 100, y: 400 });
      const next = new MouseMovementEvent('mousemove', 103, 407);
      window.setPointerLockAttributesForMousemove(next);
      expect([next.movementX, next.movementY]).toEqual([3, 7]);
    },
  );

  it('starts a new sequence after the input source clears an interrupted position', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).env.window;
    window.setPointerLockAttributesForMousemove(new MouseMovementEvent('mousemove', 100, 400));
    // Simulate the missing native producer's gap notification, not an implemented OS hookup.
    window.lastMouseMove = undefined;
    const firstAfterGap = new MouseMovementEvent('mousemove', 900, 800);
    window.setPointerLockAttributesForMousemove(firstAfterGap);
    expect([firstAfterGap.movementX, firstAfterGap.movementY]).toEqual([0, 0]);
    const next = new MouseMovementEvent('mousemove', 906, 802);
    window.setPointerLockAttributesForMousemove(next);
    expect([next.movementX, next.movementY]).toEqual([6, 2]);
  });

  it('keeps independent histories for different Windows', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const firstWindow = getRelevantRealm(first.window).env.window;
    const secondWindow = getRelevantRealm(second.window).env.window;
    firstWindow.setPointerLockAttributesForMousemove(new MouseMovementEvent('mousemove', 100, 400));
    secondWindow.setPointerLockAttributesForMousemove(new MouseMovementEvent('mousemove', 500, 200));
    const a = new MouseMovementEvent('mousemove', 110, 407);
    const b = new MouseMovementEvent('mousemove', 497, 202);
    firstWindow.setPointerLockAttributesForMousemove(a);
    secondWindow.setPointerLockAttributesForMousemove(b);
    expect([a.movementX, a.movementY, b.movementX, b.movementY]).toEqual([10, 7, -3, 2]);
  });

  it('leaves the previous position and supplied deltas alone during author dispatch', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).env.window;
    window.setPointerLockAttributesForMousemove(new MouseMovementEvent('mousemove', 100, 400));
    const synthetic = new MouseMovementEvent('mousemove', 900, 800);
    synthetic.movementX = 7;
    synthetic.movementY = -9;
    window.dispatchEvent(synthetic);
    expect([synthetic.isTrusted, synthetic.movementX, synthetic.movementY]).toEqual([false, 7, -9]);
    expect(window.lastMouseMove).toEqual({ x: 100, y: 400 });
    const next = new MouseMovementEvent('mousemove', 110, 405);
    window.setPointerLockAttributesForMousemove(next);
    expect([next.movementX, next.movementY]).toEqual([10, 5]);
  });

  it('starts fresh after navigation replaces the Window while preserving the public proxy', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/before');
    const proxy = browser.window;
    const previous = getRelevantRealm(proxy).env.window;
    previous.setPointerLockAttributesForMousemove(new MouseMovementEvent('mousemove', 100, 400));
    await browser.navigate('https://example.test/after');
    expect(browser.window).toBe(proxy);
    const current = getRelevantRealm(browser.window).env.window;
    expect(current).not.toBe(previous);
    expect(current.lastMouseMove).toBeUndefined();
    const event = new MouseMovementEvent('mousemove', 900, 800);
    current.setPointerLockAttributesForMousemove(event);
    expect([event.movementX, event.movementY]).toEqual([0, 0]);
    expect(previous.lastMouseMove).toEqual({ x: 100, y: 400 });
  });
});
