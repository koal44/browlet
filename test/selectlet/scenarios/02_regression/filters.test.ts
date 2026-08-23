import { runScenarios } from '../../../scenario/dispatch';

runScenarios('filters', 'normal', [
  {
    name: 'escaped ID selector values in compiled ancestor filter',
    // status: 'only',
    markup: `
      <div id="foo.bar">
        <span id="dot" class="x"></span>
      </div>

      <div id="foo+bar">
        <span id="plus" class="x"></span>
      </div>

      <div id="foo[bar]">
        <span id="bracket" class="x"></span>
      </div>

      <div id="foo\\bar">
        <span id="backslash" class="x"></span>
      </div>

      <div id="123">
        <span id="digit" class="x"></span>
      </div>

      <div id="é">
        <span id="unicode" class="x"></span>
      </div>

      <div id="foo&#10;bar">
        <span id="newline" class="x"></span>
      </div>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the escaped ID is checked by the compiled ancestor filter.
      { select: '#foo.bar > .x', expect: { ids: [] } },
      { select: '#foo\\.bar > .x', expect: { ids: ['dot'] } },
      { select: '#foo\\+bar > .x', expect: { ids: ['plus'] } },
      { select: '#foo\\[bar\\] > .x', expect: { ids: ['bracket'] } },
      { select: '#foo\\\\bar > .x', expect: { ids: ['backslash'] } },
      { select: '#\\31 23 > .x', expect: { ids: ['digit'] } },
      { select: '#\\e9 > .x', expect: { ids: ['unicode'] } },
      { select: '#foo\\a bar > .x', expect: { ids: ['newline'] } },
    ],
  },

  {
    name: 'class seed rejects whitespace after CSS unescape',
    // status: 'only',
    markup: `<div id="root"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const root = document.getElementById('root')!;
        const el = document.createElement('div');
        el.id = 'newline-class';
        el.setAttribute('class', 'foo\nbar');
        root.appendChild(el);
      });
    },
    cases: [
      // .foo\a bar decodes to the class query "foo\nbar", but selector class
      // matching is token-based. getElementsByClassName has different behavior,
      // so the optimizer must not use it for decoded whitespace class names.
      { select: '.foo\\a bar', expect: { ids: [] } },
      { select: '.foo\nbar', expect:   { ids: [] } },
      { byClass: 'foo\nbar', expect:   { ids: ['newline-class'] } },
    ],
  },

  {
    name: 'escaped class selector values in compiled ancestor filter',
    // status: 'only',
    markup: `
      <div class="foo.bar">
        <span id="dot" class="x"></span>
      </div>

      <div class="foo+bar">
        <span id="plus" class="x"></span>
      </div>

      <div class="foo[bar]">
        <span id="bracket" class="x"></span>
      </div>

      <div class="foo\\bar">
        <span id="backslash" class="x"></span>
      </div>

      <div class="123">
        <span id="digit" class="x"></span>
      </div>

      <div class="é">
        <span id="unicode" class="x"></span>
      </div>

      <div class="foo&#10;bar">
        <span id="newline" class="x"></span>
      </div>

      <div class="alpha foo.bar omega">
        <span id="multi" class="x"></span>
      </div>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the escaped class selector is
      // checked by the compiled ancestor filter.
      { select: '.foo\\.bar > .x',    expect: { ids: ['dot', 'multi'] } },
      { select: '.foo\\+bar > .x',    expect: { ids: ['plus'] } },
      { select: '.foo\\[bar\\] > .x', expect: { ids: ['bracket'] } },
      { select: '.foo\\\\bar > .x',   expect: { ids: ['backslash'] } },
      { select: '.\\31 23 > .x',      expect: { ids: ['digit'] } },
      { select: '.\\e9 > .x',         expect: { ids: ['unicode'] } },

      // The decoded class fragment contains LF, so it cannot be one class token.
      { select: '.foo\\a bar > .x',   expect: { ids: [] } },
    ],
  },

  {
    name: 'compiled class filter does not match missing class attribute as null',
    // status: 'only',
    markup: `
      <div>
        <span id="missing-class" class="x"></span>
      </div>

      <div class="null">
        <span id="real-null-class" class="x"></span>
      </div>
    `,
    cases: [
      // The rightmost .x is the optimized seed; .null is checked by the compiled
      // ancestor filter. Missing class must not be coerced to the string "null".
      { select: '.null > .x', expect: { ids: ['real-null-class'] } },
    ],
  },

  {
    name: 'compiled class filter treats dot as class separator unless escaped',
    // status: 'only',
    markup: `
      <div class="foo.bar">
        <span id="literal-dot" class="x"></span>
      </div>

      <div class="foo bar">
        <span id="compound" class="x"></span>
      </div>
    `,
    cases: [
      { select: '.foo.bar > .x', expect: { ids: ['compound'] } },
      { select: '.foo\\.bar > .x', expect: { ids: ['literal-dot'] } },
    ],
  },

  {
    name: 'compiled class filter is case-sensitive in standards mode',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div class="LOUD">
            <span id="upper" class="x"></span>
          </div>
          <div class="loud">
            <span id="lower" class="x"></span>
          </div>
        </body>
      </html>
    `,
    cases: [
      { select: '.loud > .x', expect: { ids: ['lower'] } },
    ],
  },

  {
    name: 'compiled class filter is case-insensitive in quirks mode',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <html>
        <body>
          <div class="LOUD">
            <span id="upper" class="x"></span>
          </div>
          <div class="loud">
            <span id="lower" class="x"></span>
          </div>
        </body>
      </html>
    `,
    cases: [
      { select: '.loud > .x', expect: { ids: ['upper', 'lower'] } },
    ],
  },

  {
    name: 'HTML tag selector values in compiled ancestor filter',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div>
            <span id="div-lower" class="x"></span>
          </div>

          <x-foo>
            <span id="custom-lower" class="x"></span>
          </x-foo>
        </body>
      </html>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the tag selector is checked by
      // the compiled ancestor filter.
      { select: 'div > .x', expect: { ids: ['div-lower'] } },
      { select: 'DIV > .x', expect: { ids: ['div-lower'] } },
      { select: 'd\\69v > .x', expect: { ids: ['div-lower'] } },

      { select: 'x-foo > .x', expect: { ids: ['custom-lower'] } },
      { select: 'X-FOO > .x', expect: { ids: ['custom-lower'] } },
      { select: 'x\\-foo > .x', expect: { ids: ['custom-lower'] } },
    ],
  },

  {
    name: 'XML tag selector values in compiled ancestor filter',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root>
        <Item>
          <child id="upper-item" class="x" />
        </Item>

        <item>
          <child id="lower-item" class="x" />
        </item>
      </root>
    `,
    cases: [
      // XML tag selectors are case-sensitive.
      { select: 'Item > .x', expect: { ids: ['upper-item'] } },
      { select: 'item > .x', expect: { ids: ['lower-item'] } },
      { select: 'ITEM > .x', expect: { ids: [] } },

      // Escaped CSS identifier spelling should decode before comparison.
      { select: 'It\\65m > .x', expect: { ids: ['upper-item'] } },
      { select: 'it\\65m > .x', expect: { ids: ['lower-item'] } },
    ],
  },

  {
    name: 'escaped leading XML tag selector in compiled ancestor filter',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root>
        <Item>
          <child id="upper-item" class="x" />
        </Item>
        <item>
          <child id="lower-item" class="x" />
        </item>
      </root>
    `,
    cases: [
      // \49 is "I"; XML remains case-sensitive.
      { select: '\\49 tem > .x', expect: { ids: ['upper-item'] } },
      { select: '\\69 tem > .x', expect: { ids: ['lower-item'] } },
    ],
  },

  {
    name: 'namespace selectors in compiled ancestor filter',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <test:root xmlns:test="http://example/test">
        <test:item>
          <child id="namespaced" class="x" />
        </test:item>

        <item>
          <child id="plain" class="x" />
        </item>

        <t:item xmlns:t="http://example/test">
          <child id="non-root-prefix" class="x" />
        </t:item>
      </test:root>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the namespace/local-name selector
      // is checked by the compiled ancestor filter.
      { select: '*|item > .x', expect: { ids: ['namespaced', 'plain', 'non-root-prefix'] } },
      { select: '|item > .x', expect: { ids: ['plain'] } },
      { select: 'test|item > .x', expect: { throws: true } },
      { select: 'te\\73t|item > .x', expect: { throws: true } },

      // Escaped local names are handled by the tag resolver after the namespace part.
      { select: '*|it\\65m > .x', expect: { ids: ['namespaced', 'plain', 'non-root-prefix'] } },
      { select: '|it\\65m > .x', expect: { ids: ['plain'] } },

      // DOM querySelectorAll does not provide a namespace resolver, so named
      // namespace prefixes are invalid even when declared in the XML document.
      { select: 't|item > .x', expect: { throws: true } },
      { select: '\\74|item > .x', expect: { throws: true } },
    ],
  },

  {
    name: 'class escaped whitespace is not one class token',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="a" class="foo bar"></div>
      <div id="b"></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        document.getElementById('b')!.setAttribute('class', 'foo\nbar');
      });
    },
    cases: [
      { select: '.foo ', expect: { count: 2 } },
      { select: '.foo\\ ', expect: { count: 0 } },
      { select: '.foo\\a bar', expect: { count: 0 } },
      { match: '.foo\\a bar', ref: { by: 'id', id: 'a' }, expect: { count: 0 } },
      { match: '.foo\\a bar', ref: { by: 'id', id: 'b' }, expect: { count: 0 } },
    ],
  },

  {
    name: 'parser/class-selector-escaped-whitespace-oracle',
    // status: 'only',
    markup: `
      <div id="plain" class="foo bar"></div>
      <div id="space-token" class="foo&#10;bar"></div>
      <div id="literal-backslash" class="foo\\ bar"></div>
      <div id="literal-a" class="foo\\a bar"></div>
    `,
    cases: [
      { select: '.foo', expect: { ids: ['plain', 'space-token'] } },
      { select: '.bar', expect: { ids: ['plain', 'space-token', 'literal-backslash', 'literal-a'] } },

      { select: String.raw`.foo\ bar`, expect: { count: 0 } },
      { select: String.raw`.foo\ `, expect: { count: 0 } },
      { select: String.raw`.foo\a bar`, expect: { count: 0 } },

      { select: `[class="foo bar"]`, expect: { ids: ['plain'] } },
    ],
  },

]);
