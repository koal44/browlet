import { runScenarios } from '../../../../../scenario/dispatch';

runScenarios('is where', 'normal', [
  {
    name: 'wpt basic is where matching behavior',
    // status: 'only',
    markup: `
      <main id="main">
        <div id="a"><div id="d"></div></div>
        <div id="b"><div id="e"></div></div>
        <div id="c"><div id="f"></div></div>
      </main>
    `,
    cases: [
      { select: ':is()', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':is(#a)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a'] } },
      { select: ':is(#a, #f)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'f'] } },
      { select: ':is(#a, #c) :where(#a #d, #c #f)', ref: { by: 'id', id: 'main' }, expect: { ids: ['d', 'f'] } },
      { select: '#c > :is(#c > #f)', ref: { by: 'id', id: 'main' }, expect: { ids: ['f'] } },
      { select: '#c > :is(#b > #f)', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: '#a div:is(#d)', ref: { by: 'id', id: 'main' }, expect: { ids: ['d'] } },
      { select: ':is(div) > div', ref: { by: 'id', id: 'main' }, expect: { ids: ['d', 'e', 'f'] } },
      { select: ':is(*) > div', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'd', 'b', 'e', 'c', 'f'] } },
      { select: ':is(*) div', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'd', 'b', 'e', 'c', 'f'] } },
      { select: 'div > :where(#e, #f)', ref: { by: 'id', id: 'main' }, expect: { ids: ['e', 'f'] } },
      { select: 'div > :where(*)', ref: { by: 'id', id: 'main' }, expect: { ids: ['d', 'e', 'f'] } },
      { select: ':is(*) > :where(*)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'd', 'b', 'e', 'c', 'f'] } },
      { select: ':is(#a + #b) + :is(#c)', ref: { by: 'id', id: 'main' }, expect: { ids: ['c'] } },
      { select: ':is(#a, #b) + div', ref: { by: 'id', id: 'main' }, expect: { ids: ['b', 'c'] } },

      { select: ':is(,)', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':is(', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':is(#a,)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a'] } },
      { select: ':is(#a,', ref: { by: 'id', id: 'main' }, expect: { ids: ['a'] } },
      { select: ':is(#a,,#b)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'b'] } },
      { select: ':where(,)', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':where(#a,)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a'] } },
      { select: ':where(#a,,#b)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'b'] } },
    ],
  },

  {
    name: 'wpt forgiving is where empty and malformed arms oracle',
    // status: 'only',
    markup: `
      <main id="main">
        <div id="a"></div>
        <div id="b"></div>
      </main>
    `,
    cases: [
      { select: ':is()', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':where()', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':is(,)', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':where(,)', ref: { by: 'id', id: 'main' }, expect: { ids: [] } },
      { select: ':is(#a,)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a'] } },
      { select: ':where(#a,)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a'] } },
      { select: ':is(#a,, #b)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'b'] } },
      { select: ':where(#a,, #b)', ref: { by: 'id', id: 'main' }, expect: { ids: ['a', 'b'] } },
      { select: ':not()', ref: { by: 'id', id: 'main' }, expect: { throws: true } },
      { select: ':has(> )', ref: { by: 'id', id: 'main' }, expect: { throws: true } },
      { select: ':has(+ )', ref: { by: 'id', id: 'main' }, expect: { throws: true } },
    ],
  },
]);
