import { runScenarios } from '../../../scenario/dispatch';

runScenarios('attributes', 'normal', [
  {
    name: 'first returns earliest document-order match across selector arms',
    // status: 'only',
    markup: `
      <div id="early" class="b"></div>
      <div id="late" class="a"></div>
    `,
    cases: [
      { first: '.a, .b', expect: { ids: ['early'] } },
    ],
  },
]);
