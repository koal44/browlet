import { runScenarios } from '../../../scenario/dispatch';

runScenarios('attributes', 'normal', [
  {
    name: 'native attribute-name selector edge cases',
    // status: 'only',
    // browsers: ['webkit'],
    markup: `
      <div id="wrapper"></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const wrapper = document.getElementById('wrapper')!;

        const add = (id: string, attrs: Record<string, string>) => {
          const el = document.createElement('span');
          el.id = id;
          for (const [name, value] of Object.entries(attrs)) {
            el.setAttribute(name, value);
          }
          wrapper.appendChild(el);
        };

        add('plain-attr', { foo: 'yes' });
        add('hyphen-attr', { 'foo-bar': 'yes' });
        add('underscore-attr', { foo_bar: 'yes' });
        add('digit-attr', { foo123: 'yes' });
        // add('digit-start-attr', { '123': 'yes' }); // ff
        add('colon-attr', { 'foo:bar': 'yes' });
        // add('plus-attr', { 'foo+bar': 'yes' }); // ff
        add('non-ascii-attr', { föo: 'yes' });
        // add('unicode-attr', { 名前: 'yes' }); // chrome
      });
    },
    cases: [
      // Plain / normal-ish attribute names.
      { select: '[foo]', expect: { ids: ['plain-attr'] } },
      { select: '[foo-bar]', expect: { ids: ['hyphen-attr'] } },
      { select: '[foo_bar]', expect: { ids: ['underscore-attr'] } },
      { select: '[foo123]', expect: { ids: ['digit-attr'] } },

      // Digit-starting attribute names need CSS escaping.
      // { select: '[123]', expect: { throws: true } },
      // { select: '[\\31 23]', expect: { ids: ['digit-start-attr'] } },

      // Literal colon and plus in attribute names need CSS escaping.
      { select: '[foo:bar]', expect: { throws: true } },
      { select: '[foo\\:bar]', expect: { ids: ['colon-attr'] } },

      // { select: '[foo+bar]', expect: { throws: true } },
      // { select: '[foo\\+bar]', expect: { ids: ['plus-attr'] } },

      // Non-ASCII identifiers should work directly.
      // föo = f + U+00F6 + o
      { select: '[föo]', expect: { ids: ['non-ascii-attr'] } },
      { select: '[f\\F6 o]', expect: { ids: ['non-ascii-attr'] }, debug: false },

      // 名 = U+540D, 前 = U+524D
      // { select: '[名前]', expect: { ids: ['unicode-attr'] } },
      // { select: '[\\540D \\524D ]', expect: { ids: ['unicode-attr'] } },
    ],
  },

  {
    name: 'escaped colon attribute selector',
    // status: 'only',
    markup: `<div id="wrapper"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const wrapper = document.getElementById('wrapper')!;
        const el = document.createElement('span');
        el.id = 'colon-attr';
        el.setAttribute('foo:bar', 'yes');
        wrapper.appendChild(el);
      });
    },
    cases: [
      { select: '[foo:bar]', expect: { throws: true } },
      { select: '[foo\\:bar]', expect: { ids: ['colon-attr'] } },
    ],
  },

  {
    name: 'attribute namespace selectors on xml attributes',
    // status: 'only',
    // browsers: ['firefox'],
    markupMode: 'xml-document',
    markup: `
      <root id="myroot">
        <item id="xml-lang" xml:lang="en"/>
        <item id="plain-lang" lang="en"/>
        <item id="xml-space" xml:space="preserve"/>
        <item id="plain-other" other="x"/>
      </root>
    `,
    cases: [
      { select: '[lang]', expect: { ids: ['plain-lang'] } },
      { select: '[*|lang]', expect: { ids: ['xml-lang', 'plain-lang'] } },
      { select: '[|lang]', expect: { ids: ['plain-lang'] } },
      { select: '[*|l.ng]', expect: { throws: true } },
      { select: '[*|l\\.ng]', expect: { count: 0 } },
      { select: '[xml|lang]', expect: { throws: true } },

      // Chromium/Firefox throw; WebKit accepts this form.
      { select: '[*|*]', expect: { throws: true }, browsers: ['chromium', 'firefox'] },
      { select: '[*|*]', expect: { throws: false }, browsers: ['webkit'], status: 'fail' },

      { select: '[xml:lang]', expect: { throws: true } },
      { select: '[xml\\:lang]', expect: { ids: [] } },
    ],
  },

  {
    name: 'HTML attribute value case sensitivity',
    // status: 'only',
    markup: `
      <div id="root">
        <div id="align-upper" align="CENTER"></div>
        <div id="dir-upper" dir="RTL"></div>
        <p id="lang-upper" lang="EN-us"></p>
        <input id="type-upper" type="TEXT">
        <input id="checked-upper" checked="CHECKED">
        <button id="disabled-upper" disabled="DISABLED"></button>
        <option id="selected-upper" selected="SELECTED"></option>
        <a id="target-upper" target="_BLANK"></a>

        <div id="data-upper" data-mode="ON"></div>
        <div id="title-upper" title="HELLO"></div>
        <div id="role-upper" role="BUTTON"></div>
        <div id="class-upper" class="LOUD"></div>
      </div>
    `,
    cases: [
      // HTML attributes whose values are matched case-insensitively by default.
      { select: '[align="center"]',      expect: { ids: ['align-upper'] } },
      { select: '[dir="rtl"]',           expect: { ids: ['dir-upper'] } },
      { select: '[lang="en-us"]',        expect: { ids: ['lang-upper'] } },
      { select: '[type="text"]',         expect: { ids: ['type-upper'] } },
      { select: '[checked="checked"]',   expect: { ids: ['checked-upper'] } },
      { select: '[disabled="disabled"]', expect: { ids: ['disabled-upper'] } },
      { select: '[selected="selected"]', expect: { ids: ['selected-upper'] } },
      { select: '[target="_blank"]',     expect: { ids: ['target-upper'] } },

      // Ordinary/custom attribute values are case-sensitive by default.
      { select: '[data-mode="on"]', expect: { ids: [] } },
      { select: '[title="hello"]',  expect: { ids: [] } },
      { select: '[role="button"]',  expect: { ids: [] } },
      { select: '[class="loud"]',   expect: { ids: [] } },

      // Explicit i flag makes ordinary/custom attribute values case-insensitive.
      { select: '[data-mode="on" i]', expect: { ids: ['data-upper'] } },
      { select: '[title="hello" i]',  expect: { ids: ['title-upper'] } },
      { select: '[role="button" i]',  expect: { ids: ['role-upper'] } },
      { select: '[class="loud" i]',   expect: { ids: ['class-upper'] } },
    ],
  },

  {
    name: 'XML attribute value case sensitivity',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root id="root">
        <item id="align-upper" align="CENTER" />
        <item id="dir-upper" dir="RTL" />
        <item id="lang-upper" lang="EN-us" />
        <item id="type-upper" type="TEXT" />
        <item id="checked-upper" checked="CHECKED" />
        <item id="disabled-upper" disabled="DISABLED" />
        <item id="selected-upper" selected="SELECTED" />
        <item id="target-upper" target="_BLANK" />

        <item id="data-upper" data-mode="ON" />
        <item id="title-upper" title="HELLO" />
        <item id="role-upper" role="BUTTON" />
        <item id="class-upper" class="LOUD" />
      </root>
    `,
    cases: [
      // XML does not get HTML's default case-insensitive attribute value matching.
      { select: '[align="center"]',      expect: { ids: [] } },
      { select: '[dir="rtl"]',           expect: { ids: [] } },
      { select: '[lang="en-us"]',        expect: { ids: [] } },
      { select: '[type="text"]',         expect: { ids: [] } },
      { select: '[checked="checked"]',   expect: { ids: [] } },
      { select: '[disabled="disabled"]', expect: { ids: [] } },
      { select: '[selected="selected"]', expect: { ids: [] } },
      { select: '[target="_blank"]',     expect: { ids: [] } },

      // Ordinary/custom values are also case-sensitive by default.
      { select: '[data-mode="on"]', expect: { ids: [] } },
      { select: '[title="hello"]',  expect: { ids: [] } },
      { select: '[role="button"]',  expect: { ids: [] } },
      { select: '[class="loud"]',   expect: { ids: [] } },

      // Explicit i flag works in XML too.
      { select: '[align="center" i]', expect: { ids: ['align-upper'] } },
      { select: '[type="text" i]',    expect: { ids: ['type-upper'] } },
      { select: '[data-mode="on" i]', expect: { ids: ['data-upper'] } },
      { select: '[title="hello" i]',  expect: { ids: ['title-upper'] } },
    ],
  },

  {
    name: 'attribute value selectors do not match missing attributes as null',
    // status: 'only',
    markup: `
      <div>
        <span id="missing" class="x"></span>
      </div>

      <div data-value="null">
        <span id="real-null" class="x"></span>
      </div>

      <div data-value="n">
        <span id="starts-n" class="x"></span>
      </div>

      <div data-value="bell">
        <span id="ends-ll" class="x"></span>
      </div>

      <div data-value="sun">
        <span id="contains-u" class="x"></span>
      </div>
    `,
    cases: [
      // Missing attributes must not be coerced to the string "null".
      { select: '[data-value="null"] > .x', expect: { ids: ['real-null'] } },
      { select: '[data-value^="n"] > .x', expect: { ids: ['real-null', 'starts-n'] } },
      { select: '[data-value$="ll"] > .x', expect: { ids: ['real-null', 'ends-ll'] } },
      { select: '[data-value*="u"] > .x', expect: { ids: ['real-null', 'contains-u'] } },
    ],
  },

  {
    name: 'debug attribute ~= unquoted value',
    // status: 'only',
    markup: `
      <div id="father" class="brothers men"></div>
      <div id="uncle" class="brothers men"></div>
      <div id="son" class="men"></div>
    `,
    cases: [
      { select: 'div[class~=brothers]', expect: { ids: ['father', 'uncle'] }, debug: false },
    ],
  },

  {
    name: 'attribute existence namespace and casing',
    // status: 'only',
    // browsers: ['firefox'],
    // engines: ['native'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="html-host">
            <span id="html-lower" data-x="1" title="lower"></span>
            <span id="html-upper" DATA-X="1" TITLE="upper"></span>
            <span id="html-colon"></span>
            <svg id="svg-root" xmlns="http://www.w3.org/2000/svg">
              <g id="svg-lower" data-x="1" viewBox="0 0 1 1"></g>
              <g id="svg-upper" DATA-X="1" VIEWBOX="0 0 1 1"></g>
            </svg>
            <div id="svg-import-host"></div>
            <math id="math-root" xmlns="http://www.w3.org/1998/Math/MathML">
              <mi id="math-lower" data-x="1" mathvariant="bold">x</mi>
              <mi id="math-upper" DATA-X="1" MATHVARIANT="bold">y</mi>
            </math>
            <div id="import-host"></div>
          </div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        document.getElementById('html-colon')!.setAttribute('foo:bar', '1');

        const xml = `<?xml version="1.0"?>
          <root id="xml-root">
            <item id="xml-lower" data-x="1" lang="en" />
            <item id="xml-upper" DATA-X="1" LANG="en" />
            <item id="xml-ns-lang" xml:lang="en" />
            <item id="xml-both-lang" lang="en" xml:lang="en" />
          </root>`;

        const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
        document.getElementById('import-host')!.appendChild(
          document.importNode(xmlDoc.documentElement, true)
        );

        const svg = `<?xml version="1.0"?>
          <svg xmlns="http://www.w3.org/2000/svg">
            <g id="svg-import-lower" data-x="1" viewBox="0 0 1 1" />
            <g id="svg-import-upper" DATA-X="1" VIEWBOX="0 0 1 1" />
          </svg>`;

        const svgDoc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        document.getElementById('svg-import-host')!.appendChild(
          document.importNode(svgDoc.documentElement, true)
        );

      });
    },
    cases: [
      // Plain HTML attribute existence is ASCII case-insensitive.
      { select: '#html-host > span[data-x]', expect: { ids: ['html-lower', 'html-upper'] } },
      { select: '#html-host > span[DATA-X]', expect: { ids: ['html-lower', 'html-upper'] } },
      { select: '#html-host > span[title]',  expect: { ids: ['html-lower', 'html-upper'] } },
      { select: '#html-host > span[TITLE]',  expect: { ids: ['html-lower', 'html-upper'] } },

      // Escaped literal colon is an attribute name; unescaped colon is selector syntax and should throw.
      { select: '#html-colon[foo:bar]', expect: { throws: true } },
      { select: '#html-colon[foo\\:bar]', expect: { ids: ['html-colon'] } },

      // Imported XML attribute names remain case-sensitive.
      { select: '#xml-root > item[data-x]', expect: { ids: ['xml-lower', 'xml-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-root > item[data-x]', expect: { ids: ['xml-lower'] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-root > item[DATA-X]', expect: { ids: ['xml-lower', 'xml-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-root > item[DATA-X]', expect: { ids: ['xml-upper'] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-root > item[lang]',   expect: { ids: ['xml-lower', 'xml-upper', 'xml-both-lang'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-root > item[lang]',   expect: { ids: ['xml-lower', 'xml-both-lang'] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-root > item[LANG]',   expect: { ids: ['xml-lower', 'xml-upper', 'xml-both-lang'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-root > item[LANG]',   expect: { ids: ['xml-upper'] }, browsers: ['firefox', 'webkit'] },

      // Namespace existence:
      // [lang] / [|lang] are no-namespace only; [*|lang] also sees xml:lang.
      { select: '#xml-root > item[lang]',   expect: { ids: ['xml-lower', 'xml-upper', 'xml-both-lang'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-root > item[lang]',   expect: { ids: ['xml-lower', 'xml-both-lang'] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-root > item[|lang]',  expect: { ids: ['xml-lower', 'xml-upper', 'xml-both-lang'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-root > item[|lang]',  expect: { ids: ['xml-lower', 'xml-both-lang'] }, browsers: ['firefox', 'webkit'] },

      { select: '#xml-root > item[*|lang]', expect: { ids: ['xml-lower', 'xml-upper', 'xml-ns-lang', 'xml-both-lang'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#xml-root > item[*|lang]', expect: { ids: ['xml-lower', 'xml-ns-lang', 'xml-both-lang'] }, browsers: ['firefox', 'webkit'] },

      // SVG/MathML inside HTML: check whether attribute existence follows element-local casing.
      { select: '#svg-root > g[data-x]', expect: { ids: ['svg-lower', 'svg-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-root > g[data-x]', expect: { ids: ['svg-lower', 'svg-upper'] }, browsers: ['firefox', 'webkit'] },

      { select: '#svg-root > g[DATA-X]', expect: { ids: ['svg-lower', 'svg-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-root > g[DATA-X]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },

      { select: '#svg-root > g[viewBox]', expect: { ids: ['svg-lower', 'svg-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-root > g[viewBox]', expect: { ids: ['svg-lower', 'svg-upper'] }, browsers: ['firefox', 'webkit'] },

      { select: '#svg-root > g[VIEWBOX]', expect: { ids: ['svg-lower', 'svg-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-root > g[VIEWBOX]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },

      { select: '#math-root > mi[data-x]', expect: { ids: ['math-lower', 'math-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#math-root > mi[data-x]', expect: { ids: ['math-lower', 'math-upper'] }, browsers: ['firefox', 'webkit'] },

      { select: '#math-root > mi[DATA-X]', expect: { ids: ['math-lower', 'math-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#math-root > mi[DATA-X]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },

      { select: '#math-root > mi[mathvariant]', expect: { ids: ['math-lower', 'math-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#math-root > mi[mathvariant]', expect: { ids: ['math-lower', 'math-upper'] }, browsers: ['firefox', 'webkit'] },

      { select: '#math-root > mi[MATHVARIANT]', expect: { ids: ['math-lower', 'math-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#math-root > mi[MATHVARIANT]', expect: { ids: [] }, browsers: ['firefox', 'webkit'] },

      // Imported SVG parsed as XML/SVG: check whether it behaves like inline SVG or imported XML.
      { select: '#svg-import-host > svg > g[data-x]', expect: { ids: ['svg-import-lower', 'svg-import-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-import-host > svg > g[data-x]', expect: { ids: ['svg-import-lower'] }, browsers: ['firefox', 'webkit'] },

      { select: '#svg-import-host > svg > g[DATA-X]', expect: { ids: ['svg-import-lower', 'svg-import-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-import-host > svg > g[DATA-X]', expect: { ids: ['svg-import-upper'] }, browsers: ['firefox', 'webkit'] },

      { select: '#svg-import-host > svg > g[viewBox]', expect: { ids: ['svg-import-lower', 'svg-import-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-import-host > svg > g[viewBox]', expect: { ids: ['svg-import-lower'] }, browsers: ['firefox', 'webkit'] },

      { select: '#svg-import-host > svg > g[VIEWBOX]', expect: { ids: ['svg-import-lower', 'svg-import-upper'] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#svg-import-host > svg > g[VIEWBOX]', expect: { ids: ['svg-import-upper'] }, browsers: ['firefox', 'webkit'] },
    ],
  },

  {
    name: 'attribute operators with empty string values',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="root">
        <div id="empty" data-x=""></div>
        <div id="word" data-x="abc"></div>
        <div id="dash" data-x="abc-def"></div>
        <div id="space" data-x="abc def"></div>
        <div id="spaces" data-x="   "></div>
        <div id="missing"></div>
      </div>
    `,
    cases: [
      { select: '[data-x]', expect: { ids: ['empty', 'word', 'dash', 'space', 'spaces'] } },
      { select: '[data-x=""]', expect: { ids: ['empty'] } },
      { select: '[data-x^=""]', expect: { ids: [] } },
      { select: '[data-x$=""]', expect: { ids: [] } },
      { select: '[data-x*=""]', expect: { ids: [] } },
      { select: '[data-x|=""]', expect: { ids: ['empty'] } },
      { select: '[data-x~=""]', expect: { ids: [] } },
      { select: '#missing[data-x=""]', expect: { ids: [] } },
      { select: '#missing[data-x^=""]', expect: { ids: [] } },
      { select: '#missing[data-x$=""]', expect: { ids: [] } },
      { select: '#missing[data-x*=""]', expect: { ids: [] } },
      { select: '#missing[data-x|=""]', expect: { ids: [] } },
      { select: '#missing[data-x~=""]', expect: { ids: [] } },
      { select: '#empty[data-x^=""]', expect: { ids: [] } },
      { select: '#word[data-x^=""]', expect: { ids: [] } },
      { select: '#word[data-x$=""]', expect: { ids: [] } },
      { select: '#word[data-x*=""]', expect: { ids: [] } },
      { select: '#empty[data-x~=""]', expect: { ids: [] } },
      { select: '#spaces[data-x~=""]', expect: { ids: [] } },
    ],
  },

  {
    name: 'debug wildcard namespace value scans all same-local attrs',
    // status: 'only',
    browsers: ['chromium'],
    markup: `<div id="root"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const root = document.getElementById('root')!;
        root.textContent = '';

        const span = document.createElement('span');
        span.id = 'target';

        span.setAttribute('foo', 'x');
        span.setAttributeNS('a', 'foo', 'x');
        span.setAttributeNS('b', 'foo', 'BAR');
        span.setAttributeNS('c', 'foo', 'x');

        root.appendChild(span);
      });
    },
    cases: [
      {
        select: "[*|foo='bar' i]",
        ref: { by: 'id', id: 'root' },
        expect: { ids: ['target'] },
        // debug: true,
      },
    ],
  },

  {
    name: 'attribute dash-match astral prefix',
    // status: 'only',
    markup: `
      <div id="root">
        <div id="plain" data-x="abc"></div>
        <div id="dash" data-x="abc-def"></div>

        <div id="astral-exact" data-x="a😀b"></div>
        <div id="astral-dash" data-x="a😀b-c"></div>
        <div id="astral-wrong-continuation" data-x="a😀bc"></div>
        <div id="astral-different" data-x="a😃b-c"></div>

        <div id="leading-astral-exact" data-x="😀"></div>
        <div id="leading-astral-dash" data-x="😀-x"></div>
        <div id="leading-astral-wrong" data-x="😀x"></div>

        <div id="multi-astral-exact" data-x="𠮷😀z"></div>
        <div id="multi-astral-dash" data-x="𠮷😀z-tail"></div>
        <div id="multi-astral-wrong" data-x="𠮷😀ztail"></div>
      </div>
    `,
    cases: [
      // Baseline dash-match.
      { select: '[data-x|="abc"]', expect: { ids: ['plain', 'dash'] } },

      // Prefix contains an astral-plane character.
      { select: '[data-x|="a😀b"]', expect: { ids: ['astral-exact', 'astral-dash'] } },

      // Similar but different astral char should not match.
      { select: '[data-x|="a😃b"]', expect: { ids: ['astral-different'] } },

      // Prefix is only an astral-plane character.
      { select: '[data-x|="😀"]', expect: { ids: ['leading-astral-exact', 'leading-astral-dash'] } },

      // Multiple non-BMP chars before the dash.
      { select: '[data-x|="𠮷😀z"]', expect: { ids: ['multi-astral-exact', 'multi-astral-dash'] } },

      // Scoped non-matches make off-by-one/surrogate bugs obvious.
      { select: '#astral-wrong-continuation[data-x|="a😀b"]', expect: { ids: [] } },
      { select: '#leading-astral-wrong[data-x|="😀"]', expect: { ids: [] } },
      { select: '#multi-astral-wrong[data-x|="𠮷😀z"]', expect: { ids: [] } },
    ],
  },

  {
    name: 'attribute dash-match value semantics',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="root">
        <div id="exact" data-lang="en"></div>
        <div id="dash" data-lang="en-US"></div>
        <div id="wrong-continuation" data-lang="english"></div>
        <div id="wrong-prefix" data-lang="fr-US"></div>
        <div id="upper-exact" data-lang="EN"></div>
        <div id="upper-dash" data-lang="EN-us"></div>
        <div id="nonascii-lower" data-lang="föo-bar"></div>
        <div id="nonascii-upper" data-lang="FÖO-bar"></div>
        <div id="empty" data-lang=""></div>
        <div id="hyphen-only" data-lang="-"></div>
        <div id="missing"></div>
      </div>
    `,
    cases: [
      // Sensitive dash-match.
      { select: '[data-lang|="en"]', expect: { ids: ['exact', 'dash'] } },
      { select: '[data-lang|="EN"]', expect: { ids: ['upper-exact', 'upper-dash'] } },
      { select: '[data-lang|="e"]', expect: { ids: [] } },
      { select: '[data-lang|="fr"]', expect: { ids: ['wrong-prefix'] } },

      // Explicit i flag.
      { select: '[data-lang|="en" i]', expect: { ids: ['exact', 'dash', 'upper-exact', 'upper-dash'] } },
      { select: '[data-lang|="EN" i]', expect: { ids: ['exact', 'dash', 'upper-exact', 'upper-dash'] } },
      { select: '[data-lang|="e" i]', expect: { ids: [] } },

      // ASCII-only folding: Ö should not fold to ö.
      { select: '[data-lang|="föo" i]', expect: { ids: ['nonascii-lower'] } },
      { select: '[data-lang|="FöO" i]', expect: { ids: ['nonascii-lower'] } },
      { select: '[data-lang|="fÖo" i]', expect: { ids: ['nonascii-upper'] } },
      { select: '[data-lang|="FÖO" i]', expect: { ids: ['nonascii-upper'] } },

      { select: '[data-lang|=""]', expect: { ids: ['empty', 'hyphen-only'] } },
      { select: '[data-lang^=""]', expect: { ids: [] } },
      { select: '[data-lang$=""]', expect: { ids: [] } },
      { select: '[data-lang*=""]', expect: { ids: [] } },
      { select: '[data-lang~=""]', expect: { ids: [] } },

      // Missing attr never matches.
      { select: '#missing[data-lang|="en"]', expect: { ids: [] } },
      { select: '#missing[data-lang|="" ]', expect: { ids: [] } },
    ],
  },

  {
    name: 'attribute value i flag is ascii-only',
    // status: 'only',
    markup: `
      <div id="root">
        <div id="lower" data-x="föo"></div>
        <div id="upper" data-x="fÖo"></div>
      </div>
    `,
    cases: [
      { select: '[data-x="FöO" i]', expect: { ids: ['lower'] } },
      { select: '[data-x="FÖO" i]', expect: { ids: ['upper'] } },
      { select: '[data-x^="Fö" i]', expect: { ids: ['lower'] } },
      { select: '[data-x$="Öo" i]', expect: { ids: ['upper'] } },
    ],
  },

]);
