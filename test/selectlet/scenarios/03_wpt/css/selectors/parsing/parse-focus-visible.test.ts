import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('focus-visible pseudo-class parsing', 'normal', [
  {
    name: ':focus-visible pseudo-class parses',
    // status: 'only',
    markup: `
      <a id="link" href="https://example.com"></a>
    `,
    cases: [
      { match: ':focus-visible', ref: { by: 'id', id: 'link' }, expect: { ids: [] } },
      { match: 'a:focus-visible', ref: { by: 'id', id: 'link' }, expect: { ids: [] } },
      { match: ':focus:not(:focus-visible)', ref: { by: 'id', id: 'link' }, expect: { ids: [] } },
    ],
  },
]);
