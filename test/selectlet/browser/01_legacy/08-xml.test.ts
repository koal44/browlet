import { runScenarios } from '../../dispatch';

runScenarios('xml', 'normal', [
  {
    name: 'jsdom/svg-test',
    // status: 'only',
    markup: `
      <!doctype html>
      <html>
      <svg xlink:href="foo"></svg>
      </html>
    `,
    markupMode: 'html-document',
    cases: [
      { select: '[*|href]', expect: { count: 1 } },
      { select: '[|href]', expect: { count: 0 } },
      { select: '[xlink:href=foo]', expect: { throws: true } },
      { select: '[*|href="foo"]', expect: { count: 1 } },
      { select: '[xlink\\:href=foo]', expect: { count: 0 } },
    ],
  },

  {
    name: 'jsdom/svg-test in xml mode',
    // status: 'only',
    markup: `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
        <body>
          <svg xmlns="http://www.w3.org/2000/svg" xlink:href="foo" />
        </body>
      </html>
    `,
    markupMode: 'xml-document',
    cases: [
      { select: '[*|href]', expect: { count: 1 } },
      { select: '[xlink:href=foo]', expect: { throws: true } },
      { select: '[xlink|href=foo]', expect: { throws: true } },
      { select: '[xlink|href="foo"]', expect: { throws: true } },
      { select: '[*|href="foo"]', expect: { count: 1 } },
      { select: '[xlink\\:href=foo]', expect: { count: 0 } },
    ],
  },

  {
    name: 'jsdom/xml-import-test',
    // status: 'only',
    // browsers: ['chromium'],
    // engines: ['native'],
    markup: `<div id="host"></div>`,
    setupPage: async (page) => { await page.evaluate(() => {
      const parser = new DOMParser();
      const xml = `<?xml version="1.0"?>
        <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title></dc:title>
          <dc:div></dc:div>
        </cp:coreProperties>`;
      const dom = parser.parseFromString(xml, 'text/xml');
      document.getElementById('host')!.appendChild(document.importNode(dom.documentElement, true));
    }); },
    cases: [
      { select: 'coreProperties', ref: { by: 'id', id: 'host' }, expect: { count: 1 }, debug: false },
      { select: '*|coreProperties', ref: { by: 'id', id: 'host' }, expect: { count: 1 }, debug: false },
      { select: '|coreProperties', ref: { by: 'id', id: 'host' }, expect: { count: 0 } },
      { select: 'title', ref: { by: 'id', id: 'host' }, expect: { count: 1 }, debug: false },
      { select: '*|div', ref: { by: 'id', id: 'host' }, expect: { count: 1 }, debug: false },
    ],
  },

  {
    name: 'jsdom/xml-import-test 2',
    // status: 'only',
    browsers: ['chromium'],
    // engines: ['native'],
    markup: `<?xml version="1.0"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title></dc:title>
      </cp:coreProperties>`,
    markupMode: 'xml-document',
    cases: [
      { select: 'coreProperties', expect: { count: 1 } },
      { select: '*|coreProperties', expect: { count: 1 } },
      { select: '|coreProperties', expect: { count: 0 } },
    ],
  },

  {
    name: 'jsdom/xml-markup-mode',
    // status: 'only',
    markup: `<?xml version="1.0"?>
      <cp:coreProperties
          xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
          xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title></dc:title>
      </cp:coreProperties>`,
    markupMode: 'xml-document',
    cases: [
      { select: 'coreProperties', expect: { count: 1 } },
      { select: '*|coreProperties', expect: { count: 1 } },
      { select: '|coreProperties', expect: { count: 0 } },
    ],
  },

  {
    name: 'xml-import-case-insensitivity',
    // status: 'only',
    // engines: ['native'],
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const xml = `<?xml version="1.0"?><Foo><bar></bar></Foo>`;
        const dom = new DOMParser().parseFromString(xml, 'text/xml');
        document.getElementById('host')!.appendChild(
          document.importNode(dom.documentElement, true)
        );
      });
    },
    cases: [
      { select: 'Foo', ref: { by: 'id', id: 'host' }, expect: { count: 1 } },

      { select: 'foo', ref: { by: 'id', id: 'host' }, expect: { count: 1 }, browsers: ['chromium'], engines: ['native'] },
      { select: 'foo', ref: { by: 'id', id: 'host' }, expect: { count: 0 }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet']  },

      { select: 'bar', ref: { by: 'id', id: 'host' }, expect: { count: 1 } },

      { select: 'Bar', ref: { by: 'id', id: 'host' }, expect: { count: 1 }, browsers: ['chromium'], engines: ['native'] },
      { select: 'Bar', ref: { by: 'id', id: 'host' }, expect: { count: 0 }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet']  },
    ],
  },

  {
    name: 'xml-markup-mode-case-sensitivity',
    markupMode: 'xml-document',
    markup: `
      <root>
        <upper id="upper">
          <Foo><bar></bar></Foo>
        </upper>
        <lower id="lower">
          <foo><bar /></foo>
        </lower>
      </root>`,
    cases: [
      // upper: <Foo><bar/></Foo>
      { select: 'Foo', ref: { by: 'id', id: 'upper' }, expect: { count: 1 } },
      { select: 'foo', ref: { by: 'id', id: 'upper' }, expect: { count: 0 } },
      { select: 'bar', ref: { by: 'id', id: 'upper' }, expect: { count: 1 } },
      { select: 'Foo bar', ref: { by: 'id', id: 'upper' }, expect: { count: 1 } },
      { select: 'foo bar', ref: { by: 'id', id: 'upper' }, expect: { count: 0 } },

      // lower: <foo><bar/></foo>
      { select: 'foo', ref: { by: 'id', id: 'lower' }, expect: { count: 1 } },
      { select: 'Foo', ref: { by: 'id', id: 'lower' }, expect: { count: 0 } },
      { select: 'bar', ref: { by: 'id', id: 'lower' }, expect: { count: 1 } },
      { select: 'Bar', ref: { by: 'id', id: 'lower' }, expect: { count: 0 } },
      { select: '#lower foo bar', expect: { count: 1 } },
      { select: '#lower Foo bar', expect: { count: 0 } },
      { select: '#lower FOO bar', expect: { count: 0 } },
      { select: '#lower foo BAR', expect: { count: 0 } },
      { select: '#lower FOO BAR', expect: { count: 0 } },
    ],
  },

]);
