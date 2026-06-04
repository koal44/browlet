import { runScenarios } from '../../../../../dispatch';

runScenarios('id selector parsing', 'normal', [
  {
    name: 'id selectors parse',
    // status: 'only',
    markup: `
      <h1 id="chapter1"></h1>
      <div id="z98y"></div>
    `,
    cases: [
      { match: 'h1#chapter1', ref: { by: 'id', id: 'chapter1' }, expect: { throws: false } },
      { match: '#chapter1', ref: { by: 'id', id: 'chapter1' }, expect: { throws: false } },
      { match: '*#z98y', ref: { by: 'id', id: 'z98y' }, expect: { throws: false } },
    ],
  },
]);
