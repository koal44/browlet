import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('descendant combinator parsing', 'normal', [
  {
    name: 'descendant combinators parse',
    // status: 'only',
    markup: `
      <h1 id="heading">
        <em id="emphasis"></em>
      </h1>

      <div id="container">
        <section>
          <p id="paragraph"></p>
        </section>

        <p>
          <a id="link" href="https://example.com"></a>
        </p>
      </div>
    `,
    cases: [
      { match: 'h1 em', ref: { by: 'id', id: 'emphasis' }, expect: { ids: ['emphasis'] } },
      { match: 'div * p', ref: { by: 'id', id: 'paragraph' }, expect: { ids: ['paragraph'] } },
      { match: 'div p *[href]', ref: { by: 'id', id: 'link' }, expect: { ids: ['link'] } },
    ],
  },
]);
