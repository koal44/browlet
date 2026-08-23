import { runScenarios } from '../../../scenario/dispatch';

runScenarios('pseudo-relational', 'normal', [
  {
    name: 'logical has general sibling selector',
    // status: 'only',
    markup: `
      <section>
        <div id="before-1"></div>
        <div id="before-2"></div>
        <div id="target" class="target"></div>
        <div id="false-positive"></div>
        <div id="tail"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(~ .target)', expect: { ids: ['before-1', 'before-2'] } },
    ],
  },

  {
    name: 'logical has adjacent sibling selector',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="b" class="next"></div>
        <div id="c"></div>
        <div id="d"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(+ .next)', expect: { ids: ['a'] } },
    ],
  },

  {
    name: 'logical has relative selector list',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="next" class="next"></div>
        <div id="b"></div>
        <div id="later" class="later"></div>
        <div id="c"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(+ .next, ~ .later)', expect: { ids: ['a', 'next', 'b'] } },
    ],
  },

  {
    name: 'logical has sibling selectors',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="b" class="next"></div>
        <div id="c"></div>
        <div id="d" class="later"></div>
        <div id="e"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(+ .next)', expect: { ids: ['a'] }, debug: false },
      { select: 'div:has(~ .later)', expect: { ids: ['a', 'b', 'c'] } },
    ],
  },

  {
    name: 'logical has nested scope under element context',
    // status: 'only',
    markup: `
      <section id="ctx">
        <div id="a">
          <span class="target"></span>
        </div>
        <div id="b">
          <span>
            <span class="target"></span>
          </span>
        </div>
      </section>
      <div id="outside">
        <span class="target"></span>
      </div>
    `,
    cases: [
      // main.querySelectorAll(':scope .a:has(:scope ~ .c)')
      { select: 'div:has(:scope .target)', ref: { by: 'id', id: 'ctx' }, expect: { ids: [] } },
      { select: 'div:has(:scope > .target)', ref: { by: 'id', id: 'ctx' }, expect: { ids: [] } },
      { select: 'div:has(.target)', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['a', 'b'] } },
      { select: 'div:has(> .target)', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['a'] } },
    ],
  },

  {
    name: 'logical has child relative selector',
    // status: 'only',
    markup: `
      <section>
        <div id="a"><span class="target"></span></div>
        <div id="b"><p><span class="target"></span></p></div>
        <div id="c"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(> .target)', expect: { ids: ['a'] } },
      { select: 'div:has(.target)', expect: { ids: ['a', 'b'] } },
    ],
  },

  {
    name: 'logical has adjacent sibling with compound right side',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="b" class="next target"></div>
        <div id="c"></div>
        <div id="d" class="next"></div>
        <div id="e" class="target"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(+ .next.target)', expect: { ids: ['a'] } },
      { select: 'div:has(+ .next:not(.target))', expect: { ids: ['c'] } },
    ],
  },

  {
    name: 'logical has adjacent sibling with descendant structure',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="b" class="next"><span class="child"></span></div>
        <div id="c"></div>
        <div id="d" class="next"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(+ .next > .child)', expect: { ids: ['a'] } },
      { select: 'div:has(+ .next .child)', expect: { ids: ['a'] } },
    ],
  },

  {
    name: 'logical has general sibling with descendant structure',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="b" class="mid"></div>
        <div id="c" class="later"><span class="child"></span></div>
        <div id="d"></div>
        <div id="e" class="later"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(~ .later > .child)', expect: { ids: ['a', 'b'] } },
      { select: 'div:has(~ .later .child)', expect: { ids: ['a', 'b'] } },
    ],
  },


  {
    name: 'logical has sibling with nested logical selector',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="b" class="next good"></div>
        <div id="c"></div>
        <div id="d" class="next bad"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(+ .next:is(.good))', expect: { ids: ['a'] } },
      { select: 'div:has(+ .next:not(.bad))', expect: { ids: ['a'] } },
    ],
  },

  {
    name: 'logical pseudos preserve quoted attribute arguments',
    // status: 'only',
    markup: `
      <section>
        <div id="a" data-x="a&quot;b"></div>
        <div id="b" data-x="a,b"></div>
        <div id="c" data-x="plain"></div>
      </section>
    `,
    cases: [
      { select: 'div:is([data-x="a,b"])', expect: { ids: ['b'] } },
      { select: 'div:not([data-x="a,b"])', expect: { ids: ['a', 'c'] } },
      { select: 'div:has(+ [data-x="a,b"])', expect: { ids: ['a'] } },
    ],
  },

  {
    name: 'logical has selector list with nested comma',
    // status: 'only',
    markup: `
      <section>
        <div id="a"></div>
        <div id="b" class="next good"></div>
        <div id="c"></div>
        <div id="d" class="later alt"></div>
      </section>
    `,
    cases: [
      { select: 'div:has(+ .next:is(.good, .other), ~ .later)', expect: { ids: ['a', 'b', 'c'] } },
    ],
  },

  {
    name: 'logical has explicit scope follows native behavior',
    // status: 'only',
    markup: `
      <section id="ctx">
        <div id="a"><span class="target"></span></div>
        <div id="b"><span><span class="target"></span></span></div>
      </section>
    `,
    cases: [
      { select: 'div:has(.target)', expect: { ids: ['a', 'b'] } },
      { select: 'div:has(> .target)', expect: { ids: ['a'] } },
      { select: 'div:has(:scope .target)', expect: { ids: [] } },
      { select: 'div:has(:scope > .target)', expect: { ids: [] } },
    ],
  },

  {
    name: 'has/relative-selector-boundaries',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <section class="a" id="outside-a">
        <div id="leaky-anchor">
          <div id="leaky-child">
            <span id="leaky-b" class="b"></span>
          </div>
        </div>
      </section>

      <div id="desc-true">
        <section id="desc-a" class="a">
          <span id="desc-b" class="b"></span>
        </section>
      </div>

      <div id="child-desc-true">
        <section id="child-desc-a" class="a">
          <span id="child-desc-b" class="b"></span>
        </section>
      </div>

      <div id="child-desc-false">
        <section>
          <div id="nested-a" class="a">
            <span id="nested-b" class="b"></span>
          </div>
        </section>
      </div>

      <div id="child-sibling-true">
        <span id="child-sibling-a" class="a"></span>
        <span id="child-sibling-b" class="b"></span>
      </div>

      <div id="child-sibling-false">
        <section>
          <span id="nested-sibling-a" class="a"></span>
          <span id="nested-sibling-b" class="b"></span>
        </section>
      </div>

      <div id="child-general-sibling-true">
        <span id="general-a" class="a"></span>
        <i></i>
        <span id="general-b" class="b"></span>
      </div>

      <div id="sibling-anchor"></div>
      <div id="sibling-next" class="next">
        <span id="sibling-next-deep" class="deep"></span>
      </div>
      <div id="sibling-after" class="after"></div>

      <div id="sibling-chain-anchor"></div>
      <div id="sibling-chain-a" class="a"></div>
      <div id="sibling-chain-b" class="b">
        <span id="sibling-chain-c" class="c"></span>
      </div>

      <div id="no-sibling-anchor">
        <div class="next">
          <span class="deep"></span>
        </div>
      </div>

      <div id="nested-pseudo-true">
        <section id="nested-pseudo-a" class="a ok">
          <span id="nested-pseudo-b" class="b" data-x="a>b"></span>
        </section>
      </div>

      <div id="nested-pseudo-false">
        <section id="nested-pseudo-bad-a" class="a bad">
          <span id="nested-pseudo-bad-b" class="b" data-x="a>b"></span>
        </section>
      </div>

      <div id="multi-true">
        <section class="x"></section>
      </div>

      <div id="multi-true-child">
        <section class="y"></section>
      </div>

      <div id="multi-false">
        <section class="z"></section>
      </div>
    `,
    cases: [
      // Boundary/leakage: outside .a must not satisfy :has(.a .b).
      { select: '#leaky-anchor:has(.a .b)', expect: { count: 0 } },
      { select: '#desc-true:has(.a .b)', expect: { ids: ['desc-true'] } },

      // Child then descendant: .a must be a direct child, .b may be below that .a.
      { select: '#child-desc-true:has(> .a .b)', expect: { ids: ['child-desc-true'] } },
      { select: '#child-desc-false:has(> .a .b)', expect: { count: 0 } },
      { select: '#child-desc-false:has(.a .b)', expect: { ids: ['child-desc-false'] } },

      // Child then adjacent/general sibling: after consuming ">", the +/~ relation is between children.
      { select: '#child-sibling-true:has(> .a + .b)', expect: { ids: ['child-sibling-true'] } },
      { select: '#child-sibling-false:has(> .a + .b)', expect: { count: 0 } },
      { select: '#child-sibling-false:has(.a + .b)', expect: { ids: ['child-sibling-false'] } },
      { select: '#child-general-sibling-true:has(> .a ~ .b)', expect: { ids: ['child-general-sibling-true'] } },

      // Leading sibling combinators escape the anchor subtree.
      { select: '#sibling-anchor:has(+ .next)', expect: { ids: ['sibling-anchor'] } },
      { select: '#sibling-anchor:has(+ .next .deep)', expect: { ids: ['sibling-anchor'] } },
      { select: '#sibling-anchor:has(~ .after)', expect: { ids: ['sibling-anchor'] } },
      { select: '#no-sibling-anchor:has(+ .next)', expect: { count: 0 } },
      { select: '#no-sibling-anchor:has(.next .deep)', expect: { ids: ['no-sibling-anchor'] } },

      // Multiple sibling steps, then descendant.
      { select: '#sibling-chain-anchor:has(+ .a + .b .c)', expect: { ids: ['sibling-chain-anchor'] } },
      { select: '#sibling-chain-anchor:has(+ .a + .b > .c)', expect: { ids: ['sibling-chain-anchor'] } },

      // Parser-splitting traps: combinator characters inside attributes/pseudos are not top-level has steps.
      { select: '#nested-pseudo-true:has(.a:not(.bad) > .b[data-x="a>b"])', expect: { ids: ['nested-pseudo-true'] } },
      { select: '#nested-pseudo-false:has(.a:not(.bad) > .b[data-x="a>b"])', expect: { count: 0 } },

      // Selector list inside :has. Both branches are relative to the anchor.
      { select: '#multi-true:has(.x, > .y)', expect: { ids: ['multi-true'] } },
      { select: '#multi-true-child:has(.x, > .y)', expect: { ids: ['multi-true-child'] } },
      { select: '#multi-false:has(.x, > .y)', expect: { count: 0 } },
    ],
  },

  {
    name: 'has/match-subject-behavior',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <div id="m-root">
        <span id="m-a" class="a"></span>
        <span id="m-b" class="b">
          <i id="m-c" class="c"></i>
        </span>
      </div>
    `,
    cases: [
      { match: '.a + .b', ref: { by: 'id', id: 'm-a' }, expect: { count: 0 } },
      { match: '.a + .b', ref: { by: 'id', id: 'm-b' }, expect: { count: 1 } },
      { match: '.a + .b .c', ref: { by: 'id', id: 'm-b' }, expect: { count: 0 } },
      { match: '.a + .b .c', ref: { by: 'id', id: 'm-c' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'is/complex-inner-arm-preserves-subject-constraints',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <div id="is-root">
        <section id="is-same-parent" class="a">
          <h1 id="is-target" lang="tr"></h1>
        </section>

        <section id="is-extra-generation">
          <div id="is-child-a" class="a">
            <h1 id="is-wrong-depth" lang="tr"></h1>
          </div>
        </section>

        <article id="is-article" class="a">
          <h1 id="is-wrong-parent-tag" lang="tr"></h1>
        </article>
      </div>
    `,
    cases: [
      { select: 'section > [lang="tr"]:is(.a > h1)', expect: { ids: ['is-target'] } },
      { first: 'section > [lang="tr"]:is(.a > h1)', expect: { ids: ['is-target'] } },
      { match: 'section > [lang="tr"]:is(.a > h1)', ref: { by: 'id', id: 'is-target' }, expect: { count: 1 } },
      { match: 'section > [lang="tr"]:is(.a > h1)', ref: { by: 'id', id: 'is-wrong-depth' }, expect: { count: 0 } },
      { match: 'section > [lang="tr"]:is(.a > h1)', ref: { by: 'id', id: 'is-wrong-parent-tag' }, expect: { count: 0 } },
    ],
  },

  {
    name: 'is/where-rightmost-subject-expansion-semantics',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <div id="iw-root">
        <h1 id="iw-h1" lang="tr"></h1>
        <h2 id="iw-h2" lang="tr"></h2>
        <h3 id="iw-h3"></h3>
        <p id="iw-p" lang="tr"></p>

        <section id="iw-section-a" class="a">
          <h1 id="iw-sec-h1" lang="tr"></h1>
          <h2 id="iw-sec-h2" lang="tr"></h2>
        </section>

        <section id="iw-section-b" class="b">
          <h1 id="iw-sec-b-h1" lang="tr"></h1>
        </section>

        <div id="iw-wrapper">
          <section id="iw-nested-section" class="a">
            <div id="iw-nested-a" class="a">
              <h1 id="iw-too-deep" lang="tr"></h1>
            </div>
          </section>
        </div>

        <div id="iw-data" data-x>
          <h1 id="iw-data-h1"></h1>
        </div>
      </div>
    `,
    cases: [
      { select: ':is(h1, h2)', expect: { ids: ['iw-h1', 'iw-h2', 'iw-sec-h1', 'iw-sec-h2', 'iw-sec-b-h1', 'iw-too-deep', 'iw-data-h1'] } },
      { select: ':where(h1, h2)', expect: { ids: ['iw-h1', 'iw-h2', 'iw-sec-h1', 'iw-sec-h2', 'iw-sec-b-h1', 'iw-too-deep', 'iw-data-h1'] } },
      { select: '[lang="tr"]:is(h1, h2)', expect: { ids: ['iw-h1', 'iw-h2', 'iw-sec-h1', 'iw-sec-h2', 'iw-sec-b-h1', 'iw-too-deep'] } },
      { select: 'section > [lang="tr"]:is(h1, h2)', expect: { ids: ['iw-sec-h1', 'iw-sec-h2', 'iw-sec-b-h1'] } },
      { select: '[lang="tr"]:is(.a > h1, .a > h2)', expect: { ids: ['iw-sec-h1', 'iw-sec-h2', 'iw-too-deep'] } },
      { select: 'section > [lang="tr"]:is(.a > h1, .a > h2)', expect: { ids: ['iw-sec-h1', 'iw-sec-h2'] } },
      { select: 'section > [lang="tr"]:is(.a > h1)', expect: { ids: ['iw-sec-h1'] } },
    ],
  },

  {
    name: 'is/where-lifted-seed-preserves-residual-inner-tests',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <div id="lr-root">
        <section id="lr-section" class="a">
          <h1 id="lr-hit-role" lang="tr" role="x"></h1>
          <h1 id="lr-miss-role" lang="tr" role="y"></h1>
          <h2 id="lr-hit-class" lang="tr" class="ok"></h2>
          <h2 id="lr-miss-class" lang="tr"></h2>
        </section>
        <section id="lr-section-b" class="b">
          <h1 id="lr-hit-b" lang="tr" role="y"></h1>
        </section>
        <div id="lr-too-deep-wrap" class="a">
          <div id="lr-too-deep-parent">
            <h1 id="lr-too-deep" lang="tr" role="x"></h1>
          </div>
        </div>
      </div>
    `,
    cases: [
      { select: 'section > [lang="tr"]:is(.a > h1[role="x"], .b > h1[role="y"])', expect: { ids: ['lr-hit-role', 'lr-hit-b'] } },
      { select: 'section > [lang="tr"]:is(.a > h2.ok)', expect: { ids: ['lr-hit-class'] } },
      { match: 'section > [lang="tr"]:is(.a > h1[role="x"])', ref: { by: 'id', id: 'lr-hit-role' }, expect: { count: 1 } },
      { match: 'section > [lang="tr"]:is(.a > h1[role="x"])', ref: { by: 'id', id: 'lr-miss-role' }, expect: { count: 0 } },
      { match: 'section > [lang="tr"]:is(.a > h1[role="x"])', ref: { by: 'id', id: 'lr-too-deep' }, expect: { count: 0 } },
    ],
  },

  {
    name: 'is/where-lifted-seed-incompatible-tag-arms',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <div id="tag-conflict-root">
        <div id="tag-div" class="foo" lang="tr"></div>
        <span id="tag-span" class="foo" lang="tr"></span>
        <div id="tag-div-bar" class="bar" lang="tr"></div>
        <span id="tag-span-bar" class="bar" lang="tr"></span>
      </div>
    `,
    cases: [
      { select: 'div:is(span.foo)', expect: { ids: [] } },
      { select: 'span:is(div.foo)', expect: { ids: [] } },

      { select: 'div:is(div.foo, span.foo)', expect: { ids: ['tag-div'] } },
      { select: 'span:is(div.foo, span.foo)', expect: { ids: ['tag-span'] } },

      { select: 'div:where(span.foo)', expect: { ids: [] } },
      { select: 'div:where(div.foo, span.foo)', expect: { ids: ['tag-div'] } },
    ],
  },

  {
    name: 'is/where-lifted-seed-incompatible-tag-arms-with-host-filters',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <div id="host-filter-root">
        <div id="hf-div-hit" class="foo" lang="tr"></div>
        <div id="hf-div-miss-lang" class="foo" lang="en"></div>
        <span id="hf-span-foo" class="foo" lang="tr"></span>
        <div id="hf-div-bar" class="bar" lang="tr"></div>
      </div>
    `,
    cases: [
      { select: 'div[lang="tr"]:is(span.foo, div.foo)', expect: { ids: ['hf-div-hit'] } },
      { select: 'div[lang="tr"]:is(span.foo)', expect: { ids: [] } },
      { select: '[lang="tr"]:is(span.foo, div.foo)', expect: { ids: ['hf-div-hit', 'hf-span-foo'] } },
      { select: 'DIV:is(div.foo)', expect: { ids: ['hf-div-hit', 'hf-div-miss-lang'] } },
      { select: 'div[lang="tr"]:where(span.foo, div.foo)', expect: { ids: ['hf-div-hit'] } },
    ],
  },

  {
    name: 'element context must not hide ancestor proof outside context',
    // status: 'only',
    markup: `
      <div id="outer" class="bar">
        <div id="mid-outside" class="mid">
          <div id="inner">
            <div id="outer" class="bar">
              <div id="mid-inside" class="mid">
                <span id="inside-x" class="x"></span>
              </div>
            </div>

            <span id="outer-x" class="x"></span>
          </div>
        </div>
      </div>
    `,
    cases: [
      { select: '#outer.bar > .mid .x', ref: { by: 'id', id: 'inner' }, expect: { ids: ['inside-x', 'outer-x'] } },
    ],
  },

]);
