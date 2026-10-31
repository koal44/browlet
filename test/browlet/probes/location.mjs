// Browser-only evidence for the HTML 7.2.4 design review; run manually, never by the regression runner.
import { log } from 'node:console';
import { chromium, firefox, webkit } from 'playwright';

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>' }));
    await page.goto('https://location-a.test/root');
    const result = await page.evaluate(async () => {
      const { document, location, Location } = globalThis;
      const capture = (steps) => { try { return steps(); } catch (error) { return error.name; } };
      const descriptor = (object, key) => capture(() => {
        const value = Object.getOwnPropertyDescriptor(object, key);
        if (!value) return null;
        return {
          configurable: value.configurable, enumerable: value.enumerable,
          ...(Object.hasOwn(value, 'writable') ? { writable: value.writable, valueType: typeof value.value }
            : { getter: typeof value.get, setter: typeof value.set }),
        };
      });
      const keyName = (key) => typeof key === 'symbol' ? key.toString() : key;
      const nativeProperties = ['href', 'assign', 'replace', 'toString', 'valueOf', Symbol.toPrimitive];
      const sameOrigin = {
        keys: Reflect.ownKeys(location).map(keyName),
        descriptors: Object.fromEntries(nativeProperties.map((key) => [keyName(key), descriptor(location, key)])),
        valueOfIntrinsic: location.valueOf === Object.prototype.valueOf,
        redefineSameAssign: capture(() => Reflect.defineProperty(location, 'assign', { value: location.assign })),
        redefineSameValueOf: capture(() => Reflect.defineProperty(location, 'valueOf', { value: location.valueOf })),
        deleteAssign: capture(() => Reflect.deleteProperty(location, 'assign')),
        deleteValueOf: capture(() => Reflect.deleteProperty(location, 'valueOf')),
        preventExtensions: capture(() => Reflect.preventExtensions(location)),
        isExtensible: capture(() => Reflect.isExtensible(location)),
        setSamePrototype: capture(() => Reflect.setPrototypeOf(location, Location.prototype)),
        setNullPrototype: capture(() => Reflect.setPrototypeOf(location, null)),
      };
      const frame = document.createElement('iframe');
      const navigate = async (url) => {
        const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
        frame.src = url;
        if (!frame.isConnected) document.body.append(frame);
        await loaded;
      };
      await navigate('https://location-a.test/first');
      const retained = frame.contentWindow.location;
      const retainedDocument = frame.contentDocument;
      frame.contentWindow.history.replaceState(null, '', '/updated?query#fragment');
      const sameDocumentURL = retained.href;
      await navigate('https://location-a.test/second');
      const afterSameOriginNavigation = {
        retainedHref: capture(() => retained.href), newHref: frame.contentWindow.location.href,
        sameLocation: retained === frame.contentWindow.location,
        oldDocumentLocation: capture(() => retainedDocument.location === null ? null : 'non-null'),
      };
      await navigate('https://location-b.test/foreign');
      const foreign = frame.contentWindow.location;
      const crossOrigin = {
        keys: capture(() => Reflect.ownKeys(foreign).map(keyName)),
        descriptors: Object.fromEntries(nativeProperties.map((key) => [keyName(key), descriptor(foreign, key)])),
        href: capture(() => foreign.href),
        replaceIdentity: capture(() => foreign.replace === foreign.replace),
        prototype: capture(() => Object.getPrototypeOf(foreign)),
        setNullPrototype: capture(() => Reflect.setPrototypeOf(foreign, null)),
        preventExtensions: capture(() => Reflect.preventExtensions(foreign)),
        isExtensible: capture(() => Reflect.isExtensible(foreign)),
        define: capture(() => Reflect.defineProperty(foreign, 'extra', { value: 1 })),
        delete: capture(() => Reflect.deleteProperty(foreign, 'extra')),
        retainedHref: capture(() => retained.href),
      };
      await navigate('https://location-a.test/detach');
      const detached = frame.contentWindow.location;
      const detachedDocument = frame.contentDocument;
      frame.remove();
      const afterRemoval = {
        href: capture(() => detached.href),
        origin: capture(() => detached.origin),
        pathname: capture(() => detached.pathname),
        documentLocation: capture(() => detachedDocument.location === null ? null : 'non-null'),
        ancestorOrigins: capture(() => Array.from(detached.ancestorOrigins)),
        ancestorListIdentity: capture(() => detached.ancestorOrigins === detached.ancestorOrigins),
        assign: capture(() => { detached.assign('/ignored'); return 'returned'; }),
      };
      return { sameOrigin, sameDocumentURL, afterSameOriginNavigation, crossOrigin, afterRemoval };
    });
    log(JSON.stringify({ browser: name, version: browser.version(), ...result }, null, 2));
  } finally {
    await browser.close();
  }
}
