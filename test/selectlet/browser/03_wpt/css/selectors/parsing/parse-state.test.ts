import { runScenarios } from '../../../../../dispatch';

runScenarios('custom state pseudo-class parsing', 'normal', [
  {
    name: ':state() pseudo-class selectors parse',
    // status: 'only',
    markup: `
      <my-input id="input" type="foo"></my-input>
      <div id="box"></div>
    `,
    cases: [
      { match: ':state(--foo)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':state(bar)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':state(--)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':state(--0)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':host(:state(--foo))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: 'my-input[type="foo"]:state(checked)', ref: { by: 'id', id: 'input' }, expect: { throws: false } },
      { match: 'my-input[type="foo"]:state(--0)::before', ref: { by: 'id', id: 'input' }, expect: { throws: false } },
      { match: 'my-input[type="foo"]:state(--0)::part(inner)', ref: { by: 'id', id: 'input' }, expect: { throws: false } },
      { match: 'my-input[type="foo"]:state(--0)::part(inner):state(bar)', ref: { by: 'id', id: 'input' }, expect: { throws: false } },
      { match: '::part(inner):state(bar)::before', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '::part(inner):state(bar)::after', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },
  {
    name: 'invalid :state() selectors throw',
    // status: 'only',
    markup: `
      <my-input id="input"></my-input>
      <div id="box"></div>
    `,
    cases: [
      { match: ':state', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':state(', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':state()', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':state(0)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':state(0rem)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':state(url())', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':state(foo(1))', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':state(:host)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: 'my-input::after:state(foo)', ref: { by: 'id', id: 'input' }, expect: { throws: true } },
      { match: '::part(inner):state(bar)::before:state(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '::part(inner):state(bar)::after:state(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: 'my-input::first-letter:state(foo)', ref: { by: 'id', id: 'input' }, expect: { throws: true } },
      { match: '::slotted(foo):state(foo)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
    ],
  },
]);
