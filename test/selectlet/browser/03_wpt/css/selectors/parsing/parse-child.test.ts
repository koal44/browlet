import { runScenarios } from '../../../../../dispatch';

runScenarios('child combinator parsing', 'normal', [
  {
    name: 'child combinators parse',
    // status: 'only',
    markup: `
      <p id="body-child"></p>

      <div id="container">
        <ol>
          <li>
            <p id="nested-paragraph"></p>
          </li>
        </ol>
      </div>
    `,
    cases: [
      { match: 'body > p', ref: { by: 'id', id: 'body-child' }, expect: { ids: ['body-child'] } },
      { match: 'div ol>li p', ref: { by: 'id', id: 'nested-paragraph' }, expect: { ids: ['nested-paragraph'] } },
    ],
  },
]);
