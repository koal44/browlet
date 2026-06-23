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
        cssom: { kind: 'declaration', name: 'margin-left' },
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
        cssom: { kind: 'declaration', name: 'background' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { kind: 'declaration', name: 'background-color' },
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
        cssom: { kind: 'declaration', name: 'margin-left' },
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
        cssom: { kind: 'declarations', rule: 0 },
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
        cssom: { kind: 'rules' },
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
        cssom: { kind: 'rules' },
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
        cssom: { kind: 'declaration', name: 'margin-left' },
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
        cssom: { kind: 'declaration', name: 'margin-left' },
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
        cssom: { kind: 'declaration', name: 'font-family' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'font-family', value: '"x;y"', important: false },
        },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
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
        cssom: { kind: 'declaration', name: 'margin-top' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '2px', important: false },
        },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-right' },
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
        cssom: { kind: 'rules' },
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
        cssom: { kind: 'declaration', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-right', value: '5px', important: false },
        },
      },
      {
        cssom: { kind: 'declaration', name: 'font-family' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-top' },
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
        cssom: { kind: 'declaration', name: 'margin-right' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-right', value: '5px', important: false },
        },
      },
      {
        cssom: { kind: 'declaration', name: 'font-family' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
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
        cssom: { kind: 'declaration', name: 'background-image' },
        ref: { by: 'id', id: 'sheet' },
        expect: { throws: true },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
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
