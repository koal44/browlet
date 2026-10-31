// Browser-only observations for the pending Location descriptor choice; run manually.
import { log } from 'node:console';
import { chromium, firefox, webkit } from 'playwright';

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({
      contentType: 'text/html', headers: { 'Origin-Agent-Cluster': '?0' }, body: '<!doctype html><body>',
    }));
    await page.goto('https://a.location-properties.test/');
    const observations = await page.evaluate(async () => {
      const { document, originAgentCluster } = globalThis;
      const capture = (steps) => { try { return steps(); } catch (error) { return error.name; } };
      const freshLocation = () => {
        const frame = document.createElement('iframe');
        document.body.append(frame);
        return { frame, location: frame.contentWindow.location, realm: frame.contentWindow };
      };

      const properties = [];
      for (const key of ['href', 'assign', 'replace', 'toString', 'valueOf', Symbol.toPrimitive]) {
        const { frame, location } = freshLocation();
        try {
          const descriptor = Object.getOwnPropertyDescriptor(location, key);
          const replacement = Object.hasOwn(descriptor, 'value') ? { value: () => 'forged' } : { get: () => 'forged' };
          properties.push({
            key: String(key),
            configurable: descriptor.configurable,
            redefineEmpty: capture(() => Reflect.defineProperty(location, key, {})),
            redefineSame: capture(() => Reflect.defineProperty(location, key, descriptor)),
            makeConfigurable: capture(() => Reflect.defineProperty(location, key, { configurable: true })),
            replace: capture(() => Reflect.defineProperty(location, key, replacement)),
            delete: capture(() => Reflect.deleteProperty(location, key)),
            stillOwn: capture(() => Object.hasOwn(location, key)),
          });
        } finally {
          frame.remove();
        }
      }

      const conversion = [];
      for (const key of ['valueOf', 'toString', Symbol.toPrimitive]) {
        const { frame, location, realm } = freshLocation();
        try {
          Object.defineProperty(realm.Location.prototype, key, { value: () => 'forged', configurable: true });
          const deleted = capture(() => Reflect.deleteProperty(location, key));
          conversion.push({
            key: String(key), deleted,
            string: capture(() => String(location)),
            concatenation: capture(() => location + ''),
            propertyKey: capture(() => Object.keys({ [location]: true })[0]),
          });
        } finally {
          frame.remove();
        }
      }

      // Control: a configurable descriptor need not allow mutation on an exotic object.
      // This is only an ECMAScript Proxy example, not a model of Location's cross-origin behavior.
      const target = {};
      Object.defineProperty(target, 'valueOf', {
        value: Object.prototype.valueOf, writable: false, enumerable: false, configurable: true,
      });
      const guarded = new Proxy(target, {
        defineProperty: () => false,
        deleteProperty: () => false,
      });
      const configurableControl = {
        configurable: Object.getOwnPropertyDescriptor(guarded, 'valueOf').configurable,
        redefine: Reflect.defineProperty(guarded, 'valueOf', { value: guarded.valueOf }),
        delete: Reflect.deleteProperty(guarded, 'valueOf'),
        stillOwn: Object.hasOwn(guarded, 'valueOf'),
      };

      // document.domain changes access to the same Location without replacing its Window.
      const frame = document.createElement('iframe');
      const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
      frame.src = 'https://a.location-properties.test/domain-child';
      document.body.append(frame);
      await loaded;
      let domainTransition;
      try {
        const retained = frame.contentWindow.location;
        const originalReplace = retained.replace;
        const before = Object.getOwnPropertyDescriptor(retained, 'replace');
        const originKeyed = { parent: originAgentCluster, child: frame.contentWindow.originAgentCluster };
        const relaxChild = capture(() => { frame.contentDocument.domain = 'location-properties.test'; return true; });
        const foreignReplace = capture(() => Object.getOwnPropertyDescriptor(retained, 'replace'));
        const foreign = {
          sameLocation: capture(() => retained === frame.contentWindow.location),
          href: capture(() => retained.href),
          valueOfDescriptor: capture(() => Object.getOwnPropertyDescriptor(retained, 'valueOf')),
          replaceConfigurable: typeof foreignReplace === 'object' ? foreignReplace.configurable : foreignReplace,
          sameReplaceFunction: capture(() => retained.replace === originalReplace),
        };
        const relaxParent = capture(() => { document.domain = 'location-properties.test'; return true; });
        domainTransition = {
          originKeyed, before: { configurable: before.configurable, writable: before.writable },
          relaxChild, foreign, relaxParent,
          restored: {
            href: capture(() => retained.href),
            replaceConfigurable: capture(() => Object.getOwnPropertyDescriptor(retained, 'replace').configurable),
            sameReplaceFunction: capture(() => retained.replace === originalReplace),
          },
        };
      } finally {
        frame.remove();
      }
      return { properties, conversion, configurableControl, domainTransition };
    });
    log(JSON.stringify({ browser: name, version: browser.version(), ...observations }, null, 2));
  } finally {
    await browser.close();
  }
}
