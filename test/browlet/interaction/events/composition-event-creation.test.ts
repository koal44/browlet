import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { CompositionEventImpl, type CompositionEventType } from '../../../../src/browlet/interaction/events/index';
import type { CompositionEvent as CompositionEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';
import { useFixture } from '../../../support/fixture';

describe('UI Events §3.6.7: trusted CompositionEvent preparation', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it.each([
    ['start', true], ['update', false], ['end', false],
  ] satisfies [CompositionEventType, boolean][])(
    'prepares %s with its specified attributes and cancellation behavior', (type, cancelable) => {
      const browser = prepared();
      const element = browser.document.createElement('div');
      const target = unwrap<ElementImpl>(element);
      const event = CompositionEventImpl.create(type, target, 'composition text');
      const platform = project(event) as CompositionEventPlatform;
      expect(platform).toBeInstanceOf(browser.window.CompositionEvent);
      expect([platform.type, platform.data, platform.target, platform.view])
        .toEqual([`composition${type}`, 'composition text', element, browser.window]);
      expect([event.initialized, platform.bubbles, platform.cancelable, platform.composed, platform.isTrusted, platform.detail])
        .toEqual([true, true, cancelable, true, true, 0]);
      expect([platform.currentTarget, platform.composedPath(), platform.defaultPrevented]).toEqual([null, [], false]);
      expect(getRelevantRealm(platform)).toBe(getRelevantRealm(target));
      platform.preventDefault();
      expect(platform.defaultPrevented).toBe(cancelable);
    },
  );

  it('allocates fresh events using the target realm clock', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.body!);
    const realm = getRelevantRealm(target);
    const clock = vi.spyOn(realm, 'eventTimeStamp').mockReturnValueOnce(125).mockReturnValueOnce(130);
    try {
      const first = project(CompositionEventImpl.create('update', target, 'a')) as CompositionEventPlatform;
      const second = project(CompositionEventImpl.create('update', target, 'b')) as CompositionEventPlatform;
      expect(first).not.toBe(second);
      expect([first.timeStamp, second.timeStamp, first.data, second.data]).toEqual([125, 130, 'a', 'b']);
      expect(clock).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it('preserves the producer text, including empty data, without normalizing the selected edit', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.body!);
    for (const type of ['start', 'update', 'end'] as const) {
      for (const data of ['', 'original selection', 'e\u0301', '\ud800', '\ud83d\ude42']) {
        const event = project(CompositionEventImpl.create(type, target, data)) as CompositionEventPlatform;
        expect(event.data).toBe(data);
      }
    }
  });

  it('leaves dispatch, session sequencing, editing, and composition-state reporting to their owners', () => {
    const browser = prepared();
    const element = browser.document.body!;
    element.textContent = 'unchanged';
    const listener = vi.fn();
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
      element.addEventListener(type, listener);
    }
    const target = unwrap<ElementImpl>(element);
    // A factory can prepare notifications in any order; the producer owns session sequencing.
    CompositionEventImpl.create('end', target, 'final');
    CompositionEventImpl.create('start', target, 'original');
    CompositionEventImpl.create('update', target, 'current');
    expect(listener).not.toHaveBeenCalled();
    expect(element.textContent).toBe('unchanged');
    expect(new browser.window.KeyboardEvent('keydown').isComposing).toBe(false);
    expect(new browser.window.InputEvent('input').isComposing).toBe(false);
  });

  it('delivers through shadow boundaries with trust and the specified cancellation flags', () => {
    const browser = prepared();
    const host = browser.document.createElement('div');
    browser.document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const child = browser.document.createElement('span');
    shadow.appendChild(child);
    const target = unwrap<ElementImpl>(child);
    const observed: unknown[] = [];
    for (const type of ['start', 'update', 'end'] as const) {
      browser.document.addEventListener(`composition${type}`, (event) => {
        event.preventDefault();
        observed.push([event.type, event.target === host, event.isTrusted, event.defaultPrevented]);
      }, { once: true });
      expect(target.dispatch(CompositionEventImpl.create(type, target, 'text'))).toBe(type !== 'start');
    }
    expect(observed).toEqual([
      ['compositionstart', true, true, true], ['compositionupdate', true, true, false], ['compositionend', true, true, false],
    ]);
  });
});

describe('CompositionEvent preparation: target ownership', () => {
  const prepared = useFixture(() => [new Browlet({ route: () => '' }), new Browlet({ route: () => '' })] as const);

  it('retains target-realm event ownership and view when another realm reads it', () => {
    const [owner, other] = prepared();
    const target = unwrap<ElementImpl>(owner.document.body!);
    const event = project(CompositionEventImpl.create('update', target, 'text')) as CompositionEventPlatform;
    const data = Object.getOwnPropertyDescriptor(other.window.CompositionEvent.prototype, 'data')!;
    const view = Object.getOwnPropertyDescriptor(other.window.UIEvent.prototype, 'view')!;
    expect(data.get!.call(event)).toBe('text');
    expect(view.get!.call(event)).toBe(owner.window);
    expect(event.target).toBe(owner.document.body);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
    expect(event).not.toBeInstanceOf(other.window.CompositionEvent);
  });
});
