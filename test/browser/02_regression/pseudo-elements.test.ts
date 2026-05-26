import { runScenarios } from '../harness/scenarios';

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

]);

