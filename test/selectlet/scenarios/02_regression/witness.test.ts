import { runScenarios } from '../../../scenario/dispatch';

runScenarios('witness', 'normal', [
  {
    name: 'element context still proves selector outside context',
    // status: 'only',
    markup: `
      <div id="outer" class="outer">
        <section id="ctx">
          <span id="hit" class="hit"></span>
        </section>
      </div>

      <section id="other">
        <span id="miss" class="hit"></span>
      </section>
    `,
    cases: [
      { select: '.outer .hit', expect: { ids: ['hit'] } },
      { select: '.outer .hit', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['hit'] } },
      { select: '.outer .hit', expect: { ids: ['hit'] } },

      { first: '.outer .hit', expect: { ids: ['hit'] } },
      { first: '.outer .hit', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['hit'] } },
      { first: '.outer .hit', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'entry bridge can skip leading unseedable selector parts',
    // status: 'only',
    markup: `
      <div id="first">
        <span id="hit" class="target"></span>
      </div>

      <div id="second">
        <span id="miss" class="target"></span>
      </div>
    `,
    cases: [
      { select: 'div:first-child .target', expect: { ids: ['hit'] } },
      { first: 'div:first-child .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'nested witnesses bridge instead of unsafe multi-witness advance',
    // status: 'only',
    markup: `
      <div id="outer" class="a">
        <span id="before" class="x"></span>

        <section id="inner" class="a">
          <span id="inside" class="x"></span>
        </section>

        <span id="after" class="x"></span>
      </div>
    `,
    cases: [
      { select: '.a > .x', expect: { ids: ['before', 'inside', 'after'] } },
      { first: '.a > .x', expect: { ids: ['before'] } },
    ],
  },

  {
    name: 'selector-list witness arms merge and dedupe document order',
    // status: 'only',
    markup: `
      <div id="outer" class="outer">
        <span id="hit" class="hit"></span>
      </div>

      <span id="sibling" class="hit"></span>
    `,
    cases: [
      { select: '.hit, .outer .hit', expect: { ids: ['hit', 'sibling'] } },
      { select: '.outer .hit, .hit', expect: { ids: ['hit', 'sibling'] } },

      { first: '.hit, .outer .hit', expect: { ids: ['hit'] } },
      { first: '.outer .hit, .hit', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'singleton advances then bridge after descendant boundary',
    // status: 'only',
    markup: `
      <div id="box0" class="box"></div>
      <div id="box1" class="box"></div>
      <div id="box2" class="box">
        <section class="inner">
          <span id="hit" class="target"></span>
        </section>
      </div>

      <section class="inner">
        <span id="miss" class="target"></span>
      </section>
    `,
    cases: [
      { select: '.box:first-child ~ .box + .box .inner .target', expect: { ids: ['hit'] }, debug: false },
      { first: '.box:first-child ~ .box + .box .inner .target', expect: { ids: ['hit'] }, debug: false },
    ],
  },

  {
    name: 'bridge landing before sibling edge does not narrow lookup root',
    // status: 'only',
    markup: `
      <div id="scope">
        <div id="left" class="left"></div>
        <div id="noise"></div>
        <div id="mid" class="mid"></div>
        <span id="hit" class="target"></span>
      </div>

      <div id="outside-mid" class="mid"></div>
      <span id="miss" class="target"></span>
    `,
    cases: [
      { select: '.left ~ .mid + .target', expect: { ids: ['hit'] } },
      { first: '.left ~ .mid + .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'bridge landing before general sibling edge does not narrow lookup root',
    // status: 'only',
    markup: `
      <div id="scope">
        <div id="left" class="left"></div>
        <div id="mid" class="mid"></div>
        <em></em>
        <span id="hit" class="target"></span>
      </div>

      <div id="outside-mid" class="mid"></div>
      <span id="miss" class="target"></span>
    `,
    cases: [
      { select: '.left ~ .mid ~ .target', expect: { ids: ['hit'] } },
      { first: '.left ~ .mid ~ .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'bridge can skip unseedable sibling step inside narrowed ancestor root',
    // status: 'only',
    markup: `
      <div id="scope" class="scope">
        <span id="first"></span>
        <span id="hit" class="target"></span>
      </div>

      <span id="outside-first"></span>
      <span id="miss" class="target"></span>
    `,
    cases: [
      { select: '.scope :first-child + .target', expect: { ids: ['hit'] } },
      { first: '.scope :first-child + .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'id bridge target still proves skipped left relation',
    // status: 'only',
    markup: `
      <div class="left"></div>
      <div class="mid">
        <span id="good"></span>
      </div>

      <div class="left"></div>
      <div class="wrong"></div>
      <span id="bad"></span>
    `,
    cases: [
      { select: '.left + .mid #good', expect: { ids: ['good'] } },
      { select: '.left + .mid #bad', expect: { ids: [] } },

      { first: '.left + .mid #good', expect: { ids: ['good'] } },
      { first: '.left + .mid #bad', expect: { ids: [] } },
    ],
  },

  {
    name: 'id lookup still proves residual compound tests',
    // status: 'only',
    markup: `
      <div class="left"></div>
      <span id="hit" class="target"></span>

      <div class="left"></div>
      <span id="miss"></span>
    `,
    cases: [
      { select: '.left + #hit.target', expect: { ids: ['hit'] } },
      { select: '.left + #miss.target', expect: { ids: [] } },

      { first: '.left + #hit.target', expect: { ids: ['hit'] } },
      { first: '.left + #miss.target', expect: { ids: [] } },
    ],
  },

  {
    name: 'class lookup with multiple classes requires all class seeds',
    // status: 'only',
    markup: `
      <div id="scope">
        <span id="hit" class="a b"></span>
        <span id="miss-a" class="a"></span>
        <span id="miss-b" class="b"></span>
      </div>
    `,
    cases: [
      { select: '#scope .a.b', expect: { ids: ['hit'] } },
      { first: '#scope .a.b', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'tag lookup still proves residual class and pseudo tests',
    // status: 'only',
    markup: `
      <div id="scope">
        <span id="first" class="target"></span>
        <span id="second" class="target"></span>
        <span id="miss"></span>
      </div>
    `,
    cases: [
      { select: '#scope span.target:first-child', expect: { ids: ['first'] } },
      { first: '#scope span.target:first-child', expect: { ids: ['first'] } },
    ],
  },

  {
    name: 'class lookup rejects escaped whitespace class names',
    // status: 'only',
    markup: `
      <div id="scope">
        <span id="a" class="foo"></span>
        <span id="b" class="bar"></span>
      </div>
    `,
    cases: [
      { select: '#scope .foo\\ bar', expect: { ids: [] } },
      { first: '#scope .foo\\ bar', expect: { ids: [] } },
    ],
  },

  {
    name: 'entry bridge preserves child versus descendant relation',
    // status: 'only',
    markup: `
      <div id="scope" class="scope">
        <span id="direct"></span>

        <div>
          <span id="nested"></span>
        </div>
      </div>
    `,
    cases: [
      { select: '.scope > #direct', expect: { ids: ['direct'] } },
      { select: '.scope > #nested', expect: { ids: [] } },
      { select: '.scope #nested', expect: { ids: ['nested'] } },

      { first: '.scope > #direct', expect: { ids: ['direct'] } },
      { first: '.scope > #nested', expect: { ids: [] } },
      { first: '.scope #nested', expect: { ids: ['nested'] } },
    ],
  },

  {
    name: 'bridge from multi-witness parents uses direct child relation',
    // status: 'only',
    markup: `
      <div class="parent">
        <span id="hit" class="target"></span>
      </div>

      <div class="parent">
        <div>
          <span id="miss" class="target"></span>
        </div>
      </div>
    `,
    cases: [
      { select: '.parent > .target', expect: { ids: ['hit'] } },
      { first: '.parent > .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'bridge from multi-witness siblings uses adjacent relation',
    // status: 'only',
    markup: `
      <div class="left"></div>
      <span id="hit-a" class="target"></span>

      <div class="left"></div>
      <em></em>
      <span id="miss-gap" class="target"></span>

      <div class="left"></div>
      <span id="hit-b" class="target"></span>
    `,
    cases: [
      { select: '.left + .target', expect: { ids: ['hit-a', 'hit-b'] } },
      { first: '.left + .target', expect: { ids: ['hit-a'] } },
    ],
  },

  {
    name: 'bridge from multi-witness siblings uses parent-local general sibling relation',
    // status: 'only',
    markup: `
      <div id="group-a">
        <div class="left"></div>
        <em></em>
        <span id="hit-a" class="target"></span>
      </div>

      <section id="group-b">
        <div class="left"></div>
        <span id="hit-b" class="target"></span>
      </section>

      <article id="group-c">
        <span id="miss-no-left-sibling" class="target"></span>
      </article>

      <div class="left"></div>
      <article id="group-d">
        <span id="miss-left-in-previous-parent" class="target"></span>
      </article>
    `,
    cases: [
      { select: '.left ~ .target', expect: { ids: ['hit-a', 'hit-b'] } },
      { first: '.left ~ .target', expect: { ids: ['hit-a'] } },
    ],
  },

  {
    name: 'bridge descendant chain keeps searching after partial left failure',
    // status: 'only',
    markup: `
      <div class="scope">
        <div class="parent">
          <span id="bad"></span>
        </div>

        <div class="grand">
          <div class="parent">
            <span id="good"></span>
          </div>
        </div>
      </div>
    `,
    cases: [
      { select: '.scope .grand .parent #good', expect: { ids: ['good'] } },
      { select: '.scope .grand .parent #bad', expect: { ids: [] } },

      { first: '.scope .grand .parent #good', expect: { ids: ['good'] } },
      { first: '.scope .grand .parent #bad', expect: { ids: [] } },
    ],
  },

  {
    name: 'bridge predicate adjacent relation is exact',
    // status: 'only',
    markup: `
      <div class="a"></div>
      <div class="b">
        <span id="hit" class="target"></span>
      </div>

      <div class="a"></div>
      <em></em>
      <div class="b">
        <span id="miss-gap" class="target"></span>
      </div>
    `,
    cases: [
      { select: '.a + .b .target', expect: { ids: ['hit'] } },
      { first: '.a + .b .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'bridge predicate general sibling keeps scanning after partial failure',
    // status: 'only',
    markup: `
      <div class="a"></div>
      <div class="b"></div>
      <em></em>
      <div class="b"></div>
      <span id="hit" class="target"></span>

      <section>
        <div class="b"></div>
        <span id="miss-no-left-chain" class="target"></span>
      </section>
    `,
    cases: [
      { select: '.a + .b ~ .target', expect: { ids: ['hit'] } },
      { first: '.a + .b ~ .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'bridge predicate descendant keeps searching after partial ancestor failure',
    // status: 'only',
    markup: `
      <div class="grand">
        <div class="parent">
          <div class="parent">
            <span id="hit" class="target"></span>
          </div>
        </div>
      </div>

      <div class="parent">
        <div class="parent">
          <span id="miss-no-grand" class="target"></span>
        </div>
      </div>
    `,
    cases: [
      { select: '.grand > .parent .target', expect: { ids: ['hit'] } },
      { first: '.grand > .parent .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'bridge predicate parent relation is direct only',
    // status: 'only',
    markup: `
      <div class="grand">
        <div class="parent">
          <span id="hit" class="target"></span>
          <div>
            <span id="miss-nested" class="target"></span>
          </div>
        </div>
      </div>
    `,
    cases: [
      { select: '.grand > .parent > .target', expect: { ids: ['hit'] } },
      { first: '.grand > .parent > .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'unseedable final bridge after multi-witness descendant',
    // status: 'only',
    markup: `
      <div id="box0" class="box"></div>
      <div id="box1" class="box"></div>
      <div id="box2" class="box">
        <section class="inner">
          <span id="hit-a" foo></span>
        </section>
        <section class="inner">
          <span id="hit-b" foo></span>
        </section>
        <section class="inner">
          <span id="miss-no-attr"></span>
        </section>
      </div>

      <section class="inner">
        <span id="miss-outside" foo></span>
      </section>
    `,
    cases: [
      { select: '.box:first-child ~ .box + .box .inner [foo]', expect: { ids: ['hit-a', 'hit-b'] }, debug: false },
      { first: '.box:first-child ~ .box + .box .inner [foo]', expect: { ids: ['hit-a'] }, debug: false },
    ],
  },

  {
    name: 'unseedable descendant bridge does not duplicate through nested witnesses',
    // status: 'only',
    markup: `
      <div id="scope" class="scope">
        <section class="inner">
          <section class="inner">
            <span id="hit" foo></span>
          </section>
        </section>

        <span id="miss-outside-inner" foo></span>
      </div>
    `,
    cases: [
      { select: '.scope .inner [foo]', expect: { ids: ['hit'] } },
      { first: '.scope .inner [foo]', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'first selector-list uses document order not arm order',
    // status: 'only',
    markup: `
      <div id="early" class="b"></div>
      <div id="late" class="a"></div>
    `,
    cases: [
      { first: '.a, .b', expect: { ids: ['early'] } },
      { first: '.b, .a', expect: { ids: ['early'] } },
    ],
  },

  {
    name: 'first element context still proves selector outside context',
    // status: 'only',
    markup: `
      <div id="outer" class="outer">
        <section id="ctx">
          <span id="hit" class="hit"></span>
        </section>
      </div>

      <section id="other">
        <span id="miss" class="hit"></span>
      </section>
    `,
    cases: [
      { first: '.outer .hit', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'first witness preserves lookup root across sibling edges',
    // status: 'only',
    markup: `
      <div id="box0" class="box"></div>
      <div id="box1" class="box"></div>
      <div id="box2" class="box">
        <section class="inner">
          <span id="hit" class="target"></span>
        </section>
      </div>

      <section class="inner">
        <span id="miss" class="target"></span>
      </section>
    `,
    cases: [
      { first: '.box:first-child ~ .box + .box .inner .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'first unseedable final bridge stays inside proved witness chain',
    // status: 'only',
    markup: `
      <div id="box0" class="box"></div>
      <div id="box1" class="box"></div>
      <div id="box2" class="box">
        <section class="inner">
          <span id="hit-a" foo></span>
        </section>
        <section class="inner">
          <span id="hit-b" foo></span>
        </section>
      </div>

      <section class="inner">
        <span id="miss-outside" foo></span>
      </section>
    `,
    cases: [
      { first: '.box:first-child ~ .box + .box .inner [foo]', expect: { ids: ['hit-a'] } },
    ],
  },

  {
    name: 'first compares witness arms after pseudo expansion',
    // status: 'only',
    markup: `
      <h2 id="early" class="title"></h2>
      <h1 id="late" class="title"></h1>
    `,
    cases: [
      { first: ':is(h1, h2).title', expect: { ids: ['early'] } },
    ],
  },

  {
    name: 'first ignores empty earlier selector-list arms',
    // status: 'only',
    markup: `
      <div id="hit" class="target"></div>
    `,
    cases: [
      { first: '.missing, .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'first final bridge beats unsafe multi-witness terminal advance',
    // status: 'only',
    markup: `
      <div id="outer" class="a">
        <div id="inner" class="a">
          <span id="early" class="x"></span>
        </div>

        <span id="late" class="x"></span>
      </div>
    `,
    cases: [
      // If first naively advanced from the first .a witness (#outer), it would
      // return #late. Correct first is #early, from the nested .a witness.
      { first: '.a > .x', expect: { ids: ['early'] } },
    ],
  },

  {
    name: 'first terminal following-sibling advance returns first sibling only',
    // status: 'only',
    markup: `
      <div id="start"></div>
      <em></em>
      <span id="hit-a" class="target"></span>
      <span id="hit-b" class="target"></span>
    `,
    cases: [
      { first: '#start ~ .target', expect: { ids: ['hit-a'] } },
    ],
  },

  {
    name: 'first start bridge short-circuits final subject',
    // status: 'only',
    markup: `
      <span id="hit-a" foo></span>
      <span id="hit-b" foo></span>
    `,
    cases: [
      { first: '[foo]', expect: { ids: ['hit-a'] } },
    ],
  },

  {
    name: 'first terminal child advance is direct-only',
    // status: 'only',
    markup: `
      <div id="parent">
        <div>
          <span id="miss-nested" class="target"></span>
        </div>

        <span id="hit" class="target"></span>
      </div>
    `,
    cases: [
      { first: '#parent > .target', expect: { ids: ['hit'] } },
    ],
  },

  {
    name: 'first terminal adjacent advance is exact',
    // status: 'only',
    markup: `
      <div id="start"></div>
      <em></em>
      <span id="miss-gap" class="target"></span>
    `,
    cases: [
      { first: '#start + .target', expect: { ids: [] } },
    ],
  },

  {
    name: 'first terminal following-sibling advance is parent-local',
    // status: 'only',
    markup: `
      <section>
        <div id="start"></div>
      </section>

      <span id="miss-outside-parent" class="target"></span>
    `,
    cases: [
      { first: '#start ~ .target', expect: { ids: [] } },
    ],
  },

  {
    name: 'first final bridge skips earlier failing final candidates',
    // status: 'only',
    markup: `
      <span id="miss-before" class="target"></span>

      <div class="left"></div>
      <span id="hit-a" class="target"></span>

      <div class="left"></div>
      <span id="hit-b" class="target"></span>
    `,
    cases: [
      { first: '.left ~ .target', expect: { ids: ['hit-a'] } },
    ],
  },

  {
    name: 'first final bridge beats unsafe nested witness advance',
    // status: 'only',
    markup: `
      <div id="outer" class="a">
        <div id="inner" class="a">
          <span id="early" class="x"></span>
        </div>

        <span id="late" class="x"></span>
      </div>
    `,
    cases: [
      { first: '.a > .x', expect: { ids: ['early'] } },
    ],
  },

]);
