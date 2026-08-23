import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('has-slotted pseudo-class parsing', 'normal', [
  {
    name: ':has-slotted pseudo-class selectors parse',
    status: 'skip',
    markup: `
      <div id="box" attr="foo" class="class"></div>
      <div id="sibling"></div>
    `,
    cases: [
      { match: ':has-slotted(bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted([attr="foo"])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(*)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(.class)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(#id)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(:not(foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(:not(:nth-last-of-type(2)):not([slot="foo"]))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(:first-child)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(:hover)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(foo):first-child', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(foo):hover', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(foo):focus', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(foo):lang(en)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(foo):dir(ltr)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(foo) + :has-slotted(bar)', ref: { by: 'id', id: 'sibling' }, expect: { throws: false } },
      { match: ':not(:has-slotted(foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(div + div)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted(div:has(> span))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has-slotted', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },
  {
    name: 'invalid :has-slotted selectors throw',
    status: 'skip',
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: '::has-slotted(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':has-slotted()', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':has-slotted(0)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':has-slotted(div > span)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
    ],
  },
]);
