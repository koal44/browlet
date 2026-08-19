import { describe, expect, it } from 'vitest';

import { Domlet } from '../../../src/domlet/domlet';
import { EventTargetImpl } from '../../../src/domlet/events/event-target';
import { EventImpl } from '../../../src/domlet/events/event';

describe('Domlet', () => {
  it('binds DOM constructors to one realm host', () => {
    let timeStamp = 10;
    const domlet = new Domlet({
      eventTimeStamp: () => ++timeStamp,
    });
    const { CustomEvent, Event, EventTarget } = domlet.bindings;
    const event = new Event('ready');
    const customEvent = new CustomEvent('answer', { detail: 42 });
    const eventTarget = new EventTarget();
    const document = domlet.parse();

    expect(event).toBeInstanceOf(EventImpl);
    expect(event.timeStamp).toBe(11);
    expect(customEvent).toBeInstanceOf(Event);
    expect(customEvent.timeStamp).toBe(12);
    expect(customEvent.detail).toBe(42);
    expect(eventTarget).toBeInstanceOf(EventTargetImpl);
    expect(document).toBeInstanceOf(EventTarget);
  });

  it('materializes distinct constructors for distinct realms', () => {
    const first = new Domlet();
    const second = new Domlet();

    expect(first.bindings.Event).not.toBe(second.bindings.Event);
    expect(first.bindings.CustomEvent).not.toBe(second.bindings.CustomEvent);
    expect(first.bindings.EventTarget).not.toBe(second.bindings.EventTarget);
  });

  it('lazily associates one CSS engine with its document', () => {
    const document = new Domlet().parse('<main id="target"></main>');
    const cssEngine = document.cssEngine;

    expect(document.cssEngine).toBe(cssEngine);
    expect(cssEngine.snapshot.document).toBe(document);
    expect(cssEngine.snapshot.root).toBe(document.documentElement);
    expect(cssEngine.snapshot.isQuirksMode).toBe(true);
    expect(cssEngine.version).toBe('stylelet-__VERSION__');
    expect(document.documentElement.localName).toBe('html');
    expect(document.getElementById('target')?.localName).toBe('main');
  });
});
