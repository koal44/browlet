import { runScenarios } from '../../../../../dispatch';

runScenarios('slotted pseudo-element parsing', 'normal', [
  {
    name: '::slotted() pseudo-element selectors parse',
    // status: 'only',
    markup: `
      <div id="box" attr="foo" class="class"></div>
    `,
    cases: [
      { match: '::slotted(bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted([attr="foo"])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted(*)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted(.class)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted(:not(foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted(:not(:nth-last-of-type(2)):not([slot="foo"]))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted(:first-child)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted(:hover)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::slotted(:has(:first-child:last-child))', ref: { by: 'id', id: 'box' }, expect: { throws: true }, browsers: ['chromium'], engines: ['native'] },
      { match: '::slotted(:has(:first-child:last-child))', ref: { by: 'id', id: 'box' }, expect: { throws: false }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

    ],
  },
  {
    name: 'invalid ::slotted() selectors throw',
    // status: 'only',
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: '::slotted', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted()', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(0)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':slotted(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(foo):first-child', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(foo):hover', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(foo):focus', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(foo):lang(en)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(foo):dir(ltr)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(foo) + ::slotted(bar)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::slotted(foo), .foo', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':hover::slotted(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },

    ],
  },
]);
