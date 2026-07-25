import { runScenarios } from '../../harness/browser/scenarios';

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
        expect: { cssom: null },
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
        expect: { cssom: null },
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
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: null },
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
        expect: { cssom: null },
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
        expect: { cssom: null },
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
      { select: 'li::before::marker', expect: { throws: false, count: 0 }, browsers: ['webkit'], status: 'fail' },
      { select: 'li::after::marker', expect: { throws: false, count: 0 }, browsers: ['chromium', 'firefox'] },
      { select: 'li::after::marker', expect: { throws: false, count: 0 }, browsers: ['webkit'], status: 'fail' },

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
      { cssom: { target: 'sheet.cssRules.item', rule: 1 }, expect: { cssom: null } },
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
      { select: ':host:not(:host(.missing)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo'] }, browsers: ['webkit'], engines: ['native'], status: 'fail' },

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
        expect: { cssom: null },
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
        expect: { cssom: null },
        browsers: ['chromium', 'firefox'],
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: null },
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

runScenarios('pseudo-element internal structure combinator oracle', 'normal', [
  {
    name: 'spec validity against native selector APIs for combinators after pseudo-elements',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style>
        #target::before,
        #target::after {
          content: "x";
        }
      </style>

      <div id="target">text <span>child</span></div>

      <ol>
        <li id="item">one</li>
      </ol>

      <input id="input" placeholder="placeholder">
      <input id="file" type="file">

      <details id="details" open>
        <summary>summary</summary>
        <div>details child</div>
      </details>

      <div id="host">
        <span id="light" slot="x"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <slot name="x"></slot>
          <span id="partOwner" part="foo"><em>part child</em></span>
        `;
      });
    },
    cases: [
      // Baselines distinguish supported pseudo-elements and chains from probes whose
      // native rejection cannot specifically be attributed to the combinator.

      // Typographic pseudo-elements
      { select: '#target::first-line', expect: { throws: false } },
      { select: '#target::first-letter', expect: { throws: false } },
      { select: '#target::first-letter::prefix', expect: { throws: false }, status: 'fail' },
      { select: '#target::first-letter::suffix', expect: { throws: false }, status: 'fail' },

      // Highlight pseudo-elements
      { select: '#target::selection', expect: { throws: false } },
      { select: '#target::search-text', expect: { throws: false }, browsers: ['chromium'] },
      { select: '#target::search-text', expect: { throws: false }, browsers: ['firefox', 'webkit'], status: 'fail' },
      { select: '#target::target-text', expect: { throws: false } },
      { select: '#target::spelling-error', expect: { throws: false }, browsers: ['chromium', 'webkit'] },
      { select: '#target::spelling-error', expect: { throws: false }, browsers: ['firefox'], status: 'fail' },
      { select: '#target::grammar-error', expect: { throws: false }, browsers: ['chromium', 'webkit'] },
      { select: '#target::grammar-error', expect: { throws: false }, browsers: ['firefox'], status: 'fail' },
      { select: '#target::highlight(foo)', expect: { throws: false } },

      // Generated / marker / input pseudo-elements
      { select: '#target::before', expect: { throws: false } },
      { select: '#target::after', expect: { throws: false } },
      { select: '#item::marker', expect: { throws: false } },
      { select: '#input::placeholder', expect: { throws: false } },

      // Element-backed pseudo-elements
      { select: '#file::file-selector-button', expect: { throws: false } },
      { select: '#details::details-content', expect: { throws: false } },

      // Shadow pseudo-elements
      { select: '#host::part(foo)', expect: { throws: false } },
      { select: '::slotted(*)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false } },

      // Child combinator probes. Expected result: throw unless the pseudo-element
      // is defined to expose internal structure to child/descendant combinators.

      // Typographic pseudo-elements
      { select: '#target::first-line > *', expect: { throws: true } },
      { select: '#target::first-letter > *', expect: { throws: true } },
      { select: '#target::first-letter::prefix > *', expect: { throws: true } },
      { select: '#target::first-letter::suffix > *', expect: { throws: true } },

      // Highlight pseudo-elements
      { select: '#target::selection > *', expect: { throws: true } },
      { select: '#target::search-text > *', expect: { throws: true } },
      { select: '#target::target-text > *', expect: { throws: true } },
      { select: '#target::spelling-error > *', expect: { throws: true } },
      { select: '#target::grammar-error > *', expect: { throws: true } },
      { select: '#target::highlight(foo) > *', expect: { throws: true } },

      // Generated / marker / input pseudo-elements
      { select: '#target::before > *', expect: { throws: true } },
      { select: '#target::after > *', expect: { throws: true } },
      { select: '#item::marker > *', expect: { throws: true } },
      { select: '#input::placeholder > *', expect: { throws: true } },

      // Element-backed pseudo-elements
      { select: '#file::file-selector-button > *', expect: { throws: true } },
      { select: '#details::details-content > *', expect: { throws: true } },

      // Shadow pseudo-elements
      { select: '#host::part(foo) > *', expect: { throws: true } },
      { select: '::slotted(*) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true } },

      // Sibling sanity check: internal structure, if any, would be child/descendant,
      // not sibling traversal away from the pseudo-element.
      { select: '#target::before + *', expect: { throws: true } },
    ],
  },
]);

runScenarios('pseudo-element sub-origin selector API validity', 'normal', [
  {
    name: 'native validity for element-backed and slotted pseudo-element chains',
    // status: 'only',
    engines: ['native'],
    markup: `
      <div id="target">target</div>

      <ol>
        <li id="item">item</li>
      </ol>

      <input id="file" type="file">

      <details id="details">
        <summary>summary</summary>
        <span>content</span>
      </details>

      <div id="host">
        <span>assigned</span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;

        host.attachShadow({ mode: 'open' }).innerHTML = `
          <div part="foo">
            <slot></slot>
          </div>
        `;
      });
    },
    cases: [
      // Baselines distinguish unsupported pseudo-elements from rejected chains.
      { select: '#file::file-selector-button', expect: { throws: false } },
      { select: '#details::details-content', expect: { throws: false } },
      { select: '#host::part(foo)', expect: { throws: false } },
      { select: '::slotted(*)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false } },

      // Specification-valid element-backed chains.
      { select: '#file::file-selector-button::before', expect: { throws: false }, status: 'fail' },
      { select: '#details::details-content::before', expect: { throws: false } },
      { select: '#host::part(foo)::before', expect: { throws: false } },

      // Syntactically valid but specified never to match.
      { select: '#host::part(foo)::part(bar)', expect: { throws: false }, status: 'fail' },

      // ::slotted() allows tree-abiding pseudo-elements.
      { select: '::slotted(*)::before', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false } },

      // Pairwise chain advancement.
      { select: '#host::part(foo)::before::marker', expect: { throws: false }, browsers: ['chromium', 'firefox'] },
      { select: '#host::part(foo)::before::marker', expect: { throws: false }, browsers: ['webkit'], status: 'fail' },

      // Invalid origins.
      { select: '::prefix', expect: { throws: true } },
      { select: '::suffix', expect: { throws: true } },
      { select: '#target::before::before', expect: { throws: true } },
      { select: '#item::marker::before', expect: { throws: true } },
      { select: '#target::selection::before', expect: { throws: true } },
      { select: '#host::part(foo)::marker::before', expect: { throws: true } },
      { select: '::slotted(*)::selection', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true } },
    ],
  },
]);

runScenarios('element-backed pseudo-element pseudo-class validity', 'normal', [
  {
    name: 'native selector APIs allow every pseudo-class after element-backed pseudo-elements',
    // status: 'only',
    engines: ['native'],
    markup: `
      <input id="file" type="file">

      <details id="details">
        <summary>summary</summary>
        <span>content</span>
      </details>

      <div id="host"></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <span part="label">label</span>
        `;
      });
    },
    cases: [
      // Baselines distinguish unsupported element-backed pseudo-elements from
      // rejection of a particular pseudo-class tail.
      { select: '#file::file-selector-button', expect: { throws: false } },
      { select: '#details::details-content', expect: { throws: false } },
      { select: '#host::part(label)', expect: { throws: false } },

      // Element-backed pseudo-elements allow every pseudo-class syntactically,
      // even when the pseudo-class is specified never to match.
      { select: '#file::file-selector-button:hover', expect: { throws: false } },
      { select: '#file::file-selector-button:disabled', expect: { throws: false }, status: 'fail' },
      { select: '#file::file-selector-button:first-child', expect: { throws: false }, status: 'fail' },
      { select: '#file::file-selector-button:has(*)', expect: { throws: false }, browsers: ['chromium', 'firefox'], status: 'fail' },
      { select: '#file::file-selector-button:has(*)', expect: { throws: false }, browsers: ['webkit'] },
      { select: '#file::file-selector-button:scope', expect: { throws: false }, status: 'fail' },

      { select: '#details::details-content:hover', expect: { throws: false } },
      { select: '#details::details-content:open', expect: { throws: false }, browsers: ['chromium', 'firefox'] },
      { select: '#details::details-content:open', expect: { throws: false }, browsers: ['webkit'], status: 'fail' },
      { select: '#details::details-content:empty', expect: { throws: false }, status: 'fail' },
      { select: '#details::details-content:has(*)', expect: { throws: false }, browsers: ['chromium', 'firefox'], status: 'fail' },
      { select: '#details::details-content:has(*)', expect: { throws: false }, browsers: ['webkit'] },

      { select: '#host::part(label):hover', expect: { throws: false } },
      { select: '#host::part(label):disabled', expect: { throws: false } },
      { select: '#host::part(label):first-child', expect: { throws: false }, status: 'fail' },
      { select: '#host::part(label):has(*)', expect: { throws: false }, browsers: ['chromium', 'firefox'], status: 'fail' },
      { select: '#host::part(label):has(*)', expect: { throws: false }, browsers: ['webkit'] },
      { select: '#host::part(label):scope', expect: { throws: false }, browsers: ['chromium', 'firefox'], status: 'fail' },
      { select: '#host::part(label):scope', expect: { throws: false }, browsers: ['webkit'] },

      // Logical pseudo-classes inherit the policy at their position. Treating
      // the element-backed pseudo-element like a type selector should allow
      // ordinary simple selectors in these arguments.
      { select: '#file::file-selector-button:is(:disabled)', expect: { throws: false } },
      { select: '#file::file-selector-button:not(.missing)', expect: { throws: false }, status: 'fail' },
      { select: '#details::details-content:is([open])', expect: { throws: false } },
      { select: '#host::part(label):where(.label)', expect: { throws: false } },
      { select: '#host::part(label):is(* > .label)', expect: { throws: false } },
      { select: '#host::part(label):not([hidden])', expect: { throws: false }, status: 'fail' },

      // Other selector-valued functional arguments enter a nested selector frame.
      { select: '::part(label):host(.label)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false }, status: 'fail' },
      { select: '::part(label):host-context(.label)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false }, status: 'fail' },
      { select: '#host::part(label):nth-child(2n of .label)', expect: { throws: false }, status: 'fail' },
      { select: '::part(label)::slotted(.label)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false }, status: 'fail' },
    ],
  },
]);

runScenarios('logical selector argument restrictions', 'normal', [
  {
    name: 'native validity for compound-only logical arguments and has restrictions',
    // status: 'only',
    engines: ['native'],
    markup: `
      <div id="host">
        <span class="a"><span class="b">nested</span></span>
        <span class="a b">slotted</span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
      });
    },
    cases: [
      // Baselines: the shadow selector functionals accept compound arguments.
      { select: '::slotted(.a)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false } },
      { select: ':host(.a)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false } },
      { select: ':host-context(.a)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false }, browsers: ['chromium'] },
      { select: ':host-context(.a)', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false }, browsers: ['firefox', 'webkit'], status: 'fail' },

      // Preserve ::slotted()'s compound boundary through nested selector arguments.
      // Otherwise shadow style invalidation can depend on arbitrary light-tree structure.
      { select: '::slotted(:nth-child(2n of .a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['chromium', 'webkit'], status: 'fail' },
      { select: '::slotted(:nth-child(2n of .a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['firefox'] },

      // Logical pseudo-classes do inherit the compound-only restriction.
      // :not() is strict, while :is() and :where() drop the invalid complex arm.
      { select: '::slotted(:not(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['chromium', 'firefox'] },
      { select: '::slotted(:not(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['webkit'], status: 'fail' },
      { select: '::slotted(:is(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false } },
      { select: '::slotted(:where(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false } },
      { select: ':host(:not(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['chromium', 'firefox'] },
      { select: ':host(:not(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['webkit'], status: 'fail' },
      { select: ':host-context(:is(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false }, browsers: ['chromium'] },
      { select: ':host-context(:is(.a > .b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: false }, browsers: ['firefox', 'webkit'], status: 'fail' },

      // :has() takes inherently complex relative selectors, so it is invalid
      // where the surrounding grammar permits compound selectors only.
      { select: '::slotted(:has(.b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['chromium'] },
      { select: '::slotted(:has(.b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['firefox', 'webkit'], status: 'fail' },

      { select: ':host-context(:has(.b))', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true } },

      // Direct and strict-indirect nesting of :has() invalidates the selector.
      { select: ':has(:has(.b))', expect: { throws: true } },
      { select: ':has(:not(:has(.b)))', expect: { throws: true } },

      // A nested :has() inside forgiving :is() is an invalid arm and is dropped.
      { select: ':has(:is(:has(.b)))', expect: { throws: false } },

      // No currently supported pseudo-element is defined as :has-allowed.
      { select: ':has(::before)', expect: { throws: true } },
      { select: ':has(:not(::before))', expect: { throws: true } },
      { select: ':has(:is(::before))', expect: { throws: false } },
    ],
  },
]);

runScenarios('custom-ident default reservation oracle', 'normal', [
  {
    name: 'native parsers reserve default except in highlight arguments',
    engines: ['native'],
    markup: `
      <style>
        #container { container-name: default; }
      </style>
      <div id="container"></div>
      <div id="registered-property"></div>
      <div id="highlight-target"></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const result = document.getElementById('registered-property')!;

        try {
          CSS.registerProperty({
            name: '--oracle-custom-ident-default',
            syntax: '<custom-ident>',
            inherits: false,
            initialValue: 'default',
          });
          result.dataset.result = 'accepted';
        } catch (error) {
          result.dataset.result = error instanceof DOMException
            ? error.name
            : 'error';
        }
      });
    },
    cases: [
      // container-name uses <custom-ident> and drops the reserved keyword.
      {
        cssom: { target: 'style.property', rule: 0, name: 'container-name' },
        expect: { cssom: null },
      },

      // The Properties and Values API independently enforces the reservation.
      {
        select: '#registered-property[data-result="SyntaxError"]',
        expect: { count: 1 },
      },

      // CSS Pseudo defines this argument as <custom-ident>, but browsers
      // currently accept default as if the production were merely <ident>.
      {
        select: '#highlight-target::highlight(default)',
        expect: { throws: true },
        status: 'fail',
      },
    ],
  },
]);

runScenarios('CSS.supports URL modifier oracle', 'normal', [
  {
    name: 'native URL modifier support',
    engines: ['native'],
    markup: '',
    cases: [
      { supports: { property: 'background-image', value: 'url("x")' }, expect: { supported: true } },
      { supports: { property: 'background-image', value: 'src("x")' }, expect: { supported: false } },
      {
        supports: { property: 'background-image', value: 'url("x" cross-origin(anonymous))' },
        browsers: ['chromium', 'firefox'],
        expect: { supported: false },
      },
      {
        supports: { property: 'background-image', value: 'url("x" cross-origin(anonymous))' },
        browsers: ['webkit'],
        expect: { supported: true },
      },
      { supports: { property: 'background-image', value: 'url("x" crossorigin(anonymous))' }, expect: { supported: false } },
      { supports: { property: 'background-image', value: 'url("x" integrity("sha256-test"))' }, expect: { supported: false } },
      {
        supports: { property: 'background-image', value: 'url("x" referrer-policy(no-referrer))' },
        browsers: ['chromium', 'firefox'],
        expect: { supported: false },
      },
      {
        supports: { property: 'background-image', value: 'url("x" referrer-policy(no-referrer))' },
        browsers: ['webkit'],
        expect: { supported: true },
      },
      { supports: { property: 'background-image', value: 'url("x" referrerpolicy(no-referrer))' }, expect: { supported: false } },
      { supports: { property: 'background-image', value: 'url("x" param(--color, red))' }, expect: { supported: false } },
      { supports: { property: 'background-image', value: 'url("x" unknown)' }, expect: { supported: false } },
      { supports: { property: 'background-image', value: 'url("x" unknown())' }, expect: { supported: false } },
    ],
  },
]);

runScenarios('CSSOM URL modifier oracle', 'normal', [
  {
    name: 'native declaration retention and serialization',
    engines: ['native'],
    markup: `
      <style id="sheet">
        .url             { background-image: url("x"); }
        .src             { background-image: src("x"); }
        .cross-origin    { background-image: url("x" cross-origin(anonymous)); }
        .integrity       { background-image: url("x" integrity("sha256-test")); }
        .referrer-policy { background-image: url("x" referrer-policy(no-referrer)); }
        .param           { background-image: url("x" param(--color, red)); }
        .unknown         { background-image: url("x" unknown()); }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'background-image', value: 'url("x")', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 1, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 2, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        browsers: ['chromium', 'firefox'],
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 2, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        browsers: ['webkit'],
        expect: {
          cssom: {
            name: 'background-image',
            value: 'url("x" cross-origin(anonymous))',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 3, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 4, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        browsers: ['chromium', 'firefox'],
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 4, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        browsers: ['webkit'],
        expect: {
          cssom: {
            name: 'background-image',
            value: 'url("x" referrer-policy(no-referrer))',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 5, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 6, name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        expect: { cssom: null },
      },
    ],
  },
]);

runScenarios('CSSOM number serialization oracle', 'normal', [
  {
    name: 'native number rounding and notation',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style id="number-serialization">
        .below-positive { scale: 0.1234564; }
        .half-positive  { scale: 0.1234565; }
        .above-positive { scale: 0.1234566; }
        .half-negative  { scale: -0.1234565; }
        .tiny-positive  { scale: 0.0000006; }
        .large-positive { scale: 123456789.1234567; }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        expect: { cssom: { name: 'scale', value: '0.123456', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 1, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['chromium', 'webkit'],
        expect: { cssom: { name: 'scale', value: '0.123456', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 1, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['firefox'],
        expect: { cssom: { name: 'scale', value: '0.123457', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 2, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        expect: { cssom: { name: 'scale', value: '0.123457', important: false } },
      },

      // Applying CSS's nearest-integer tie direction at six decimal places
      // would produce 0.123457 above and -0.123456 here. No engine produces
      // that pair: Firefox rounds both away from zero, while Chromium and
      // WebKit round both toward zero for these parsed values.
      {
        cssom: { target: 'style.property', rule: 3, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['chromium', 'webkit'],
        expect: { cssom: { name: 'scale', value: '-0.123456', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 3, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['firefox'],
        expect: { cssom: { name: 'scale', value: '-0.123457', important: false } },
      },

      // CSSOM says scientific notation is not used. WebKit alone emits the
      // six-decimal fixed form for this value.
      {
        cssom: { target: 'style.property', rule: 4, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['chromium'],
        expect: { cssom: { name: 'scale', value: '6e-07', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 4, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['firefox'],
        expect: { cssom: { name: 'scale', value: '6e-7', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 4, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['webkit'],
        expect: { cssom: { name: 'scale', value: '0.000001', important: false } },
      },

      // Chromium and Firefox effectively limit significant digits here;
      // WebKit preserves six digits after the decimal point.
      {
        cssom: { target: 'style.property', rule: 5, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['chromium'],
        expect: { cssom: { name: 'scale', value: '1.23457e+08', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 5, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['firefox'],
        expect: { cssom: { name: 'scale', value: '123457000', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 5, name: 'scale' },
        ref: { by: 'id', id: 'number-serialization' },
        browsers: ['webkit'],
        expect: { cssom: { name: 'scale', value: '123456789.123457', important: false } },
      },
    ],
  },
]);

runScenarios('CSS escaped dimension unit serialization oracle', 'normal', [
  {
    name: 'native serialization of an escaped exponent-like dimension unit',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style id="escaped-dimension-unit">
        .custom-property {
          --e2: 1\\65 2;
          --e2-escaped-digit: 1e\\000032;
          --e2-six-digit-escape: 1\\0000652;
          --e-minus-2: 1\\65 -2;
        }

        @media
          (unknown-leading-e: 1\\65 2),
          (unknown-uppercase-e: 1\\45 2),
          (unknown-trailing-digit: 1e\\000032),
          (unknown-six-digit-escape: 1\\0000652) {
          .media { color: green; }
        }

        @supports (--probe: 1\\65 -2) {
          .supports { color: green; }
        }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'sheet.cssRules' },
        ref: { by: 'id', id: 'escaped-dimension-unit' },
        browsers: ['chromium', 'firefox'],
        // Both engines preserve each author-provided escape spelling rather
        // than choosing a canonical serialization for the semantic unit.
        expect: {
          cssom: [
            {
              $type: 'CSSStyleRule',
              style: {
                active: [
                  { name: '--e2', value: '1\\65 2', important: false },
                  { name: '--e2-escaped-digit', value: '1e\\000032', important: false },
                  { name: '--e2-six-digit-escape', value: '1\\0000652', important: false },
                  { name: '--e-minus-2', value: '1\\65 -2', important: false },
                ],
              },
            },
            {
              $type: 'CSSMediaRule',
              conditionText: '(unknown-leading-e: 1\\65 2), (unknown-uppercase-e: 1\\45 2), (unknown-trailing-digit: 1e\\000032), (unknown-six-digit-escape: 1\\0000652)',
            },
            {
              $type: 'CSSSupportsRule',
              conditionText: '(--probe: 1\\65 -2)',
            },
          ],
        },
      },
      {
        cssom: { target: 'sheet.cssRules' },
        ref: { by: 'id', id: 'escaped-dimension-unit' },
        browsers: ['webkit'],
        // WebKit drops the escape, so the serialized text reparses as a
        // number token rather than the original dimension token.
        expect: {
          cssom: [
            {
              $type: 'CSSStyleRule',
              style: {
                active: [
                  { name: '--e2', value: '1e2', important: false },
                  { name: '--e2-escaped-digit', value: '1e2', important: false },
                  { name: '--e2-six-digit-escape', value: '1e2', important: false },
                  { name: '--e-minus-2', value: '1e-2', important: false },
                ],
              },
            },
            {
              $type: 'CSSMediaRule',
              conditionText: '(unknown-leading-e: 1e2), (unknown-uppercase-e: 1E2), (unknown-trailing-digit: 1e2), (unknown-six-digit-escape: 1e2)',
            },
            {
              $type: 'CSSSupportsRule',
              conditionText: '(--probe: 1e-2)',
            },
          ],
        },
      },
    ],
  },
]);

runScenarios('CSS calc dimension unit oracle', 'normal', [
  {
    name: 'native calc simplification normalizes recognized unit case',
    // Playwright's default browser context has a 1280 x 720 viewport.
    // The viewport-relative computed-value expectations below rely on it.
    engines: ['native'],
    markup: `
      <style id="calc-dimension-units">
        #calc-dimension-target {
          width: calc(1PX + 2px);
          margin-left: calc(1IN + 96px);
          margin-right: 1vw;
          margin-top: 1vh;
          padding-left: calc(1EM + 2px);
          padding-right: calc(1VW + 1vh);
          font-size: 10px;
          rotate: calc(1TURN + 90deg);
          transition-duration: calc(1S + 500ms);
          height: calc(1foo + 2FOO);
          --same-arbitrary: calc(1foo + 2foo);
          --mixed-arbitrary: calc(1foo + 2FOO);
        }
      </style>
      <div id="calc-dimension-target"></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const styleElement = document.getElementById('calc-dimension-units') as HTMLStyleElement;
        const rule = styleElement.sheet!.cssRules[0] as CSSStyleRule;

        const parseNumericValue = (css: string): string => {
          if (typeof CSSNumericValue === 'undefined') return 'unsupported';

          try {
            return CSSNumericValue.parse(css).toString();
          } catch (error) {
            return error instanceof DOMException ? error.name : 'Error';
          }
        };

        rule.style.setProperty('--typed-known', parseNumericValue('calc(1PX + 2px)'));
        rule.style.setProperty('--typed-same-arbitrary', parseNumericValue('calc(1foo + 2foo)'));
        rule.style.setProperty('--typed-mixed-arbitrary', parseNumericValue('calc(1foo + 2FOO)'));
      });
    },
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'width' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: { cssom: { name: 'width', value: 'calc(3px)', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: 'rotate' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: { cssom: { name: 'rotate', value: 'calc(450deg)', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: 'margin-left' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: { cssom: { name: 'margin-left', value: 'calc(192px)', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: 'padding-left' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: { cssom: { name: 'padding-left', value: 'calc(1em + 2px)', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: 'padding-right' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: { cssom: { name: 'padding-right', value: 'calc(1vh + 1vw)', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: 'transition-duration' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: { cssom: { name: 'transition-duration', value: 'calc(1.5s)', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: 'height' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--same-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: {
          cssom: {
            name: '--same-arbitrary',
            value: 'calc(1foo + 2foo)',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--mixed-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        expect: {
          cssom: {
            name: '--mixed-arbitrary',
            value: 'calc(1foo + 2FOO)',
            important: false,
          },
        },
      },
      {
        computedStyle: 'width',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: '3px' },
      },
      {
        computedStyle: 'rotate',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: '450deg' },
      },
      {
        computedStyle: 'margin-left',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: '192px' },
      },
      {
        computedStyle: 'margin-right',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: '12.8px' },
      },
      {
        computedStyle: 'margin-top',
        ref: { by: 'id', id: 'calc-dimension-target' },
        browsers: ['chromium', 'firefox'],
        expect: { value: '7.2px' },
      },
      {
        computedStyle: 'margin-top',
        ref: { by: 'id', id: 'calc-dimension-target' },
        browsers: ['webkit'],
        expect: { value: '7.1875px' },
      },
      {
        computedStyle: 'padding-left',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: '12px' },
      },
      {
        computedStyle: 'padding-right',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: '20px' },
      },
      {
        computedStyle: 'transition-duration',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: '1.5s' },
      },
      {
        computedStyle: '--same-arbitrary',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: 'calc(1foo + 2foo)' },
      },
      {
        computedStyle: '--mixed-arbitrary',
        ref: { by: 'id', id: 'calc-dimension-target' },
        expect: { value: 'calc(1foo + 2FOO)' },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-known' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['chromium'],
        expect: { cssom: { value: 'calc(3px)' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-known' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['firefox'],
        expect: { cssom: { value: 'unsupported' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-known' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['webkit'],
        expect: { cssom: { value: '3px' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-same-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['chromium'],
        expect: { cssom: { value: 'SyntaxError' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-same-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['firefox'],
        expect: { cssom: { value: 'unsupported' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-same-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['webkit'],
        expect: { cssom: { value: 'SyntaxError' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-mixed-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['chromium'],
        expect: { cssom: { value: 'SyntaxError' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-mixed-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['firefox'],
        expect: { cssom: { value: 'unsupported' } },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: '--typed-mixed-arbitrary' },
        ref: { by: 'id', id: 'calc-dimension-units' },
        browsers: ['webkit'],
        expect: { cssom: { value: 'SyntaxError' } },
      },
    ],
  },
]);

runScenarios('CSS angle-percentage combination oracle', 'normal', [
  {
    name: 'serializes an angle-percentage sum in a conic gradient',
    engines: ['native'],
    markup: `
      <style id="angle-percentage-cssom">
        #angle-percentage-target {
          background-image: conic-gradient(red calc(10deg + 20%), blue);
        }
      </style>
      <div id="angle-percentage-target"></div>
    `,
    cases: [
      {
        cssom: {
          target: 'style.property',
          rule: 0,
          name: 'background-image',
        },
        ref: { by: 'id', id: 'angle-percentage-cssom' },
        browsers: ['chromium', 'webkit'],
        expect: {
          cssom: {
            value: 'conic-gradient(red calc(20% + 10deg), blue)',
          },
        },
      },
      // Firefox currently rejects the declaration rather than preserving the
      // consistent <angle-percentage> calculation.
      {
        cssom: {
          target: 'style.property',
          rule: 0,
          name: 'background-image',
        },
        ref: { by: 'id', id: 'angle-percentage-cssom' },
        browsers: ['firefox'],
        status: 'fail',
        expect: {
          cssom: {
            value: 'conic-gradient(red calc(20% + 10deg), blue)',
          },
        },
      },
    ],
  },
  {
    name: 'promotes mixed angle and percentage operations to math sums',
    engines: ['native'],
    markup: '<div id="angle-percentage-typed-om"></div>',
    setupPage: async (page) => {
      await page.evaluate(() => {
        type NumericValue = {
          add(value: NumericValue): NumericValue;
          mul(value: number): NumericValue;
          toString(): string;
        };

        const css = CSS as unknown as {
          deg(value: number): NumericValue;
          percent(value: number): NumericValue;
        };
        const target = document.getElementById(
          'angle-percentage-typed-om',
        ) as HTMLElement;
        const evaluate = (operation: () => string): string => {
          try {
            return operation();
          } catch (error) {
            return error instanceof Error ? error.name : String(error);
          }
        };

        target.style.setProperty(
          '--addition',
          evaluate(() => css.deg(10).add(css.percent(20)).toString()),
        );
        target.style.setProperty(
          '--scaled-addition',
          evaluate(() =>
            css
              .deg(10)
              .mul(0.5)
              .add(css.percent(20).mul(0.5))
              .toString(),
          ),
        );
      });
    },
    cases: [
      {
        computedStyle: '--addition',
        ref: { by: 'id', id: 'angle-percentage-typed-om' },
        browsers: ['chromium', 'webkit'],
        expect: { value: 'calc(10deg + 20%)' },
      },
      {
        computedStyle: '--addition',
        ref: { by: 'id', id: 'angle-percentage-typed-om' },
        browsers: ['firefox'],
        status: 'fail',
        expect: { value: 'calc(10deg + 20%)' },
      },
      {
        computedStyle: '--scaled-addition',
        ref: { by: 'id', id: 'angle-percentage-typed-om' },
        browsers: ['chromium', 'webkit'],
        expect: { value: 'calc(5deg + 10%)' },
      },
      {
        computedStyle: '--scaled-addition',
        ref: { by: 'id', id: 'angle-percentage-typed-om' },
        browsers: ['firefox'],
        status: 'fail',
        expect: { value: 'calc(5deg + 10%)' },
      },
    ],
  },
]);

runScenarios('CSS zero and length-percentage combination oracle', 'normal', [
  {
    name: 'distinguishes literal zero and simplifies mixed zero components',
    engines: ['native'],
    markup: '<div id="zero-mix-oracle"></div>',
    setupPage: async (page) => {
      await page.evaluate(() => {
        const target = document.getElementById('zero-mix-oracle') as HTMLElement;
        const results: Record<string, unknown> = {
          supports: {
            widthZero: CSS.supports('width', '0'),
            widthCalcZero: CSS.supports('width', 'calc(0)'),
            widthCalcLengthPlusZero: CSS.supports('width', 'calc(10px + 0)'),
            timeZero: CSS.supports('transition-duration', '0'),
            timeZeroSeconds: CSS.supports('transition-duration', '0s'),
            rotateZero: CSS.supports('rotate', '0'),
            rotateZeroDegrees: CSS.supports('rotate', '0deg'),
            rotateCalcAnglePlusZero: CSS.supports('rotate', 'calc(10deg + 0)'),
            borderWidthPercentage: CSS.supports('border-width', '25%'),
            borderWidthCalcPercentage: CSS.supports('border-width', 'calc(25%)'),
            borderWidthCalcLength: CSS.supports('border-width', 'calc(10px)'),
            borderWidthCalcMixed: CSS.supports(
              'border-width',
              'calc(10px + 25%)',
            ),
            widthCalcPercentage: CSS.supports('width', 'calc(25%)'),
            widthCalcMixed: CSS.supports('width', 'calc(10px + 25%)'),
          },
        };

        if (typeof CSS.registerProperty !== 'function') {
          results.registeredLengthPercentage = 'unsupported';
          target.style.setProperty('--oracle', JSON.stringify(results));
          return;
        }

        CSS.registerProperty({
          name: '--oracle-length-percentage',
          syntax: '<length-percentage>',
          inherits: false,
          initialValue: '0px',
        });

        const computedValue = (value: string): string => {
          const element = document.createElement('div');
          element.style.setProperty('--oracle-length-percentage', value);
          document.body.append(element);
          const computed = getComputedStyle(element)
            .getPropertyValue('--oracle-length-percentage');
          element.remove();
          return computed;
        };

        const interpolatedValue = (progress: number): string => {
          const element = document.createElement('div');
          document.body.append(element);
          const animation = element.animate(
            [
              { '--oracle-length-percentage': '10px' },
              { '--oracle-length-percentage': '20%' },
            ],
            { duration: 1000, fill: 'both' },
          );
          animation.pause();
          animation.currentTime = progress * 1000;
          const computed = getComputedStyle(element)
            .getPropertyValue('--oracle-length-percentage');
          animation.cancel();
          element.remove();
          return computed;
        };

        results.computed = {
          lengthPlusZeroPercentage: computedValue('calc(10px + 0%)'),
          zeroLengthPlusPercentage: computedValue('calc(0px + 20%)'),
          zeroEmPlusPercentage: computedValue('calc(0em + 20%)'),
          mixedNonzero: computedValue('calc(10px + 20%)'),
          lengthPlusZeroEm: computedValue('calc(10px + 0em)'),
        };
        results.interpolated = {
          start: interpolatedValue(0),
          midpoint: interpolatedValue(0.5),
          end: interpolatedValue(1),
        };

        target.style.setProperty('--oracle', JSON.stringify(results));
      });
    },
    cases: [
      {
        computedStyle: '--oracle',
        ref: { by: 'id', id: 'zero-mix-oracle' },
        expect: {
          value: JSON.stringify({
            supports: {
              widthZero: true,
              widthCalcZero: false,
              widthCalcLengthPlusZero: false,
              timeZero: false,
              timeZeroSeconds: true,
              rotateZero: false,
              rotateZeroDegrees: true,
              rotateCalcAnglePlusZero: false,
              borderWidthPercentage: false,
              borderWidthCalcPercentage: false,
              borderWidthCalcLength: true,
              borderWidthCalcMixed: false,
              widthCalcPercentage: true,
              widthCalcMixed: true,
            },
            computed: {
              lengthPlusZeroPercentage: 'calc(0% + 10px)',
              zeroLengthPlusPercentage: '20%',
              zeroEmPlusPercentage: '20%',
              mixedNonzero: 'calc(20% + 10px)',
              lengthPlusZeroEm: '10px',
            },
            interpolated: {
              start: 'calc(0% + 10px)',
              midpoint: 'calc(10% + 5px)',
              end: '20%',
            },
          }),
        },
      },
    ],
  },
  {
    name: 'checks cancelled percentages in a length-only property',
    engines: ['native'],
    markup: '<div id="cancelled-percentage-oracle"></div>',
    setupPage: async (page) => {
      await page.evaluate(() => {
        const target = document
          .getElementById('cancelled-percentage-oracle') as HTMLElement;
        target.style.setProperty(
          '--oracle',
          String(CSS.supports(
            'border-width',
            'calc(1% / 1% * 10px)',
          )),
        );
      });
    },
    cases: [
      {
        computedStyle: '--oracle',
        ref: { by: 'id', id: 'cancelled-percentage-oracle' },
        browsers: ['chromium', 'webkit'],
        expect: { value: 'true' },
      },
      {
        computedStyle: '--oracle',
        ref: { by: 'id', id: 'cancelled-percentage-oracle' },
        browsers: ['firefox'],
        expect: { value: 'false' },
      },
    ],
  },
]);

runScenarios('CSS declared color serialization oracle', 'normal', [
  {
    name: 'canonicalizes reducible and contextual color math',
    engines: ['native'],
    markup: `
      <style id="color-declared-serialization">
        #p3-reducible {
          color: COLOR( DISPLAY-P3  calc( .1 + .2 )  0  0 );
        }
        #p3-contextual {
          color: COLOR(
            DISPLAY-P3  calc( sign( 1em - 1px ) )  0  0
            / calc( .25 + .25 )
          );
        }
        #hsl-reducible {
          color: HSL( calc( 60deg + 60deg )  100%  50% );
        }
        #hsl-contextual {
          color: HSL( calc( sign( 1em - 1px ) * 120deg )  100%  50% );
        }
        #sign-length {
          width: calc( sign( 1em - 1px ) * 1px );
        }
        #sign-color-constant {
          color: color( display-p3  sign( -1 )  0  0 );
        }
      </style>
    `,
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['chromium', 'firefox'],
        expect: {
          cssom: {
            name: 'color',
            value: 'color(display-p3 0.3 0 0)',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 0, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['webkit'],
        expect: {
          cssom: {
            name: 'color',
            value: 'color(display-p3 calc(0.3) 0 0)',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 1, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['chromium', 'webkit'],
        expect: {
          cssom: {
            name: 'color',
            value: 'color(display-p3 sign(1em - 1px) 0 0 / calc(0.5))',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 1, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['firefox'],
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 2, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        expect: {
          cssom: {
            name: 'color',
            value: 'rgb(0, 255, 0)',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 3, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['chromium', 'webkit'],
        expect: {
          cssom: {
            name: 'color',
            value: 'hsl(calc(120deg * sign(1em - 1px)) 100 50)',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 3, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['firefox'],
        expect: { cssom: null },
      },
      {
        cssom: { target: 'style.property', rule: 4, name: 'width' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        expect: {
          cssom: {
            name: 'width',
            value: 'calc(1px * sign(1em - 1px))',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 5, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['chromium', 'firefox'],
        expect: {
          cssom: {
            name: 'color',
            value: 'color(display-p3 -1 0 0)',
            important: false,
          },
        },
      },
      {
        cssom: { target: 'style.property', rule: 5, name: 'color' },
        ref: { by: 'id', id: 'color-declared-serialization' },
        browsers: ['webkit'],
        expect: {
          cssom: {
            name: 'color',
            value: 'color(display-p3 calc(-1) 0 0)',
            important: false,
          },
        },
      },
    ],
  },
  {
    name: 'distinguishes declared colors from resolved colors',
    engines: ['native'],
    markup: `
      <style id="color-lifecycle">
        #named       { color: ReD; }
        #transparent { color: transparent; }
        #hsl         { color: hsl(120 100% 50%); }
        #lab         { color: lab(50% 40 30); }
        #wide        { color: color(display-p3 1 0 0); }
        #current     { color: currentColor; }
        #border      { color: red; border-color: currentColor; }
      </style>

      <div id="named"></div>
      <div id="transparent"></div>
      <div id="hsl"></div>
      <div id="lab"></div>
      <div id="wide"></div>
      <div style="color: blue"><div id="current"></div></div>
      <div id="border"></div>
    `,
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'color' },
        ref: { by: 'id', id: 'color-lifecycle' },
        expect: {
          cssom: { name: 'color', value: 'red', important: false },
        },
      },
      {
        computedStyle: 'color',
        ref: { by: 'id', id: 'named' },
        expect: { value: 'rgb(255, 0, 0)' },
      },
      {
        cssom: { target: 'style.property', rule: 1, name: 'color' },
        ref: { by: 'id', id: 'color-lifecycle' },
        expect: {
          cssom: { name: 'color', value: 'transparent', important: false },
        },
      },
      {
        computedStyle: 'color',
        ref: { by: 'id', id: 'transparent' },
        expect: { value: 'rgba(0, 0, 0, 0)' },
      },
      {
        cssom: { target: 'style.property', rule: 2, name: 'color' },
        ref: { by: 'id', id: 'color-lifecycle' },
        expect: {
          cssom: { name: 'color', value: 'rgb(0, 255, 0)', important: false },
        },
      },
      {
        computedStyle: 'color',
        ref: { by: 'id', id: 'hsl' },
        expect: { value: 'rgb(0, 255, 0)' },
      },
      {
        cssom: { target: 'style.property', rule: 3, name: 'color' },
        ref: { by: 'id', id: 'color-lifecycle' },
        expect: {
          cssom: { name: 'color', value: 'lab(50 40 30)', important: false },
        },
      },
      {
        computedStyle: 'color',
        ref: { by: 'id', id: 'lab' },
        expect: { value: 'lab(50 40 30)' },
      },
      {
        cssom: { target: 'style.property', rule: 4, name: 'color' },
        ref: { by: 'id', id: 'color-lifecycle' },
        expect: {
          cssom: {
            name: 'color',
            value: 'color(display-p3 1 0 0)',
            important: false,
          },
        },
      },
      {
        computedStyle: 'color',
        ref: { by: 'id', id: 'wide' },
        expect: { value: 'color(display-p3 1 0 0)' },
      },
      {
        cssom: { target: 'style.property', rule: 5, name: 'color' },
        ref: { by: 'id', id: 'color-lifecycle' },
        expect: {
          cssom: { name: 'color', value: 'currentcolor', important: false },
        },
      },
      {
        computedStyle: 'color',
        ref: { by: 'id', id: 'current' },
        expect: { value: 'rgb(0, 0, 255)' },
      },
      {
        cssom: { target: 'style.property', rule: 6, name: 'border-top-color' },
        ref: { by: 'id', id: 'color-lifecycle' },
        expect: {
          cssom: {
            name: 'border-top-color',
            value: 'currentcolor',
            important: false,
          },
        },
      },
      {
        computedStyle: 'border-top-color',
        ref: { by: 'id', id: 'border' },
        expect: { value: 'rgb(255, 0, 0)' },
      },
    ],
  },
]);
