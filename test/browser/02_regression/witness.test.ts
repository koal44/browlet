import { runScenarios } from '../../dispatch';

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
    ],
  },

]);
