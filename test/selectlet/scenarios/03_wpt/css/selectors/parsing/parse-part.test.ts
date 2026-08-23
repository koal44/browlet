import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('part pseudo-element parsing', 'normal', [
  {
    name: '::part() pseudo-element selectors parse',
    // status: 'only',
    markup: `
      <div id="box" lang="en" dir="ltr" disabled checked></div>
    `,
    cases: [
      { match: '::part(--foo)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(--)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(--0)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(-foo bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):focus', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):hover', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):focus-within', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo)::before', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo)::after', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo)::placeholder', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo)::first-line', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo)::first-letter', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo)::file-selector-button', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):is(:focus)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':lang(en)::part(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':dir(ltr)::part(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):lang(en)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):dir(ltr)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):disabled', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):checked', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },
  {
    name: 'invalid ::part() selectors throw',
    // status: 'only',
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: ':part()', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':part(0)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ":part('foo')", ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':part([foo])', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::part(foo) + ::part(bar)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
    ],
  },
  {
    name: '::part() selectors with forgiving :is() and :where() parse',
    // status: 'only',
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: '::part(foo):is(ul)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):is(nav ul)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):where(ul)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(foo):where(nav ul)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },
  {
    name: 'invalid ::part() selector with :has() throws',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: '::part(foo):has(li)', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
      { match: '::part(foo):has(li)', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['webkit'], engines: ['native'] },
      { match: '::part(foo) + :has(li)', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
    ],
  },
]);
