import { runScenarios } from '../../dispatch';

runScenarios('mixed-dom', 'normal', [
  {
    name: 'tag lookup case behavior across html xml and imported xml',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id=html>
        <head id=head></head>
        <body id=body>
          <div id=myroot>
            <Foo id=upper-html></Foo>
            <foo id=lower-html></foo>
          </div>
          <div id=import-host></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const xml = `<?xml version="1.0"?>
          <root xmlns:dc="http://purl.org/dc/elements/1.1/" id="xml-root">
            <Foo id="upper-null"></Foo>
            <foo id="lower-null"></foo>
            <dc:Foo id="upper-ns"></dc:Foo>
            <dc:foo id="lower-ns"></dc:foo>
          </root>`;
        const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
        const xmlRoot = xmlDoc.documentElement;
        const importedRoot = document.importNode(xmlRoot, true);
        document.getElementById('import-host')!.appendChild(importedRoot);
      });
    },
    cases: [
      // byTag
      { byTag: '*', expect: { ids: ['html', 'head', 'body', 'myroot', 'upper-html', 'lower-html', 'import-host', 'xml-root', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] } },
      { byTag: 'Foo', expect: { ids: ['upper-html', 'lower-html', 'upper-null'] } },
      { byTag: 'foo', expect: { ids: ['upper-html', 'lower-html', 'lower-null'] } },
      { byTag: ':Foo', expect: { ids: [] } },
      { byTag: ':foo', expect: { ids: [] } },
      { byTag: '*:Foo', expect: { ids: [] } },
      { byTag: '*:foo', expect: { ids: [] } },
      { byTag: 'dc:Foo', expect: { ids: ['upper-ns'] } },
      { byTag: 'dc:foo', expect: { ids: ['lower-ns'] } },

      // byTagNs
      { byTagNs: { ns: '*', local: '*' }, expect: { ids: ['html', 'head', 'body', 'myroot', 'upper-html', 'lower-html', 'import-host', 'xml-root', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] } },
      { byTagNs: { ns: '*', local: 'Foo' }, expect: { ids: ['upper-null', 'upper-ns'] } },
      { byTagNs: { ns: '*', local: 'foo' }, expect: { ids: ['upper-html', 'lower-html', 'lower-null', 'lower-ns'] } },
      { byTagNs: { ns: null, local: 'Foo' }, expect: { ids: ['upper-null'] } },
      { byTagNs: { ns: null, local: 'foo' }, expect: { ids: ['lower-null'] } },
      { byTagNs: { ns: 'http://www.w3.org/1999/xhtml', local: 'Foo' }, expect: { ids: [] } },
      { byTagNs: { ns: 'http://www.w3.org/1999/xhtml', local: 'foo' }, expect: { ids: ['upper-html', 'lower-html'] } },
      { byTagNs: { ns: 'http://purl.org/dc/elements/1.1/', local: 'Foo' }, expect: { ids: ['upper-ns'] } },
      { byTagNs: { ns: 'http://purl.org/dc/elements/1.1/', local: 'foo' }, expect: { ids: ['lower-ns'] } },
      { byTagNs: { ns: '*', local: '' }, expect: { ids: [] } },
      { byTagNs: { ns: null, local: '' }, expect: { ids: [] } },

      // select
      { select: '*', expect: { ids: ['html', 'head', 'body', 'myroot', 'upper-html', 'lower-html', 'import-host', 'xml-root', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] } },

      { select: 'Foo', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] }, browsers: ['chromium'], engines: ['native'] },
      { select: 'Foo', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'upper-ns'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      { select: 'foo', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] }, browsers: ['chromium'], engines: ['native'] },
      { select: 'foo', expect: { ids: ['upper-html', 'lower-html', 'lower-null', 'lower-ns'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      { select: '|Foo', expect: { ids: ['upper-null', 'lower-null'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '|Foo', expect: { ids: ['upper-null'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      { select: '|foo', expect: { ids: ['upper-null', 'lower-null'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '|foo', expect: { ids: ['lower-null'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      { select: '*|Foo', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '*|Foo', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'upper-ns'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      { select: '*|foo', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '*|foo', expect: { ids: ['upper-html', 'lower-html', 'lower-null', 'lower-ns'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      { select: 'dc|Foo', expect: { throws: true } },
      { select: 'dc|foo', expect: { throws: true } },
    ],
  },

  {
    name: 'fragment tag helpers preserve qualified and namespace lookup behavior',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id=myroot>
            <Foo id=upper-html></Foo>
            <foo id=lower-html></foo>
          </div>
          <template id=tmpl>
            <root xmlns:dc="http://purl.org/dc/elements/1.1/" id="xml-root">
              <Foo id="upper-null"></Foo>
              <foo id="lower-null"></foo>
              <dc:Foo id="upper-ns"></dc:Foo>
              <dc:foo id="lower-ns"></dc:foo>
            </root>
          </template>
        </body>
      </html>
    `,
    cases: [
      // Fragment-rooted HTML clone.
      { byTag: '*', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['myroot', 'upper-html', 'lower-html'] } },
      { byTag: 'Foo', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['upper-html', 'lower-html'] } },
      { byTag: 'foo', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['upper-html', 'lower-html'] } },

      { byTagNs: { ns: '*', local: '*' }, ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['myroot', 'upper-html', 'lower-html'] } },
      { byTagNs: { ns: '*', local: 'Foo' }, ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: [] } },
      { byTagNs: { ns: '*', local: 'foo' }, ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['upper-html', 'lower-html'] } },

      // Template content gives us a real DocumentFragment with XML-ish descendants.
      { byTag: '*', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['xml-root', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] } },
      { byTag: 'Foo', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-null', 'lower-null'] } },
      { byTag: 'foo', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-null', 'lower-null'] } },
      { byTag: 'dc:Foo', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-ns', 'lower-ns'] } },
      { byTag: 'dc:foo', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-ns', 'lower-ns'] } },

      { byTagNs: { ns: '*', local: 'Foo' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: [] } },
      { byTagNs: { ns: '*', local: 'foo' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-null', 'lower-null'] } },
      { byTagNs: { ns: null, local: 'Foo' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: [] } },
      { byTagNs: { ns: null, local: 'foo' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: [] } },
      { byTagNs: { ns: 'http://purl.org/dc/elements/1.1/', local: 'Foo' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: [] } },
      { byTagNs: { ns: 'http://purl.org/dc/elements/1.1/', local: 'foo' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'type predicate runs after non-type seed in mixed html xml tree',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id=html>
        <body id=body>
          <div id=myroot>
            <Foo id=upper-html class=hit></Foo>
            <foo id=lower-html class=hit></foo>
          </div>
          <div id=import-host></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const xml = `<?xml version="1.0"?>
          <root xmlns:dc="http://purl.org/dc/elements/1.1/" id="xml-root">
            <Foo id="upper-null" class="hit"></Foo>
            <foo id="lower-null" class="hit"></foo>
            <dc:Foo id="upper-ns" class="hit"></dc:Foo>
            <dc:foo id="lower-ns" class="hit"></dc:foo>
          </root>`;
        const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
        document.getElementById('import-host')!.appendChild(
          document.importNode(xmlDoc.documentElement, true)
        );
      });
    },
    cases: [
      // Class seed should collect all .hit nodes; type predicate must filter.
      { select: 'Foo.hit', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'upper-ns'] }, engines: ['selectlet'] },
      { select: 'foo.hit', expect: { ids: ['upper-html', 'lower-html', 'lower-null', 'lower-ns'] }, engines: ['selectlet'] },

      // Native split documented separately.
      { select: 'Foo.hit', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] }, browsers: ['chromium'], engines: ['native'] },
      { select: 'Foo.hit', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'upper-ns'] }, browsers: ['firefox', 'webkit'], engines: ['native'] },

      { select: 'foo.hit', expect: { ids: ['upper-html', 'lower-html', 'upper-null', 'lower-null', 'upper-ns', 'lower-ns'] }, browsers: ['chromium'], engines: ['native'] },
      { select: 'foo.hit', expect: { ids: ['upper-html', 'lower-html', 'lower-null', 'lower-ns'] }, browsers: ['firefox', 'webkit'], engines: ['native'] },
    ],
  },

  {
    name: 'attribute name casing across html and imported xml',
    // status: 'only',
    // engines: ['native'],
    // browsers: ['chromium'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id=html>
        <body id=body>
          <div id=html-el DATA-X=html-upper data-y=html-lower></div>
          <div id=import-host></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const xml = `<?xml version="1.0"?>
          <root id="xml-root">
            <item id="xml-upper" DATA-X="xml-upper"></item>
            <item id="xml-lower" data-x="xml-lower"></item>
            <item id="xml-both" DATA-X="upper" data-x="lower"></item>
          </root>`;
        const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
        document.getElementById('import-host')!.appendChild(
          document.importNode(xmlDoc.documentElement, true)
        );
      });
    },
    cases: [
      { select: '[data-x]', expect: { ids: ['html-el', 'xml-upper', 'xml-lower', 'xml-both'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '[data-x]', expect: { ids: ['html-el', 'xml-lower', 'xml-both'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },
      { select: '[DATA-X]', expect: { ids: ['html-el', 'xml-upper', 'xml-lower', 'xml-both'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '[DATA-X]', expect: { ids: ['html-el', 'xml-upper', 'xml-both'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

    ],
  },

  {
    name: 'attribute value html-insensitive table does not leak to imported xml',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <input id=html-input type=TEXT>
          <div id=import-host></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const xml = `<?xml version="1.0"?>
          <root>
            <input id="xml-input-upper" type="TEXT"></input>
            <input id="xml-input-lower" type="text"></input>
          </root>`;
        const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
        document.getElementById('import-host')!.appendChild(
          document.importNode(xmlDoc.documentElement, true)
        );
      });
    },
    cases: [
      { select: 'input[type="text"]', expect: { ids: ['html-input', 'xml-input-upper', 'xml-input-lower'] }, browsers: ['chromium'], engines: ['native'] },
      { select: 'input[type="text"]', expect: { ids: ['html-input', 'xml-input-lower'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },
      { select: 'input[type="TEXT"]', expect: { ids: ['html-input', 'xml-input-upper', 'xml-input-lower'] }, browsers: ['chromium'], engines: ['native'] },
      { select: 'input[type="TEXT"]', expect: { ids: ['html-input', 'xml-input-upper'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },
    ],
  },

  {
    name: 'defined pseudo does not treat imported xml custom-looking tags as html custom elements',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id=html>
        <body id=body>
          <div id=html-host>
            <x-plain id=html-undefined></x-plain>
            <x-ready id=html-defined></x-ready>
            <div id=html-div></div>
          </div>
          <div id=import-host></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        if (!customElements.get('x-ready')) {
          customElements.define('x-ready', class extends HTMLElement {});
        }

        const xml = `<?xml version="1.0"?>
          <root id="xml-root">
            <x-plain id="xml-hyphen"></x-plain>
            <plain id="xml-plain"></plain>
          </root>`;

        const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
        document.getElementById('import-host')!.appendChild(
          document.importNode(xmlDoc.documentElement, true)
        );
      });
    },
    cases: [
      // HTML custom-element behavior.
      { select: '#html-host > :defined', expect: { ids: ['html-defined', 'html-div'] } },
      { select: '#html-host > x-plain:defined', expect: { ids: [] } },
      { select: '#html-host > x-ready:defined', expect: { ids: ['html-defined'] } },

      // Imported XML elements should not be treated as unresolved HTML custom elements.
      { select: '#import-host :defined', expect: { ids: ['xml-root', 'xml-hyphen', 'xml-plain'] } },
      { select: '#import-host x-plain:defined', expect: { ids: ['xml-hyphen'] } },
    ],
  },

  {
    name: 'xml document xhtml namespace keeps xml casing but applies defined custom-element rules',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root xmlns:h="http://www.w3.org/1999/xhtml">
        <h:input id="xhtml-input-upper" type="TEXT" />
        <h:input id="xhtml-input-lower" type="text" />
        <h:X-Plain id="xhtml-custom-upper" />
        <h:x-plain id="xhtml-custom-lower" />
      </root>
    `,
    cases: [
      // Type selector casing remains XML-sensitive even for XHTML-namespace elements.
      { select: '*|input', expect: { ids: ['xhtml-input-upper', 'xhtml-input-lower'] } },
      { select: '*|Input', expect: { ids: [] } },

      // Attribute names and values remain XML-sensitive; HTML folding must not leak here.
      { select: '*|input[TYPE]', expect: { ids: [] } },
      { select: '*|input[type]', expect: { ids: ['xhtml-input-upper', 'xhtml-input-lower'] } },
      { select: '*|input[type="text"]', expect: { ids: ['xhtml-input-lower'] } },
      { select: '*|input[type="TEXT"]', expect: { ids: ['xhtml-input-upper'] } },

      // :defined still applies valid-custom-element-name logic to XHTML-namespace elements.
      // Uppercase names are not valid custom element names, so they are defined.
      // Lowercase valid custom element names are unresolved unless registered.
      { select: '*|X-Plain:defined', expect: { ids: ['xhtml-custom-upper'] } },
      { select: '*|x-plain:defined', expect: { ids: [] } },
    ],
  },

  {
    name: 'defined pseudo respects custom element name blacklist',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root xmlns:h="http://www.w3.org/1999/xhtml">
        <h:x-plain id="x-plain"></h:x-plain>
        <h:font-face id="font-face"></h:font-face>
        <h:annotation-xml id="annotation-xml"></h:annotation-xml>
        <h:color-profile id="color-profile"></h:color-profile>
      </root>
    `,
    cases: [
      { select: '*|x-plain:defined', expect: { ids: [] } },

      // These look like custom-element names, but are reserved names,
      // so they are not unresolved custom elements and should match :defined.
      { select: '*|font-face:defined', expect: { ids: ['font-face'] } },
      { select: '*|annotation-xml:defined', expect: { ids: ['annotation-xml'] } },
      { select: '*|color-profile:defined', expect: { ids: ['color-profile'] } },
    ],
  },

  {
    name: 'attribute existence ascii name folding',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="root">
            <span id="html-ascii"></span>
            <span id="html-nonascii-lower"></span>
            <span id="html-nonascii-upper"></span>
            <span id="html-colon"></span>
            <div id="xml-host"></div>
          </div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        document.getElementById('html-ascii')!.setAttribute('DATA-X', '1');

        // HTML setAttribute lowercases ASCII name chars but should not Unicode-fold Ö -> ö.
        document.getElementById('html-nonascii-lower')!.setAttribute('föo', '1');
        document.getElementById('html-nonascii-upper')!.setAttribute('FÖO', '1');

        document.getElementById('html-colon')!.setAttribute('FOO:BAR', '1');

        const xmlDoc = new DOMParser().parseFromString(`
          <root>
            <item id="xml-nonascii-lower" föo="1" />
            <item id="xml-nonascii-upper" FÖO="1" />
          </root>
        `, 'text/xml');

        document.getElementById('xml-host')!.appendChild(
          document.importNode(xmlDoc.documentElement, true)
        );
      });
    },
    cases: [
      // HTML ASCII attribute names are ASCII case-insensitive.
      { select: '#html-ascii[data-x]', expect: { ids: ['html-ascii'] } },
      { select: '#html-ascii[DATA-X]', expect: { ids: ['html-ascii'] } },
      { select: '#html-ascii[*|data-x]', expect: { ids: ['html-ascii'] } },
      { select: '#html-ascii[*|DATA-X]', expect: { ids: ['html-ascii'] } },

      // Non-ASCII name chars should not be Unicode-folded.
      //
      // setAttribute('föo') remains föo.
      // setAttribute('FÖO') becomes fÖo on HTML elements: ASCII F/O fold, Ö preserved.
      { select: '#html-nonascii-lower[föo]', expect: { ids: ['html-nonascii-lower'] } },
      { select: '#html-nonascii-lower[FöO]', expect: { ids: ['html-nonascii-lower'] } },
      { select: '#html-nonascii-lower[fÖo]', expect: { ids: [] } },
      { select: '#html-nonascii-lower[FÖO]', expect: { ids: [] } },

      { select: '#html-nonascii-upper[fÖo]', expect: { ids: ['html-nonascii-upper'] } },
      { select: '#html-nonascii-upper[FÖO]', expect: { ids: ['html-nonascii-upper'] } },
      { select: '#html-nonascii-upper[föo]', expect: { ids: [] } },
      { select: '#html-nonascii-upper[FöO]', expect: { ids: [] } },

      // Same checks under wildcard namespace. This is the branch that needs asciiLower(local).
      { select: '#html-nonascii-lower[*|föo]', expect: { ids: ['html-nonascii-lower'] } },
      { select: '#html-nonascii-lower[*|FöO]', expect: { ids: ['html-nonascii-lower'] } },
      { select: '#html-nonascii-lower[*|fÖo]', expect: { ids: [] } },
      { select: '#html-nonascii-lower[*|FÖO]', expect: { ids: [] } },

      { select: '#html-nonascii-upper[*|fÖo]', expect: { ids: ['html-nonascii-upper'] } },
      { select: '#html-nonascii-upper[*|FÖO]', expect: { ids: ['html-nonascii-upper'] } },
      { select: '#html-nonascii-upper[*|föo]', expect: { ids: [] } },
      { select: '#html-nonascii-upper[*|FöO]', expect: { ids: [] } },

      // Escaped colon plus ASCII folding on HTML names.
      { select: '#html-colon[foo\\:bar]', expect: { ids: ['html-colon'] } },
      { select: '#html-colon[FOO\\:BAR]', expect: { ids: ['html-colon'] } },
      { select: '#html-colon[*|foo\\:bar]', expect: { ids: ['html-colon'] } },
      { select: '#html-colon[*|FOO\\:BAR]', expect: { ids: ['html-colon'] } },

      // Imported XML stays case-sensitive, including ASCII.
      { select: '#xml-nonascii-lower[föo]', expect: { ids: ['xml-nonascii-lower'] } },

      { select: '#xml-nonascii-lower[FöO]', expect: { ids: ['xml-nonascii-lower'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-nonascii-lower[FöO]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-nonascii-lower[fÖo]', expect: { ids: [] } },
      { select: '#xml-nonascii-lower[FÖO]', expect: { ids: [] } },

      { select: '#xml-nonascii-upper[FÖO]', expect: { ids: ['xml-nonascii-upper'] } },

      { select: '#xml-nonascii-upper[fÖo]', expect: { ids: ['xml-nonascii-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-nonascii-upper[fÖo]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-nonascii-upper[föo]', expect: { ids: [] } },

      // XML wildcard namespace still compares exact localName.
      { select: '#xml-nonascii-lower[*|föo]', expect: { ids: ['xml-nonascii-lower'] } },

      { select: '#xml-nonascii-lower[*|FöO]', expect: { ids: ['xml-nonascii-lower'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-nonascii-lower[*|FöO]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-nonascii-upper[*|FÖO]', expect: { ids: ['xml-nonascii-upper'] } },

      { select: '#xml-nonascii-upper[*|fÖo]', expect: { ids: ['xml-nonascii-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-nonascii-upper[*|fÖo]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },
    ],
  },

  {
    name: 'html namespace created element tag casing behavior',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="host"></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        const ns = 'http://www.w3.org/1999/xhtml';

        const mixed = document.createElementNS(ns, 'MiXeD');
        mixed.id = 'mixed-html-ns';

        const upper = document.createElementNS(ns, 'UPPER');
        upper.id = 'upper-html-ns';

        const lower = document.createElementNS(ns, 'lower');
        lower.id = 'lower-html-ns';

        host.append(mixed, upper, lower);
      });
    },
    cases: [
      // Native selector behavior: this is the important part.
      { select: 'mixed', expect: { ids: [] } },
      { select: 'MiXeD', expect: { ids: [] } },
      { select: 'upper', expect: { ids: [] } },
      { select: 'UPPER', expect: { ids: [] } },
      { select: 'lower', expect: { ids: ['lower-html-ns'] } },
      { select: 'LOWER', expect: { ids: ['lower-html-ns'] } },
      { select: 'LoWeR', expect: { ids: ['lower-html-ns'] } },

      { match: 'mixed', ref: { by: 'id', id: 'mixed-html-ns' }, expect: { count: 0 } },
      { match: 'MiXeD', ref: { by: 'id', id: 'mixed-html-ns' }, expect: { count: 0 } },
      { match: 'upper', ref: { by: 'id', id: 'upper-html-ns' }, expect: { count: 0 } },
      { match: 'UPPER', ref: { by: 'id', id: 'upper-html-ns' }, expect: { count: 0 } },

      // DOM helper behavior: this may or may not match selector behavior.
      { byTag: 'mixed', expect: { ids: [] } },
      { byTag: 'MiXeD', expect: { ids: [] } },
      { byTag: 'upper', expect: { ids: [] } },
      { byTag: 'UPPER', expect: { ids: [] } },
      { byTag: 'lower', expect: { ids: ['lower-html-ns'] } },
      { byTag: 'LOWER', expect: { ids: ['lower-html-ns'] } },

      { byTagNs: { ns: '*', local: 'mixed' }, expect: { ids: [] } },
      { byTagNs: { ns: '*', local: 'MiXeD' }, expect: { ids: ['mixed-html-ns'] } },
      { byTagNs: { ns: '*', local: 'upper' }, expect: { ids: [] } },
      { byTagNs: { ns: '*', local: 'UPPER' }, expect: { ids: ['upper-html-ns'] } },
      { byTagNs: { ns: '*', local: 'lower' }, expect: { ids: ['lower-html-ns'] } },
      { byTagNs: { ns: '*', local: 'LOWER' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'html type selector folding is ascii only',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="host"></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;

        // createElement in an HTML document ASCII-lowercases only A-Z.
        // So "FÖÖd" becomes localName "fÖÖd", not "fööd".
        const upperO = document.createElement('FÖÖd');
        upperO.id = 'upper-o-food';

        const lowerO = document.createElement('fööd');
        lowerO.id = 'lower-o-food';

        host.append(upperO, lowerO);
      });
    },
    cases: [
      // Controls.
      { select: 'fÖÖd', expect: { ids: ['upper-o-food'] } },
      { select: 'FÖÖd', expect: { ids: ['upper-o-food'] } },
      { select: 'fööd', expect: { ids: ['lower-o-food'] } },
      { select: 'Fööd', expect: { ids: ['lower-o-food'] } },

      // Unicode toLowerCase would produce "fööd" and can incorrectly seed/match lower-o-food.
      { select: 'FÖÖD', expect: { ids: ['upper-o-food'] } },

      { match: 'FÖÖD', ref: { by: 'id', id: 'upper-o-food' }, expect: { count: 1 } },
      { match: 'FÖÖD', ref: { by: 'id', id: 'lower-o-food' }, expect: { count: 0 } },

      // DOM namespace lookup is exact localName.
      { byTagNs: { ns: '*', local: 'fÖÖd' }, expect: { ids: ['upper-o-food'] } },
      { byTagNs: { ns: '*', local: 'fööd' }, expect: { ids: ['lower-o-food'] } },

      { byTag: 'fÖÖd', expect: { ids: ['upper-o-food'] } },
      { byTag: 'FÖÖd', expect: { ids: ['upper-o-food'] } },
      { byTag: 'fööd', expect: { ids: ['lower-o-food'] } },
      { byTag: 'Fööd', expect: { ids: ['lower-o-food'] } },
    ],
  },

  {
    name: 'mixed case tag seed union preserves document order',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html><body><div id="host"></div></body></html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        const xml = new DOMParser().parseFromString(`
          <root xmlns:dc="http://example/dc">
            <Foo id="x1"></Foo>
            <dc:Foo id="x3"></dc:Foo>
            <Foo id="x6"></Foo>
            <dc:Foo id="x8"></dc:Foo>
          </root>
        `, 'text/xml');

        const x1 = document.importNode(xml.documentElement.children[0], true);
        const x3 = document.importNode(xml.documentElement.children[1], true);
        const x6 = document.importNode(xml.documentElement.children[2], true);
        const x8 = document.importNode(xml.documentElement.children[3], true);

        const h2 = document.createElement('foo'); h2.id = 'h2';
        const h4 = document.createElement('FOO'); h4.id = 'h4';
        const skip = document.createElement('bar'); skip.id = 'skip';
        const h7 = document.createElement('FoO'); h7.id = 'h7';

        host.append(x1, h2, x3, h4, skip, x6, h7, x8);
      });
    },
    cases: [
      { select: 'Foo', expect: { ids: ['x1', 'h2', 'x3', 'h4', 'x6', 'h7', 'x8'] } },
      { select: '*|Foo', expect: { ids: ['x1', 'h2', 'x3', 'h4', 'x6', 'h7', 'x8'] } },
      { select: 'foo', expect: { ids: ['h2', 'h4', 'h7'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },
      { select: 'foo', expect: { ids: ['x1', 'h2', 'x3', 'h4', 'x6', 'h7', 'x8'] }, browsers: ['chromium'], engines: ['native'] },
    ],
  },

]);

