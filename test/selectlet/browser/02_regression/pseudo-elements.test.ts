import { runScenarios } from '../../dispatch';

runScenarios('pseudo-elements', 'normal', [
  {
    name: 'pseudo element legacy single colon generated content matches nothing',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <head>
          <style>
            #x:before { content: "before"; display: inline; }
            #x:after { content: "after"; display: inline; }
          </style>
        </head>
        <body>
          <div id="x">text</div>
        </body>
      </html>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const x = document.getElementById('x')!;
        const before = getComputedStyle(x, '::before').content;
        const after = getComputedStyle(x, '::after').content;

        if (before !== '"before"') throw new Error(`expected ::before content, got ${before}`);
        if (after !== '"after"') throw new Error(`expected ::after content, got ${after}`);
      });
    },
    cases: [
      { select: '#x:before', expect: { ids: [] } },
      { select: '#x:after', expect: { ids: [] } },
      { select: 'div:before', expect: { ids: [] } },
      { select: 'div:after', expect: { ids: [] } },
    ],
  },

  {
    name: 'pseudo element double colon generated content matches nothing',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <head>
          <style>
            #x::before { content: "before"; display: inline; }
            #x::after { content: "after"; display: inline; }
          </style>
        </head>
        <body>
          <div id="x">text</div>
        </body>
      </html>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const x = document.getElementById('x')!;
        const before = getComputedStyle(x, '::before').content;
        const after = getComputedStyle(x, '::after').content;

        if (before !== '"before"') throw new Error(`expected ::before content, got ${before}`);
        if (after !== '"after"') throw new Error(`expected ::after content, got ${after}`);
      });
    },
    cases: [
      { select: '#x::before', expect: { ids: [] } },
      { select: '#x::after', expect: { ids: [] } },
      { select: 'div::before', expect: { ids: [] } },
      { select: 'div::after', expect: { ids: [] } },
    ],
  },

  {
    name: 'pseudo element legacy single colon first letter and line match nothing',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <head>
          <style>
            #x:first-letter { font-size: 40px; }
            #x:first-line { text-transform: uppercase; }
          </style>
        </head>
        <body>
          <p id="x">hello world</p>
        </body>
      </html>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const x = document.getElementById('x')!;
        const firstLetterSize = getComputedStyle(x, '::first-letter').fontSize;
        const firstLineTransform = getComputedStyle(x, '::first-line').textTransform;

        if (firstLetterSize !== '40px') throw new Error(`expected ::first-letter font-size, got ${firstLetterSize}`);
        if (firstLineTransform !== 'uppercase') throw new Error(`expected ::first-line transform, got ${firstLineTransform}`);
      });
    },
    cases: [
      { select: '#x:first-letter', expect: { ids: [] } },
      { select: '#x:first-line', expect: { ids: [] } },
    ],
  },

  {
    name: '::part() DOM selector API behavior',
    // status: 'only',
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <div id="inner" part="foo bar">
            <span id="child" part="child"></span>
          </div>
        `;
      });
    },
    cases: [
      // Chromium/WebKit/selectlet treat ::part() as a pseudo-element, not a real Element result.
      { select: '::part(foo)', browsers: ['chromium', 'webkit'], engines: ['native', 'selectlet'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { match: '::part(foo)', browsers: ['chromium', 'webkit'], engines: ['native', 'selectlet'], ref: { by: 'id', id: 'inner', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },

      // Firefox native currently exposes bare ::part(foo) inside the shadow tree as the part-bearing element.
      { select: '::part(foo)', browsers: ['firefox'], engines: ['native'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
      { match: '::part(foo)', browsers: ['firefox'], engines: ['native'], ref: { by: 'id', id: 'inner', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['inner'] } },

      // A host-originating ::part() selector still does not match the host itself.
      { match: '#host::part(foo)', ref: { by: 'id', id: 'host' }, expect: { ids: [] } },

      // The part attribute itself is ordinary selector machinery inside the shadow tree.
      { select: '[part~="foo"]', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
      { match: '[part~="foo"]', ref: { by: 'id', id: 'inner', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['inner'] } },

      // ::part() remains pseudo-element-only even for multiple names;
      // [part] is the real element-facing selector path.
      { select: '::part(foo bar)', browsers: ['chromium', 'webkit'], engines: ['native', 'selectlet'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: '[part~="foo"][part~="bar"]', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
    ],
  },

]);

