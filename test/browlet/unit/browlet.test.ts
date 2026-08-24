import { describe, expect, it, vi } from 'vitest';

import {
  Browlet,
} from '../../../src/browlet/browlet';
import { fireEvent } from '../../../src/domlet/events/event-target';
import type { EventTargetImpl } from '../../../src/domlet/events/event-target';
import { DocumentImpl } from '../../../src/domlet/nodes/document';
import { isHTMLLinkElement } from '../../../src/domlet/nodes/element';
import { serializeOrigin } from '../../../src/url/origin';

describe('Browlet', () => {
  it('coordinates a Domlet document and window', () => {
    const browlet = new Browlet({ route: () => '' });

    expect(browlet).toBeInstanceOf(Browlet);
    expect(browlet.document.documentElement.localName).toBe('html');
    expect(browlet.window.document).toBe(browlet.document);
    expect(browlet.window.window).toBe(browlet.window);
    expect(browlet.window.self).toBe(browlet.window);
  });

  it('resolves computed style through the current window document', async () => {
    const browlet = new Browlet({
      route: () => '<main id="target" style="opacity: 0.25"></main>',
    });
    await browlet.navigate('https://example.test/');
    const target = browlet.document.getElementById('target');
    if (!target) throw new Error('Expected target element');

    expect(browlet.window.getComputedStyle(target).opacity).toBe('0.25');
  });

  it('initializes a navigated document from its response URL', async () => {
    const browlet = new Browlet({ route: () => '' });

    await browlet.navigate('https://example.test/path?query#fragment');

    expect(browlet.document.URL).toBe(
      'https://example.test/path?query#fragment',
    );
    expect(browlet.document.baseURI).toBe(browlet.document.URL);
    expect(browlet.document.contentType).toBe('text/html');
    expect(serializeOrigin(DocumentImpl.getOrigin(browlet.document))).toBe(
      'https://example.test',
    );
    expect(DocumentImpl.allowsDeclarativeShadowRoots(browlet.document))
      .toBe(true);
    expect(DocumentImpl.getCurrentDocumentReadiness(browlet.document))
      .toBe('complete');
    expect(DocumentImpl.isReadyForPostLoadTasks(browlet.document)).toBe(true);
    expect(DocumentImpl.getCompletelyLoadedTime(browlet.document))
      .not.toBeNull();
    expect(DocumentImpl.wasCreatedViaCrossOriginRedirects(browlet.document))
      .toBe(false);
    expect(DocumentImpl.getDuringLoadingNavigationID(browlet.document))
      .toBeNull();
    expect(DocumentImpl.getCustomElementRegistry(browlet.document))
      .not.toBeNull();
    expect(DocumentImpl.getInternalAncestorOriginObjectsList(browlet.document))
      .toEqual([]);
    expect(DocumentImpl.getAncestorOriginsList(browlet.document)).toEqual([]);
  });

  it('installs realm-specific DOM constructors on the window', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const EventConstructor = Reflect.get(first.window, 'Event') as typeof Event;
    const CustomEventConstructor = Reflect.get(
      first.window,
      'CustomEvent',
    ) as typeof CustomEvent;
    const EventTargetConstructor = Reflect.get(
      first.window,
      'EventTarget',
    ) as typeof EventTarget;
    const NodeConstructor = Reflect.get(first.window, 'Node') as typeof Node;
    const CharacterDataConstructor = Reflect.get(
      first.window,
      'CharacterData',
    ) as typeof CharacterData;
    const DocumentConstructor = Reflect.get(
      first.window,
      'Document',
    ) as typeof Document;
    const ElementConstructor = Reflect.get(
      first.window,
      'Element',
    ) as typeof Element;
    const HTMLElementConstructor = Reflect.get(
      first.window,
      'HTMLElement',
    ) as typeof HTMLElement;
    const TextConstructor = Reflect.get(first.window, 'Text') as typeof Text;
    const event = new EventConstructor('ready');
    const customEvent = new CustomEventConstructor('answer', { detail: 42 });
    const element = first.document.createElement('main');
    const text = first.document.createTextNode('content');

    expect(EventConstructor).not.toBe(Event);
    expect(EventConstructor).not.toBe(Reflect.get(second.window, 'Event'));
    expect(event).toBeInstanceOf(EventConstructor);
    expect(customEvent).toBeInstanceOf(EventConstructor);
    expect(customEvent.detail).toBe(42);
    expect(new EventTargetConstructor()).toBeInstanceOf(EventTargetConstructor);
    expect(first.document).toBeInstanceOf(EventTargetConstructor);
    expect(first.document).toBeInstanceOf(NodeConstructor);
    expect(first.document).toBeInstanceOf(DocumentConstructor);
    expect(first.document).not.toBeInstanceOf(
      Reflect.get(second.window, 'Document') as typeof Document,
    );
    expect(element).toBeInstanceOf(HTMLElementConstructor);
    expect(element).toBeInstanceOf(ElementConstructor);
    expect(element).toBeInstanceOf(NodeConstructor);
    expect(text).toBeInstanceOf(TextConstructor);
    expect(text).toBeInstanceOf(CharacterDataConstructor);
    expect(text).toBeInstanceOf(NodeConstructor);
    expect(Reflect.getPrototypeOf(DocumentConstructor.prototype))
      .toBe(NodeConstructor.prototype);
    expect(Reflect.getPrototypeOf(NodeConstructor.prototype))
      .toBe(EventTargetConstructor.prototype);
    expect(Reflect.getPrototypeOf(TextConstructor.prototype))
      .toBe(CharacterDataConstructor.prototype);
    expect(Reflect.getPrototypeOf(CharacterDataConstructor.prototype))
      .toBe(NodeConstructor.prototype);
  });

  it('exposes window events and browser timer IDs', async () => {
    const browlet = new Browlet({ route: () => '' });
    const events: Event[] = [];
    const EventConstructor = Reflect.get(
      browlet.window,
      'Event',
    ) as typeof Event;
    const event = new EventConstructor('custom');

    browlet.window.addEventListener('custom', (received) => {
      events.push(received);
    });

    expect(browlet.window.dispatchEvent(event)).toBe(true);
    expect(events).toEqual([event]);

    const fired = Promise.withResolvers<void>();
    const timer = browlet.window.setTimeout(() => fired.resolve());

    expect(typeof timer).toBe('number');
    await fired.promise;
  });

  it('fires trusted events using the target realm interface family', () => {
    const browlet = new Browlet({ route: () => '' });
    const EventConstructor = Reflect.get(
      browlet.window,
      'Event',
    ) as typeof Event;
    let received: Event | undefined;

    browlet.document.addEventListener('ready', (event) => {
      received = event;
    });

    expect(fireEvent(
      'ready',
      browlet.document as unknown as EventTargetImpl,
    )).toBe(true);
    expect(received).toBeInstanceOf(EventConstructor);
    expect(received?.isTrusted).toBe(true);
  });

  it('preserves listener identity through Web IDL callback conversion', () => {
    const browlet = new Browlet({ route: () => '' });
    const EventConstructor = Reflect.get(
      browlet.window,
      'Event',
    ) as typeof Event;
    const handleEvent = vi.fn();
    const callback = { handleEvent };

    browlet.window.addEventListener('ready', callback);
    browlet.window.addEventListener('ready', callback);
    browlet.window.removeEventListener('ready', callback);
    browlet.window.dispatchEvent(new EventConstructor('ready'));

    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('invokes callback-interface objects with their object as receiver', () => {
    const browlet = new Browlet({ route: () => '' });
    const EventConstructor = Reflect.get(
      browlet.window,
      'Event',
    ) as typeof Event;
    const callback = {
      receiver: undefined as unknown,
      handleEvent(this: { receiver: unknown; }) {
        this.receiver = this;
      },
    };

    browlet.window.addEventListener('ready', callback);
    browlet.window.dispatchEvent(new EventConstructor('ready'));

    expect(callback.receiver).toBe(callback);
  });

  it('converts event listener option dictionaries at the Web IDL boundary', () => {
    const browlet = new Browlet({ route: () => '' });
    const accesses: string[] = [];
    const signal = new AbortController().signal;
    const listener = () => {};
    const options = {
      get capture() { accesses.push('capture'); return 1; },
      get once() { accesses.push('once'); return 1; },
      get passive() { accesses.push('passive'); return 0; },
      get signal() { accesses.push('signal'); return signal; },
    } as unknown as AddEventListenerOptions;

    browlet.window.addEventListener('ready', listener, options);

    expect(accesses).toEqual(['capture', 'once', 'passive', 'signal']);
    accesses.length = 0;

    browlet.window.removeEventListener('ready', listener, options);

    expect(accesses).toEqual(['capture']);
  });

  it('tracks and restores the legacy current window event', () => {
    const browlet = new Browlet({ route: () => '' });
    const EventConstructor = Reflect.get(
      browlet.window,
      'Event',
    ) as typeof Event;
    const outer = new EventConstructor('outer');
    const inner = new EventConstructor('inner');
    const observations: (Event | undefined)[] = [];

    browlet.window.addEventListener('outer', () => {
      observations.push(browlet.window.event);
      browlet.window.dispatchEvent(inner);
      observations.push(browlet.window.event);
    });
    browlet.window.addEventListener('inner', () => {
      observations.push(browlet.window.event);
    });

    expect(browlet.window.event).toBeUndefined();
    browlet.window.dispatchEvent(outer);
    expect(browlet.window.event).toBeUndefined();
    expect(observations).toEqual([outer, inner, outer]);
  });

  it('reports listener exceptions without interrupting dispatch', () => {
    const browlet = new Browlet({ route: () => '' });
    const EventConstructor = Reflect.get(
      browlet.window,
      'Event',
    ) as typeof Event;
    const reported = new Error('reported listener failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const following = vi.fn();

    browlet.window.addEventListener('ready', () => { throw reported; });
    browlet.window.addEventListener('ready', following);

    expect(() => {
      browlet.window.dispatchEvent(new EventConstructor('ready'));
    }).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(reported);
    expect(following).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });

  it('allows the legacy current event attribute to be replaced', () => {
    const browlet = new Browlet({ route: () => '' });
    const replacement = new Event('replacement');

    Object.assign(browlet.window, { event: replacement });

    expect(browlet.window.event).toBe(replacement);
    expect(Object.getOwnPropertyDescriptor(browlet.window, 'event'))
      .toMatchObject({
        configurable: true,
        enumerable: true,
        value: replacement,
        writable: true,
      });
  });

  it('fetches through one replaceable local route', () => {
    const browlet = new Browlet({
      route: (url) => `first: ${url}`,
    });

    expect(browlet.fetch('https://example.test/one')).toBe(
      'first: https://example.test/one',
    );

    browlet.route((url) => `second: ${url}`);

    expect(browlet.fetch(new URL('https://example.test/two'))).toBe(
      'second: https://example.test/two',
    );
  });

  it('exposes and replaces host values', () => {
    const browlet = new Browlet({ route: () => '' });

    browlet.expose('bridge', 'first');
    browlet.expose('bridge', 'second');

    expect(Reflect.get(browlet.window, 'bridge')).toBe('second');
  });

  it('executes inline scripts against the partial document', async () => {
    const observations: unknown[] = [];
    const browlet = new Browlet({
      route: () => [
        '<main id="before"></main>',
        '<script>',
        'observe(document.getElementById("before"));',
        'observe(document.getElementById("after"));',
        'observe(window === self && self === globalThis);',
        '</script>',
        '<main id="after"></main>',
      ].join(''),
    });

    browlet.expose('observe', (value: unknown) => observations.push(value));

    const window = await browlet.navigate('https://example.test/page');

    expect(observations).toEqual([
      browlet.document.getElementById('before'),
      null,
      true,
    ]);
    expect(window).toBe(browlet.window);
    expect(browlet.document.getElementById('after')?.localName).toBe('main');
    expect(browlet.window.document).toBe(browlet.document);
  });

  it('routes and executes external scripts before parsing continues', async () => {
    const requests: string[] = [];
    const observations: unknown[] = [];
    const browlet = new Browlet({
      route: (url) => {
        requests.push(url);

        if (url === 'https://example.test/script.js') {
          return 'observe(document.getElementById("after"))';
        }

        return '<script src="/script.js"></script><main id="after"></main>';
      },
    });

    browlet.expose('observe', (value: unknown) => observations.push(value));
    await browlet.navigate('https://example.test/page');

    expect(requests).toEqual([
      'https://example.test/page',
      'https://example.test/script.js',
    ]);
    expect(observations).toEqual([null]);
  });

  it.skip('associates externally linked style sheets after fetching', async () => {
    const requests: string[] = [];
    const browlet = new Browlet({
      route: (url) => {
        requests.push(url);
        if (url === 'https://example.test/style.css') {
          return 'main { opacity: 0.5 }';
        }
        return '<link id="style" rel="stylesheet" href="/style.css">';
      },
    });

    await browlet.navigate('https://example.test/page');
    const link = browlet.document.getElementById('style');
    if (!link || !isHTMLLinkElement(link)) {
      throw new Error('Expected an HTML link element');
    }

    expect(requests).toEqual([
      'https://example.test/page',
      'https://example.test/style.css',
    ]);
    expect(link.sheet).not.toBeNull();
    expect(link.sheet?.ownerNode).toBe(link);
    expect(browlet.document.styleSheets.item(0)).toBe(link.sheet);
  });

  it('exposes parsed element IDs as named window properties', async () => {
    const observations: unknown[] = [];
    const browlet = new Browlet({
      route: () => [
        '<main id="named"></main>',
        '<script>observe(named)</script>',
      ].join(''),
    });

    browlet.expose('observe', (value: unknown) => observations.push(value));
    await browlet.navigate('https://example.test/page');

    expect(observations).toEqual([
      browlet.document.getElementById('named'),
    ]);
  });

  it('inserts document.write markup in call order', async () => {
    const browlet = new Browlet({
      route: () => [
        '<script>',
        'document.write("<main id=first></main>");',
        'document.write("<aside id=second></aside>");',
        '</script>',
        '<footer id="after"></footer>',
      ].join(''),
    });

    await browlet.navigate('https://example.test/page');

    const first = browlet.document.getElementById('first');
    const second = browlet.document.getElementById('second');
    const after = browlet.document.getElementById('after');

    expect(first?.nextElementSibling).toBe(second);
    expect(second?.nextElementSibling).toBe(after);
  });

  it('rejects navigation when script execution fails', async () => {
    const browlet = new Browlet({
      route: () => '<script>throw new Error("distinctive failure")</script>',
    });

    await expect(
      browlet.navigate('https://example.test/page'),
    ).rejects.toThrow('distinctive failure');
  });

  it('reports inline script positions relative to the document source', async () => {
    const stacks: string[] = [];
    const browlet = new Browlet({
      route: () => [
        '<main></main>',
        '<script>',
        'observe(new Error("location").stack);',
        '</script>',
      ].join('\n'),
    });

    browlet.expose('observe', (stack: unknown) => stacks.push(String(stack)));
    await browlet.navigate('https://example.test/page');

    expect(stacks[0]).toContain('https://example.test/page:3');
  });
});
