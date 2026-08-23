import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('is and where pseudo-class parsing', 'normal', [
  {
    name: ':is() parsing',
    // status: 'only',
    markup: `
      <div id="box" attr="value"></div>
      <bar id="bar"></bar>
    `,
    cases: [
      { match: ':is(div )', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':is(div + bar, div ~ .baz)', ref: { by: 'id', id: 'bar' }, expect: { throws: false } },

      { match: ':is(:is(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':is(:where(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':host(:is(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':host(:is(div ))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':host(:is(div .foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':is(:hover, :active)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':is(div):hover', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':is(div)::before', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':is(::before)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':is(div) + bar', ref: { by: 'id', id: 'bar' }, expect: { throws: false } },
      { match: '::part(foo):is(:hover)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):is([attr="value"])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':not(:is(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':not(:is(div .foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },
  {
    name: ':where() parsing',
    // status: 'only',
    markup: `
      <div id="box" attr="value"></div>
      <bar id="bar"></bar>
    `,
    cases: [
      { match: ':where(div )', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':where(div + bar, div ~ .baz)', ref: { by: 'id', id: 'bar' }, expect: { throws: false } },

      { match: ':where(:is(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':where(:where(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':host(:where(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':host(:where(div ))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':host(:where(div .foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':where(:hover, :active)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':where(div):hover', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':where(div)::before', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':where(::before)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':where(div) + bar', ref: { by: 'id', id: 'bar' }, expect: { throws: false } },
      { match: '::part(foo):where(:hover)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):where([attr="value"])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

      { match: ':not(:where(div))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':not(:where(div .foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },

  {
    name: 'invalid :is() and :where() selectors throw',
    status: 'skip',
    engines: ['native'],
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: ':is(# C4єанйтж╕/┘ГЁжЮХєа▓┐ЁЭБМєаСеЁЭЖА%=[ямм0)', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['chromium', 'webkit'], engines: ['native'] },
      { match: ':is(# C4єанйтж╕/┘ГЁжЮХєа▓┐ЁЭБМєаСеЁЭЖА%=[ямм0)', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['firefox'], engines: ['native'] },
    ],
  },

  // {
  //   name: ':is() malformed arm probes',
  //   // status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <div id="box"></div>
  //   `,
  //   cases: [
  //     // Original WPT case.
  //     // Divergence: Firefox throws; Chromium/WebKit forgive it.
  //     { match: ':is(# C4єанйтж╕/┘ГЁжЮХєа▓┐ЁЭБМєаСеЁЭЖА%=[ямм0)', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['chromium', 'webkit'] },
  //     { match: ':is(# C4єанйтж╕/┘ГЁжЮХєа▓┐ЁЭБМєаСеЁЭЖА%=[ямм0)', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['firefox'] },

  //     // Space after ID hash: forgiven everywhere.
  //     { match: ':is(# foo)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ':is(# foo, div)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

  //     // Delims similar to the original, without the bracket: forgiven everywhere.
  //     { match: ':is(# foo/)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ':is(# foo%)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ':is(# foo=bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

  //     // Bracket-ish cases: forgiven everywhere.
  //     { match: ':is([foo)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ':is([foo])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ':is([foo=bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ':is([foo=bar])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

  //     // Unmatched closing delimiters.
  //     // Divergence: Firefox throws; Chromium/WebKit forgive them.
  //     { match: ':is(foo])', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['chromium', 'webkit'] },
  //     { match: ':is(foo])', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['firefox'] },

  //     { match: ':is(foo})', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['chromium', 'webkit'] },
  //     { match: ':is(foo})', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['firefox'] },

  //     { match: ':is(foo[)', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['chromium', 'webkit'] },
  //     { match: ':is(foo[)', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['firefox'] },

  //     { match: ':is(=[)', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['chromium', 'webkit'] },
  //     { match: ':is(=[)', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['firefox'] },

  //     // Function/pseudo body truncation probes: forgiven everywhere.
  //     { match: ':is(:not(.a)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ':is(:not(.a, div)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

  //     // Bad string-ish probes: forgiven everywhere.
  //     { match: ':is([foo="bar])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //     { match: ":is([foo='bar])", ref: { by: 'id', id: 'box' }, expect: { throws: false } },

  //     // Control: invalid arm is forgiven when followed by valid arm.
  //     { match: ':is(123, div)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
  //   ],
  // },

]);
