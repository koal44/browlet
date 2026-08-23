import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('has pseudo-class forgiving parsing', 'normal', [
  {
    name: ':has() allows invalid nested :has() inside forgiving selectors',
    // status: 'only',
    markup: `
      <div id="box">
        <div class="a"></div>
      </div>
    `,
    cases: [
      { match: ':has(:is(:has(*)))', ref: { by: 'id', id: 'box' }, expect: { ids: [] } },
      { match: ':has(:where(:has(*)))', ref: { by: 'id', id: 'box' }, expect: { ids: [] } },
      { match: ':has(:is(.a, 123))', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
    ],
  },
]);
