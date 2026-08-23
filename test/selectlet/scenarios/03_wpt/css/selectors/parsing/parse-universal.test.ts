import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('universal selector parsing', 'normal', [
  {
    name: 'universal selectors parse',
    // status: 'only',
    markup: `
      <div id="container">
        <p id="paragraph"></p>
      </div>
    `,
    cases: [
      { match: '*', ref: { by: 'id', id: 'paragraph' }, expect: { throws: false } },
      { match: 'div :first-child', ref: { by: 'id', id: 'paragraph' }, expect: { throws: false } },
      { match: 'div *:first-child', ref: { by: 'id', id: 'paragraph' }, expect: { throws: false } },
    ],
  },
]);
