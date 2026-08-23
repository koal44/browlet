import { runScenarios } from '../../../scenario/dispatch';

runScenarios('pseudo-document-state', 'normal', [
  {
    name: 'linguistic pseudos basic behavior',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <div id="en" lang="en"></div>
      <div id="en-us" lang="en-US"></div>
      <div id="fr" lang="fr"></div>
      <div id="rtl" dir="rtl">abc</div>
      <div id="ltr" dir="ltr">abc</div>
    `,
    cases: [
      { select: 'div:lang(en)', expect: { ids: ['en', 'en-us'] } },
      { select: 'div:dir(rtl)', expect: { ids: ['rtl'] } },
      { select: 'div:dir(ltr)', expect: { ids: ['en', 'en-us', 'fr', 'ltr'] } },
      { select: 'div:dir(tlr)', expect: { ids: [] } },
    ],
  },

  {
    name: 'dir auto uses first strong character',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <div id="auto-ltr" dir="auto">abc אבג</div>
      <div id="auto-rtl" dir="auto">אבג abc</div>
    `,
    cases: [
      { select: '#auto-ltr:dir(ltr)', expect: { ids: ['auto-ltr'] } },
      { select: '#auto-ltr:dir(rtl)', expect: { count: 0 } },
      { select: '#auto-rtl:dir(rtl)', expect: { ids: ['auto-rtl'] } },
      { select: '#auto-rtl:dir(ltr)', expect: { count: 0 } },
    ],
  },

  {
    name: 'lang inherited subtags',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <section id="parent" lang="en-US">
        <div id="child"></div>
      </section>
    `,
    cases: [
      { select: '#child:lang(en)', expect: { ids: ['child'] } },
      { select: '#child:lang(en-US)', expect: { ids: ['child'] } },
    ],
  },

  {
    name: 'location pseudos link element coverage',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <head>
          <link id="link-el" rel="author" href="/author">
        </head>
        <body>
          <a id="a-el" href="#a">a</a>
          <map name="m">
            <area id="area-el" href="#area">
          </map>
          <abbr id="abbr-el" href="#fake">abbr</abbr>
        </body>
      </html>
    `,
    url: 'https://test.local/page',
    cases: [
      { select: ':any-link', expect: { ids: ['a-el', 'area-el'] } },
      { select: ':link', expect: { ids: ['a-el', 'area-el'] } },
      { select: 'abbr:any-link', expect: { count: 0 } },
      { select: 'abbr:link', expect: { count: 0 } },
    ],
  },

  {
    name: 'defined matches built-in elements and defined custom elements',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <div id="div-el"></div>
      <span id="span-el"></span>
      <x-later id="later-el"></x-later>
      <x-ready id="ready-el"></x-ready>
      <foo id="foo-el"></foo>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        customElements.define('x-ready', class extends HTMLElement {});
      });
    },
    cases: [
      { select: '#div-el:defined', expect: { ids: ['div-el'] } },
      { select: '#span-el:defined', expect: { ids: ['span-el'] } },
      { select: '#ready-el:defined', expect: { ids: ['ready-el'] } },
      { select: '#later-el:defined', expect: { ids: [] } },
      { select: '#foo-el:defined', expect: { ids: ['foo-el'] } },
    ],
  },

  {
    name: 'target matches raw fragment id',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-document',
    url: 'https://test.local/page',
    setupPage: async (page) => {
      await page.goto('https://test.local/page#a%20b');
    },
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="a b"></div>
          <div id="a%20b"></div>
        </body>
      </html>
    `,
    cases: [
      { select: ':target', expect: { ids: ['a%20b'] } },
    ],
  },

  {
    name: 'target basic id matching',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-document',
    url: 'https://test.local/page',
    setupPage: async (page) => {
      await page.goto('https://test.local/page#target');
    },
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="target"></div>
          <div id="other"></div>
        </body>
      </html>
    `,
    cases: [
      { select: ':target', expect: { ids: ['target'] } },
    ],
  },

  {
    name: 'defined in xml document',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'xml-document',
    markup: `
      <root>
        <foo id="foo"/>
        <x-later id="later"/>
      </root>
    `,
    cases: [
      { select: 'foo:defined', expect: { ids: ['foo'] } },
      { select: 'x-later:defined', expect: { ids: ['later'] } },
    ],
  },

  {
    name: 'visited is not exposed through selector matching',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <a id="a" href="/x">x</a>
      <abbr id="abbr" href="/fake">abbr</abbr>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        // (document.getElementById('a') as any).visited = true;
        // (document.getElementById('abbr') as any).visited = true;
      });
    },
    cases: [
      { select: ':visited', expect: { count: 0 } },
      { select: 'a:visited', expect: { count: 0 } },
      { select: 'abbr:visited', expect: { count: 0 } },
      { select: ':any-link', expect: { ids: ['a'] } },
    ],
  },

]);
