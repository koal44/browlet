import { runScenarios } from '../dispatch';

runScenarios('style oracle selector prelude boundaries', 'normal', [
  {
    name: 'valid rule no whitespace before block',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo{ --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(0, 255, 0)' } },
    ],
  },

  {
    name: 'valid compound immediately before block',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo.bar{ --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo bar"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(0, 255, 0)' } },
    ],
  },

  {
    name: 'brace inside quoted attribute value',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo[data-x="{"] { --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo" data-x="{"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(0, 255, 0)' } },
    ],
  },

  {
    name: 'trailing comma before block drops rule',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo, { --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(255, 0, 0)' } },
    ],
  },

  {
    name: 'unclosed :is before block',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo:is(.bar { --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo bar"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(255, 0, 0)' } },
    ],
  },

  {
    name: 'unclosed :where before block',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo:where(.bar { --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo bar"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(255, 0, 0)' } },
    ],
  },

  {
    name: 'unclosed :not before block',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo:not(.baz { --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo bar"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(255, 0, 0)' } },
    ],
  },

  {
    name: 'unclosed attribute selector before block',
    engines: ['native'],
    markup: `
      <style>
        :root { --probe-color: ${'rgb(255, 0, 0)'}; }
        #target { color: var(--probe-color); }
        .foo[data-x="{ --probe-color: ${'rgb(0, 255, 0)'}; }
      </style>
      <div id="target" class="foo" data-x="{"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(255, 0, 0)' } },
    ],
  },

  {
    name: 'invalid selector list arm vs forgiving pseudo arm',
    engines: ['native'],
    markup: `
      <style>
        :root {
          --list-color: rgb(255, 0, 0);
          --is-color: rgb(255, 0, 0);
          --where-color: rgb(255, 0, 0);
        }

        #list { color: var(--list-color); }
        #is { color: var(--is-color); }
        #where { color: var(--where-color); }

        .list, :bogus { --list-color: rgb(0, 255, 0); }
        :is(.is, :bogus) { --is-color: rgb(0, 255, 0); }
        :where(.where, :bogus) { --where-color: rgb(0, 255, 0); }
      </style>

      <div id="list" class="list"></div>
      <div id="is" class="is"></div>
      <div id="where" class="where"></div>
    `,
    cases: [
      { computedStyle: 'color', ref: { by: 'id', id: 'list' }, expect: { value: 'rgb(255, 0, 0)' } },
      { computedStyle: 'color', ref: { by: 'id', id: 'is' }, expect: { value: 'rgb(0, 255, 0)' } },
      { computedStyle: 'color', ref: { by: 'id', id: 'where' }, expect: { value: 'rgb(0, 255, 0)' } },
    ],
  },

  {
    name: 'cssom keeps valid declaration after malformed declaration',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo { color red; margin-left: 3px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '3px', important: false },
        },
      },
    ],
  },

  {
    name: 'cssom expands background shorthand into longhand declarations',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo { background: blue; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'background' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { target: 'style.property', name: 'background-color' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'background-color', value: 'blue', important: false },
        },
      },
    ],
  },

  {
    name: 'cssom reads first document stylesheet when ref is omitted',
    engines: ['native'],
    markup: `
      <style>
        .foo { margin-left: 3px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: {
          cssom: { name: 'margin-left', value: '3px', important: false },
        },
      },
    ],
  },

  {
    name: 'cssom exposes declaration block inspection',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo { margin-left: 3px; margin-right: 4px !important; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'rule.style', rule: 0 },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: {
            // $type: 'CSSStyleDeclaration',
            kind: 'styleDeclaration',
            active: [
              { name: 'margin-left', value: '3px', important: false },
              { name: 'margin-right', value: '4px', important: true },
            ],
          },
        },
      },
    ],
  },

  {
    name: 'cssom inspects nested media rules',
    engines: ['native'],
    markup: `
      <style id="sheet">
        @media screen {
          .foo { margin-left: 3px; }
        }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'sheet.cssRules' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: [
            {
              $type: 'CSSMediaRule',
              conditionText: 'screen',
              cssRules: [
                {
                  $type: 'CSSStyleRule',
                  selectorText: '.foo',
                  style: {
                    kind: 'styleDeclaration',
                    active: [
                      { name: 'margin-left', value: '3px', important: false },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  },

  {
    name: 'cssom drops invalid selector list rule and keeps following rule',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo, { margin-left: 3px; }
        .bar { margin-left: 4px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'sheet.cssRules' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: [
            {
              $type: 'CSSStyleRule',
              selectorText: '.bar',
              style: {
                active: [
                  { name: 'margin-left', value: '4px', important: false },
                ],
              },
            },
          ],
        },
      },
    ],
  },

  {
    name: 'cssom keeps last normal duplicate declaration',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo { margin-left: 1px; margin-left: 2px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '2px', important: false },
        },
      },
    ],
  },

  {
    name: 'cssom important duplicate beats later normal declaration',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo { margin-left: 1px !important; margin-left: 2px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '1px', important: true },
        },
      },
    ],
  },

  {
    name: 'cssom does not split declaration value on semicolon inside string',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo { font-family: "x;y"; margin-left: 3px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'font-family' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'font-family', value: '"x;y"', important: false },
        },
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '3px', important: false },
        },
      },
    ],
  },

  {
    name: 'cssom drops invalid selector list but keeps forgiving pseudo rules',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .list, :bogus { margin-top: 1px; }
        :is(.is, :bogus) { margin-left: 2px; }
        :where(.where, :bogus) { margin-right: 3px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-top' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '2px', important: false },
        },
      },
      {
        cssom: { target: 'style.property', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-right', value: '3px', important: false },
        },
      },
    ],
  },

]);

runScenarios('style oracle tokenizer recovery', 'normal', [
  {
    name: 'unterminated comment keeps prior declaration and consumes rest of stylesheet',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo { margin-left: 1px; /* unterminated
        .bar { margin-left: 2px; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'sheet.cssRules' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: [
            {
              $type: 'CSSStyleRule',
              selectorText: '.foo',
              style: {
                active: [
                  { name: 'margin-left', value: '1px', important: false },
                ],
              },
            },
          ],
        },
      },
    ],
  },

  {
    name: 'newline in string swallows later same-block declaration but later rule survives',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo {
          margin-right: 5px;
          font-family: "x
          y";
          margin-left: 3px;
        }
        .bar {
          margin-top: 1px;
        }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-right', value: '5px', important: false },
        },
      },
      {
        cssom: { target: 'style.property', name: 'font-family' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { target: 'style.property', name: 'margin-top' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-top', value: '1px', important: false },
        },
      },
    ],
  },

  {
    name: 'newline in string followed by bare semicolon recovers following declaration',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo {
          margin-right: 5px;
          font-family: "x
          ;
          margin-left: 3px;
        }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-right', value: '5px', important: false },
        },
      },
      {
        cssom: { target: 'style.property', name: 'font-family' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '3px', important: false },
        },
      },
    ],
  },

  {
    name: 'bad url drops current declaration and keeps following declaration',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .foo {
          background-image: url(foo"bar);
          margin-left: 4px;
        }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '4px', important: false },
        },
      },
    ],
  },
]);

runScenarios('style oracle nesting declaration order', 'normal', [
  {
    name: 'nested ampersand after declaration wins when later in source',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style>
        .foo {
          background-color: rgb(0, 255, 0);

          & {
            background-color: rgb(255, 0, 0);
          }
        }
      </style>

      <div id="target" class="foo"></div>
    `,
    cases: [
      {
        computedStyle: 'background-color',
        ref: { by: 'id', id: 'target' },
        expect: { value: 'rgb(255, 0, 0)' },
      },
    ],
  },

  {
    name: 'declaration after nested ampersand wins when later in source',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style>
        .foo {
          & {
            background-color: rgb(255, 0, 0);
          }

          background-color: rgb(0, 255, 0);
        }
      </style>

      <div id="target" class="foo"></div>
    `,
    cases: [
      {
        computedStyle: 'background-color',
        ref: { by: 'id', id: 'target' },
        expect: { value: 'rgb(0, 255, 0)' },
      },
    ],
  },
]);

runScenarios('testing pseudo elements', 'normal', [
  {
    name: 'pseudo-element selectors distinguish valid empty from invalid chains',
    // status: 'only',
    engines: ['native'],
    markup: `
      <ol>
        <li id="item">one</li>
      </ol>
    `,
    cases: [
      // Pseudo-element selectors are valid CSS selectors, but DOM selection APIs
      // return Elements, so these should not return pseudo-elements.
      { select: 'li::marker', expect: { throws: false, count: 0 } },

      // CSS Pseudo says ::before::marker / ::after::marker are valid selector
      // chains for marker boxes of generated pseudo-elements that are list items.
      // In DOM selection APIs they should still return no Elements.
      { select: 'li::before::marker', expect: { throws: false, count: 0 }, browsers: ['chromium', 'firefox'] },
      { select: 'li::before::marker', expect: { throws: true, count: 0 }, browsers: ['webkit'] },
      { select: 'li::after::marker', expect: { throws: false, count: 0 }, browsers: ['chromium', 'firefox'] },
      { select: 'li::after::marker', expect: { throws: true, count: 0 }, browsers: ['webkit'] },

      // CSS Pseudo says ::marker::marker is invalid.
      { select: 'li::marker::marker', expect: { throws: true } },
    ],
  },

  {
    name: 'invalid pseudo-element chain rule is omitted before following rule',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style>
        li::marker::marker { margin-left: 3px; }
        .ok { margin-left: 4px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '4px', important: false } },
      },
      { cssom: { target: 'sheet.cssRules.item', rule: 1 }, expect: { throws: true } },
    ],
  },

  {
    name: 'valid marker pseudo-element rule is preserved',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style>
        li::marker { color: red; }
        .ok { margin-left: 4px; }
      </style>`,
    cases: [
      { cssom: { target: 'sheet.cssRules.item', rule: 0 }, expect: { throws: false } },
      { cssom: { target: 'sheet.cssRules.item', rule: 1 }, expect: { throws: false } },
    ],
  },

  {
    name: 'native host pseudo not featureless probes',
    // status: 'only',
    // engines: ['native'],
    markup: `<div id="host" class="foo"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <div id="inside"></div>
          <div id="insideFoo" class="foo"></div>
        `;
      });
    },
    cases: [
      // Baseline: direct compound mixing ordinary .foo with :host is impossible.
      { select: '.foo:host *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host.foo *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // This is the pressure test.
      // The argument .foo:host is impossible, so a normal div should satisfy :not(.foo:host).
      { select: 'div:not(.foo:host)', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo'] } },
      { select: 'div', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo'] } },

      // Same point, but as match() on concrete normal elements.
      { match: 'div:not(.foo:host)', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['inside'] } },
      { match: 'div:not(.foo:host)', ref: { by: 'id', id: 'insideFoo', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['insideFoo'] } },

      // But once :host is the subject-side requirement, the compound becomes impossible.
      { select: ':host:not(.foo:host) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // For contrast: :host:not(.missing:host) should also be empty if the featureless restriction applies.
      // Even though the host does not have .missing, the argument is still not allowed to match featureless.
      { select: ':host:not(.missing:host) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // But :host:not(:host(.missing)) should match, because :host(.missing) is allowed-to-match-featureless
      // and evaluates false for this host.
      { select: ':not(:host(.missing)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo'] }, browsers: ['chromium', 'firefox'] },
      { select: ':host:not(:host(.missing)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo'] }, browsers: ['chromium', 'firefox'] },
      { select: ':host:not(:host(.missing)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] }, browsers: ['webkit'], engines: ['native'] }, // WebKit currently diverges on host-boundary :not(:host(...)) behavior.

      // And :host:not(:host(.foo)) should not match, because the host does have .foo.
      { select: ':host:not(:host(.foo)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
    ],
  },

]);

runScenarios('pseudo-element tail selector API validity', 'normal', [
  {
    name: 'dom selector validity shows generated pseudo-element tail gaps',
    engines: ['native'],
    markup: `
      <ol>
        <li id="item" class="foo">one</li>
      </ol>
    `,
    cases: [
      // Baseline: valid pseudo-element selector, but DOM APIs return Elements, not pseudo-elements.
      { select: 'li::before', expect: { throws: false, count: 0 } },

      // Spec target: user-action pseudo-classes are allowed after pseudo-elements.
      // Native engines currently reject the generated-pseudo case at the selector API boundary.
      { select: 'li::before:hover', expect: { throws: false, count: 0 }, status: 'fail' },

      // Same gap through a strict logical pseudo with an otherwise valid user-action argument.
      { select: 'li::before:not(:hover)', expect: { throws: false, count: 0 }, status: 'fail' },

      // Forgiving wrappers are accepted. This does not prove :hover survived;
      // it may have been dropped by forgiving-list behavior.
      { select: 'li::before:is(:hover)', expect: { throws: false, count: 0 } },
      { select: 'li::before:where(:hover)', expect: { throws: false, count: 0 } },

      // Ordinary selectors are invalid in the pseudo-element tail.
      // :is/:where forgive the invalid branch and become valid-but-empty.
      { select: 'li::before:is(.foo)', expect: { throws: false, count: 0 } },
      { select: 'li::before:where(.foo)', expect: { throws: false, count: 0 } },

      // Combinators after ordinary generated pseudo-elements are invalid;
      // forgiving wrappers drop the bad arm.
      { select: 'li::before:is(> span)', expect: { throws: false, count: 0 } },
      { select: 'li::before:where(> span)', expect: { throws: false, count: 0 } },

      // :not is strict: contextual invalidity inside it poisons the selector.
      { select: 'li::before:not(.foo)', expect: { throws: true } },
      { select: 'li::before:not(> span)', expect: { throws: true } },
      { select: 'li::before:not(.foo > .bar)', expect: { throws: true } },

      // :has is relational, not logical; it is not granted pseudo-element-tail permission.
      { select: 'li::before:has(*)', expect: { throws: true }, browsers: ['chromium', 'firefox'] },
      { select: 'li::before:has(*)', expect: { throws: true }, browsers: ['webkit'], status: 'fail' },

      // Direct combinator after ::before remains invalid.
      { select: 'li::before > span', expect: { throws: true } },
    ],
  },
]);

runScenarios('pseudo-element tail CSSOM preservation and omission', 'normal', [
  {
    name: 'forgiving empty is after pseudo-element preserves rule but does not match origin class',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style id="sheet">
        #target::before {
          content: "x";
          color: rgb(255, 0, 0);
        }

        #target::before:is(.foo) {
          color: rgb(0, 255, 0);
          margin-left: 3px;
        }
      </style>

      <div id="target" class="foo"></div>
    `,
    cases: [
      // The rule is preserved: :is(.foo) becomes valid-but-empty.
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },

      // But it does not mean "originating element has class foo".
      {
        computedStyle: 'color',
        pseudo: '::before',
        ref: { by: 'id', id: 'target' },
        expect: { value: 'rgb(255, 0, 0)' },
      },
    ],
  },

  {
    name: 'strict not with ordinary selector after pseudo-element drops rule',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style id="sheet">
        #target::before:not(.foo) { margin-left: 3px; }
        .ok { margin-right: 4px; }
      </style>

      <div id="target" class="foo"></div>
      <div class="ok"></div>
    `,
    cases: [
      // Unique property: if the invalid rule is omitted, this declaration is absent.
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },

      // Sanity check: following valid rule survived recovery.
      {
        cssom: { target: 'style.property', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-right', value: '4px', important: false } },
      },
    ],
  },

  {
    name: 'has after pseudo-element is a native divergence in WebKit',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style id="sheet">
        #target::before:has(*) { margin-left: 3px; }
        .ok { margin-right: 4px; }
      </style>

      <div id="target"></div>
      <div class="ok"></div>
    `,
    cases: [
      // Spec target: :has is not logical/user-action, so this declaration should be absent.
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
        browsers: ['chromium', 'firefox'],
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
        browsers: ['webkit'],
        status: 'fail',
      },

      // Recovery sanity check.
      {
        cssom: { target: 'style.property', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-right', value: '4px', important: false } },
      },
    ],
  },

  {
    name: 'direct user-action pseudo after before is spec target but native gap',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style id="sheet">
        #target::before:hover { margin-left: 3px; }
        #target::before:focus { margin-right: 5px; }
        .ok { margin-top: 7px; }
      </style>

      <div id="target"></div>
      <div class="ok"></div>
    `,
    cases: [
      // Spec target: these declarations should be preserved.
      // Current native engines drop the generated-pseudo user-action rules.
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
        status: 'fail',
      },
      {
        cssom: { target: 'style.property', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-right', value: '5px', important: false } },
        status: 'fail',
      },

      // Following valid rule survives, proving stylesheet recovery.
      {
        cssom: { target: 'style.property', name: 'margin-top' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-top', value: '7px', important: false } },
      },
    ],
  },
]);

runScenarios('pseudo-element tail nested forgiving logical behavior', 'normal', [
  {
    name: 'forgiving empty is can be negated in pseudo-element tail',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style>
        #target::before {
          content: "x";
          color: rgb(255, 0, 0);
        }

        #target::before:not(:is(.foo)) {
          color: rgb(0, 255, 0);
        }
      </style>

      <div id="target" class="foo"></div>
    `,
    cases: [
      // Spec-forgiving reading:
      //   .foo is contextually invalid in the pseudo-element tail.
      //   :is(.foo) drops the invalid arm and matches nothing.
      //   :not(:is(.foo)) therefore matches.
      {
        computedStyle: 'color',
        pseudo: '::before',
        ref: { by: 'id', id: 'target' },
        expect: { value: 'rgb(0, 255, 0)' },
        browsers: ['chromium', 'firefox'],
      },

      // WebKit diverges from Chromium/Firefox here.
      {
        computedStyle: 'color',
        pseudo: '::before',
        ref: { by: 'id', id: 'target' },
        expect: { value: 'rgb(0, 255, 0)' },
        browsers: ['webkit'],
        status: 'fail',
      },
    ],
  },
]);

runScenarios('pseudo-element tail nested forgiving matching diagnosis', 'normal', [
  {
    name: 'nested forgiving empty is matches under not except in WebKit',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style>
        #withFoo::before,
        #withoutFoo::before {
          content: "x";
          color: rgb(255, 0, 0);
        }

        #withFoo::before:not(:is(.foo)),
        #withoutFoo::before:not(:is(.foo)) {
          color: rgb(0, 255, 0);
        }
      </style>

      <div id="withFoo" class="foo"></div>
      <div id="withoutFoo"></div>
    `,
    cases: [
      {
        computedStyle: 'color',
        pseudo: '::before',
        ref: { by: 'id', id: 'withFoo' },
        expect: { value: 'rgb(0, 255, 0)' },
        browsers: ['chromium', 'firefox'],
      },
      {
        computedStyle: 'color',
        pseudo: '::before',
        ref: { by: 'id', id: 'withoutFoo' },
        expect: { value: 'rgb(0, 255, 0)' },
        browsers: ['chromium', 'firefox'],
      },

      // WebKit preserves the rule in CSSOM, but both withFoo and withoutFoo stay red.
      // That rules out simple origin-element leakage; WebKit behaves as if the invalid
      // class selector remains inapplicable/null-ish through :is() and :not().
      {
        computedStyle: 'color',
        pseudo: '::before',
        ref: { by: 'id', id: 'withFoo' },
        expect: { value: 'rgb(0, 255, 0)' },
        browsers: ['webkit'],
        status: 'fail',
      },
      {
        computedStyle: 'color',
        pseudo: '::before',
        ref: { by: 'id', id: 'withoutFoo' },
        expect: { value: 'rgb(0, 255, 0)' },
        browsers: ['webkit'],
        status: 'fail',
      },
    ],
  },
]);
