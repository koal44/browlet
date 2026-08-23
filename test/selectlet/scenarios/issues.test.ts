import { runScenarios } from '../../scenario/dispatch';

runScenarios('issues', 'normal',  [
  {
    name: 'issue 160 adjacent-descendant regression',
    // status: 'only',
    markup: `
      <div>
        <div class="neighbor"></div>
        <div>
          <a>
            <img class="target">
          </a>
        </div>
      </div>
    `,
    cases: [
      { select: '.neighbor + div .target', expect: { count: 1 } },
      { select: '.neighbor + * .target', expect: { count: 1 } },
    ],
  },
]);
