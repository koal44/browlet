import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('not pseudo-class parsing', 'normal', [
  {
    name: ':not() pseudo-class selectors parse',
    // status: 'only',
    markup: `
      <button id="button"></button>
      <foo id="foo"></foo>
      <div id="box" disabled selected></div>
    `,
    cases: [
      { match: 'button:not([disabled])', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: '*:not(foo)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(:link):not(:visited)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: '*|*:not(*)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(:hover)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(*|*)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: 'foo:not(bar)', ref: { by: 'id', id: 'foo' }, expect: { throws: false } },
      { match: ':not(:not(foo))', ref: { by: 'id', id: 'foo' }, expect: { throws: false } },
      { match: ':not(.a .b)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(.a + .b)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(.a .b ~ c)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(span.a, div.b)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(.a .b ~ c, .d .e)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(:host)', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(:host(.a))', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':host(:not(.a))', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not(:host(:not(.a)))', ref: { by: 'id', id: 'button' }, expect: { throws: false } },
      { match: ':not([disabled][selected])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':not([disabled],[selected])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },
  {
    name: 'invalid :not() selectors throw',
    // status: 'only',
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: ':not()', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':not(:not())', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':not(::before)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':not(:unknownpseudo)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':not(.a, :unknownpseudo)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':not(:unknownpseudo, .a)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':host(:not(.a .b))', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
      { match: ':host(:not(.a .b))', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['webkit'], engines: ['native'] },
    ],
  },
]);
