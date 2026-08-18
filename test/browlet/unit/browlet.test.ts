import { describe, expect, it } from 'vitest';

import {
  Browlet, createBrowlet,
} from '../../../src/browlet/browlet';
import { isHTMLLinkElement } from '../../../src/domlet/nodes/element';

describe('createBrowlet', () => {
  it('coordinates a Domlet document and window', () => {
    const browlet = createBrowlet({ route: () => '' });

    expect(browlet).toBeInstanceOf(Browlet);
    expect(browlet.document.documentElement.localName).toBe('html');
    expect(browlet.window.document).toBe(browlet.document);
    expect(browlet.window.window).toBe(browlet.window);
    expect(browlet.window.self).toBe(browlet.window);
  });

  it('exposes window events and browser timer IDs', async () => {
    const browlet = createBrowlet({ route: () => '' });
    const events: Event[] = [];
    const event = new Event('custom');

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

  it('fetches through one replaceable local route', () => {
    const browlet = createBrowlet({
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
    const browlet = createBrowlet({ route: () => '' });

    browlet.expose('bridge', 'first');
    browlet.expose('bridge', 'second');

    expect(Reflect.get(browlet.window, 'bridge')).toBe('second');
  });

  it('executes inline scripts against the partial document', async () => {
    const observations: unknown[] = [];
    const browlet = createBrowlet({
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
    const browlet = createBrowlet({
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
    const browlet = createBrowlet({
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
    const browlet = createBrowlet({
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
    const browlet = createBrowlet({
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
    const browlet = createBrowlet({
      route: () => '<script>throw new Error("distinctive failure")</script>',
    });

    await expect(
      browlet.navigate('https://example.test/page'),
    ).rejects.toThrow('distinctive failure');
  });

  it('reports inline script positions relative to the document source', async () => {
    const stacks: string[] = [];
    const browlet = createBrowlet({
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
