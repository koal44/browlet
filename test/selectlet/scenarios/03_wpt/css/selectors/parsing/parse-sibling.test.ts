import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('sibling combinator parsing', 'normal', [
  {
    name: 'sibling combinators parse',
    // status: 'only',
    markup: `
      <math id="math"></math>
      <p id="paragraph"></p>

      <h1 id="heading" class="opener"></h1>
      <h2 id="subheading"></h2>

      <pre id="preformatted"></pre>
    `,
    cases: [
      { match: 'math + p', ref: { by: 'id', id: 'paragraph' }, expect: { throws: false } },
      { match: 'h1.opener + h2', ref: { by: 'id', id: 'subheading' }, expect: { throws: false } },
      { match: 'h1 ~ pre', ref: { by: 'id', id: 'preformatted' }, expect: { throws: false } },
    ],
  },
]);
