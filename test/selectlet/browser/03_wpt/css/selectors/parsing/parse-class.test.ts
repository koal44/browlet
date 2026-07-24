import { runScenarios } from '../../../../../dispatch';

runScenarios('class selector parsing', 'normal', [
  {
    name: 'class selectors parse',
    // status: 'only',
    markup: `
      <div id="pastoral-div" class="pastoral"></div>
      <h1 id="pastoral-heading" class="pastoral"></h1>
      <p id="pastoral-marine-paragraph" class="pastoral marine"></p>
    `,
    cases: [
      { match: '*.pastoral', ref: { by: 'id', id: 'pastoral-div' }, expect: { ids: ['pastoral-div'] } },
      { match: '.pastoral', ref: { by: 'id', id: 'pastoral-div' }, expect: { ids: ['pastoral-div'] } },
      { match: 'h1.pastoral', ref: { by: 'id', id: 'pastoral-heading' }, expect: { ids: ['pastoral-heading'] } },
      { match: 'p.pastoral.marine', ref: { by: 'id', id: 'pastoral-marine-paragraph' }, expect: { ids: ['pastoral-marine-paragraph'] } },
    ],
  },
]);
