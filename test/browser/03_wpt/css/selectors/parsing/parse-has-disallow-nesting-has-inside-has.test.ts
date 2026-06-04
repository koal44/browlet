import { runScenarios } from '../../../../../dispatch';

runScenarios('has pseudo-class parsing', 'normal', [
  {
    name: ':has() cannot be nested inside :has()',
    // status: 'only',
    markup: `
      <div id="box" class="a">
        <div class="b">
          <div class="c"></div>
        </div>
        <script id="script"></script>
      </div>
    `,
    cases: [
      // Unforgiving :has() sees nested :has() directly, so invalid selector.
      { match: '.a:has(.b:has(.c))', ref: { by: 'id', id: 'box' }, expect: { throws: true } },

      // Valid selector, no match. :is/:where forgiving-list drops the invalid nested :has(*) arm,
      // leaving an empty forgiving pseudo that matches nothing.
      { match: ':has(:is(:has(*)))', ref: { by: 'id', id: 'box' }, expect: { throws: false, ids: [] }, debug: false },
      { match: ':has(:where(:has(*)))', ref: { by: 'id', id: 'box' }, expect: { throws: false, ids: [] } },

      // Valid and matches because the script arm survives forgiving parsing.
      { match: ':has(:is(:has(*), script))', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: ':has(:where(:has(*), script))', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
    ],
  },
]);
