import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('has pseudo-class parsing', 'normal', [
  {
    name: ':has() pseudo-class selectors parse',
    // status: 'only',
    markup: `
      <div id="box" class="a" a="b">
        <a id="anchor"></a>
        <div id="a" class="a b c">
          <div class="c">
            <div class="d"></div>
          </div>
          <div class="e"></div>
        </div>
      </div>
    `,
    cases: [
      { match: ':has(a)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has(#a)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has(.a)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has([a])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has([a="b"])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has([a|="b"])', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has(:hover)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '*:has(.a)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:has(.b)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:has(> .b)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:has(~ .b)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:has(+ .b)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:has(.b) .c', ref: { by: 'id', id: 'a' }, expect: { throws: false } },
      { match: '.a .b:has(.c)', ref: { by: 'id', id: 'a' }, expect: { throws: false } },
      { match: '.a .b:has(.c .d)', ref: { by: 'id', id: 'a' }, expect: { throws: false } },
      { match: '.a .b:has(.c .d) .e', ref: { by: 'id', id: 'a' }, expect: { throws: false } },
      { match: '.a:has(.b:is(.c .d))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:is(.b:has(.c) .d)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:not(:has(.b))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:has(:not(.b))', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '.a:has(.b):has(.c)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: '*|*:has(*)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
      { match: ':has(*|*)', ref: { by: 'id', id: 'box' }, expect: { throws: false } },
    ],
  },
  {
    name: 'invalid :has() selectors throw',
    // status: 'only',
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: ':has', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '.a:has', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: '.a:has b', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':has()', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':has(123)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
      { match: ':has(.a, 123)', ref: { by: 'id', id: 'box' }, expect: { throws: true } },
    ],
  },
]);
