import { runScenarios } from '../../dispatch';

runScenarios('parser', 'normal', [
  {
    name: 'logical pseudo followed by functional pseudo',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="s1" class="a"></span>
        <span id="s2" class="b"></span>
        <span id="s3"></span>
        <span id="s4" class="a b"></span>
        <span id="s5" class="b"></span>
      </div>
    `,
    cases: [
      {
        select: ':is(:not(.a), .b):nth-child(2n+1)', ref: { by: 'id', id: 'root' },
        expect: { ids: ['s3', 's5'] },
        // debug: true,
      },
    ],
  },

  {
    name: 'malformed combinator placement rejects',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="child"></span>
      </div>
    `,
    cases: [
      { select: '> div', expect: { throws: true } },
      { select: 'div >> span', expect: { throws: true } },
      { select: 'div + > span', expect: { throws: true } },
    ],
  },

  {
    name: 'functional pseudo validation with namespace types and combinators',
    // status: 'only',
    markup: `
      <div id="root">
        <section id="card">
          <h1 id="title"></h1>
          <span id="badge" class="item"></span>
        </section>
        <div id="after" class="after"></div>
        <div id="tail" class="tail"></div>
      </div>
    `,
    cases: [
      // namespace type selectors inside functional pseudos
      { select: ':is(*|section)', expect: { ids: ['card'] } },
      { select: '#card > :is(*|h1)', expect: { ids: ['title'] } },
      { select: '#card:has(> *|h1)', expect: { ids: ['card'] } },
      { select: '#card:has(> *|span)', expect: { ids: ['card'] } },
      { select: '#card:has(> |span)', expect: { ids: [] } },

      // explicit combinators inside functional pseudos
      { select: '#card:has(> h1)', expect: { ids: ['card'] } },
      { select: '#card:has(>h1)', expect: { ids: ['card'] } },
      { select: '#card:has(+ .after)', expect: { ids: ['card'] } },
      { select: '#card:has(~ .tail)', expect: { ids: ['card'] } },
    ],
  },

  {
    name: 'missing functional pseudo closing paren',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="root">
        <div id="a" class="a"></div>
        <div id="b" class="b"></div>
      </div>
    `,
    cases: [
      { select: ':is(.a, .b)', expect: { ids: ['a', 'b'] } },

      // Missing final ')' on the functional pseudo.
      { select: ':is(.a, .b', expect: { throws: false, count: 2 } },

      // A few neighboring malformed forms for comparison.
      { select: ':not(.a', expect: { throws: false, count: 5 } },
      { select: ':where(.a, .b', expect: { throws: false, count: 2 } },
      { select: ':has(.a', expect: { throws: false, count: 3 } },
    ],
  },

  {
    name: 'parse-only autofill pseudos match nothing',
    // status: 'only',
    markup: `<input id="x" autocomplete="email" value="a@b.com">`,
    cases: [
      { select: '#x:autofill', expect: { ids: [] } },
      { select: '#x:-webkit-autofill', expect: { ids: [] } },
    ],
  },

  {
    name: 'unknown pseudo extension throws',
    // status: 'only',
    markup: `<div id="x"></div>`,
    cases: [
      { select: '#x:unknown-ext', expect: { throws: true } },
    ],
  },

  {
    name: 'forgiving is where ignore invalid pseudo arms',
    // status: 'only',
    markup: `<div id="a" class="a"></div><div id="b" class="b"></div><div id="c"></div>`,
    cases: [
      { select: ':is(.a, :bogus-pseudo, .b)', expect: { ids: ['a', 'b'] } },
      { select: ':where(.a, :bogus-pseudo, .b)', expect: { ids: ['a', 'b'] } },
      { select: ':is(:bogus-pseudo)', expect: { ids: [] } },
      { select: ':where(:bogus-pseudo)', expect: { ids: [] } },
    ],
  },

  {
    name: 'unknown pseudo outside forgiving selector throws',
    // status: 'only',
    markup: `<div id="a"></div>`,
    cases: [
      { select: ':bogus-pseudo', expect: { throws: true } },
      { select: 'div:bogus-pseudo', expect: { throws: true } },
    ],
  },

  {
    name: 'forgiving is with only invalid arms matches nothing',
    // status: 'only',
    markup: `<div id="a"></div>`,
    cases: [
      { select: ':is(:bogus-pseudo)', expect: { ids: [] } },
      { select: ':where(:bogus-pseudo)', expect: { ids: [] } },
    ],
  },

  {
    name: 'forgiving is treats unterminated attribute arm as invalid through list end',
    // status: 'only',
    markup: `<div id="a" class="a"></div><div id="b" class="b"></div><div id="c" class="c"></div>`,
    cases: [
      { select: ':is(.a, [broken, .b)', expect: { ids: ['a'] } },
      { select: ':is(.a, [broken, .b, .c)', expect: { ids: ['a'] } },
      { select: ':is(.a, [broken], .b)', expect: { ids: ['a', 'b'] } },
      { select: ':is(.a, [broken, .b], .c)', expect: { ids: ['a', 'c'] } },
      { select: ':is([broken, .b)', expect: { ids: [] } },
      { select: ':is(.a, [broken, .b), .b', expect: { ids: ['a'] } },
      { select: ':is(.a', expect: { ids: ['a'] } },

      { select: ':is([broken.a)', expect: { ids: [] } },
      { select: ':is([broken.a', expect: { ids: [] } },
      { select: ':is(.a [broken)', expect: { ids: [] } },
      { select: ':is(.a, .b [broken)', expect: { ids: ['a'] } },
      { select: ':is(.a, .b', expect: { ids: ['a', 'b'] } },
      { select: ':is(.a, [broken, .b], .c)', expect: { ids: ['a', 'c'] } },
    ],
  },

  {
    name: 'invalid unexpected selector tokens throw',
    // status: 'only',
    markup: `<div id="a"></div>`,
    cases: [
      { select: '#a@foo', expect: { throws: true } },
      { select: '#a`foo', expect: { throws: true } },
    ],
  },

  {
    name: 'parser/html-namespace-selector-oracle',
    // status: 'only',
    markup: `
      <div id="root">
        <item id="html-item"></item>
        <p id="p"></p>
        <div id="a" class="a"></div>
        <div id="b" class="b"></div>
        <div id="scope" data-nwsapi-scope>
          <item id="scoped-item"></item>
          <p id="scoped-p"></p>
        </div>
        <a id="link" href="#x" class="enabled selected"></a>
      </div>
    `,
    cases: [
      { select: '*|p', expect: { ids: ['p', 'scoped-p'] } },
      { select: '|p', expect: { count: 0 } },
      { select: 'test|p', expect: { throws: true } },

      { select: ':scope > *|item', ref: { by: 'id', id: 'scope' }, expect: { ids: ['scoped-item'] } },
      { select: '[data-nwsapi-scope] > *|item', expect: { ids: ['scoped-item'] } },
      { select: '[data-nwsapi-scope] > |item', expect: { count: 0 } },

      { select: ':is(*|item)', expect: { ids: ['html-item', 'scoped-item'] } },
      { select: ':is(|item)', expect: { count: 0 } },
      { select: ':is(test|item)', expect: { count: 0 } },
      { select: ':is(*|item, |item, test|item)', expect: { ids: ['html-item', 'scoped-item'] } },

      { select: ':where(*|item)', expect: { ids: ['html-item', 'scoped-item'] } },
      { select: ':where(|item)', expect: { count: 0 } },
      { select: ':where(test|item)', expect: { count: 0 } },
      { select: ':where(*|item, |item, test|item)', expect: { ids: ['html-item', 'scoped-item'] } },

      { select: ':has(> *|item)', expect: { ids: ['root', 'scope'] } },
      { select: ':has(> |item)', expect: { ids: [] } },
      { select: ':has(> test|item)', expect: { throws: true } },
      { select: ':has(> *|item, + |item)', expect: { ids: ['root', 'scope'] } },
      { select: ':has(> *|item, > test|item)', expect: { throws: true } },

      { select: "[foo|='bar' i]", expect: { count: 0 } },
      { select: "[|foo='bar' i]", expect: { count: 0 } },
      { select: "[*|foo='bar' i]", expect: { count: 0 } },
      { select: '[*|href]', expect: { ids: ['link'] } },
      { select: '[|href]', expect: { ids: ['link'] } },
      { select: '[xlink|href]', expect: { throws: true } },
      { select: '[xml|lang]', expect: { throws: true } },

      { select: '[*|*]', expect: { throws: true }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
      { select: '[*|*]', expect: { throws: false }, browsers: ['webkit'], engines: ['native'] },
      { select: '[|*]', expect: { throws: true }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
      { select: '[|*]', expect: { throws: false }, browsers: ['webkit'], engines: ['native'] },
    ],
  },

  {
    name: 'parser/xml-namespace-selector-oracle',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root id="root">
        <item id="plain-item"/>
        <p id="plain-p"/>
        <a id="a" class="a"/>
        <b id="b" class="b"/>
        <scope id="scope" data-nwsapi-scope="">
          <item id="scoped-item"/>
          <p id="scoped-p"/>
        </scope>
        <link id="link" href="#x" class="enabled selected"/>
      </root>
    `,
    cases: [
      { select: '*|p', expect: { ids: ['plain-p', 'scoped-p'] } },
      { select: '|p', expect: { ids: ['plain-p', 'scoped-p'] } },
      { select: 'test|p', expect: { throws: true } },

      { select: ':scope > *|item', ref: { by: 'id', id: 'scope' }, expect: { ids: ['scoped-item'] } },
      { select: '[data-nwsapi-scope] > *|item', expect: { ids: ['scoped-item'] } },
      { select: '[data-nwsapi-scope] > |item', expect: { ids: ['scoped-item'] } },

      { select: ':is(*|item)', expect: { ids: ['plain-item', 'scoped-item'] } },
      { select: ':is(|item)', expect: { ids: ['plain-item', 'scoped-item'] } },
      { select: ':is(test|item)', expect: { count: 0 } },
      { select: ':is(*|item, |item, test|item)', expect: { ids: ['plain-item', 'scoped-item'] } },

      { select: ':where(*|item)', expect: { ids: ['plain-item', 'scoped-item'] } },
      { select: ':where(|item)', expect: { ids: ['plain-item', 'scoped-item'] } },
      { select: ':where(test|item)', expect: { count: 0 } },
      { select: ':where(*|item, |item, test|item)', expect: { ids: ['plain-item', 'scoped-item'] } },

      { select: ':has(> *|item)', expect: { ids: ['root', 'scope'] } },
      { select: ':has(> |item)', expect: { ids: ['root', 'scope'] } },
      { select: ':has(> test|item)', expect: { throws: true } },
      { select: ':has(> *|item, + |item)', expect: { ids: ['root', 'scope'] } },
      { select: ':has(> *|item, > test|item)', expect: { throws: true } },

      { select: "[foo|='bar' i]", expect: { count: 0 } },
      { select: "[|foo='bar' i]", expect: { count: 0 } },
      { select: "[*|foo='bar' i]", expect: { count: 0 } },
      { select: '[*|href]', expect: { ids: ['link'] } },
      { select: '[|href]', expect: { ids: ['link'] } },
      { select: '[xlink|href]', expect: { throws: true } },
      { select: '[xml|lang]', expect: { throws: true } },

      { select: '[*|*]', expect: { throws: true }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
      { select: '[*|*]', expect: { throws: false }, browsers: ['webkit'], engines: ['native'] },
      { select: '[|*]', expect: { throws: true }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
      { select: '[|*]', expect: { throws: false }, browsers: ['webkit'], engines: ['native'] },
    ],
  },

  {
    name: 'escaped literal backslash identifier',
    // status: 'only',
    markup: `
      <div>
        <span id="slash\\" class="slash\\"></span>
        <span id="slash�" class="slash�"></span>
      </div>`,
    cases: [
      // Two CSS backslashes: first escapes second, producing a literal "\".
      { select: '#slash\\\\', expect: { count: 1, ids: ['slash\\'] } },
      { select: '.slash\\\\', expect: { count: 1, ids: ['slash\\'] } },

      // One trailing CSS backslash is EOF escape -> U+FFFD, not literal "\".
      { select: '#slash\\', expect: { count: 1, ids: ['slash�'] } },
      { select: '.slash\\', expect: { count: 1, ids: ['slash�'] } },
    ],
  },

  {
    name: 'parser/attribute-string-eof',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta id="expected" charset="utf-8">
        </head>
        <body></body>
      </html>
    `,
    cases: [
      { select: 'meta[charset="utf-8"', expect: { ids: ['expected'] } },
      { select: 'meta[charset="utf-8', expect: { ids: ['expected'] } },
    ],
  },

]);
