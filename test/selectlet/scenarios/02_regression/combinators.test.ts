import { runScenarios } from '../../../scenario/dispatch';

runScenarios('combinators', 'normal', [
  {
    name: 'general sibling combinator traversal',
    // status: 'only',
    markup: `
      <div id="root">
        <div id="a1" class="a"></div>
        <div id="a2" class="a"></div>
        <span id="once" class="x"></span>

        <div id="b1" class="b"></div>
        <span id="chain-1" class="x"></span>

        <div id="b2" class="b"></div>
        <span id="chain-2" class="x"></span>

        <section>
          <span id="nested" class="x"></span>
          <div class="a"></div>
        </section>
      </div>
    `,
    cases: [
      // Two previous .a siblings should not duplicate the same right-hand match.
      { select: '.a ~ #once', expect: { ids: ['once'] } },

      // The nested .a is not a sibling of outer .x elements; the outer .a siblings
      // are not siblings of #nested.
      { select: '.a ~ .x', expect: { ids: ['once', 'chain-1', 'chain-2'] } },

      // Chained sibling walks must restore the candidate after each inner scan.
      { select: '.a ~ .b ~ .x', expect: { ids: ['chain-1', 'chain-2'] } },
    ],
  },

  {
    name: 'compiled combinator traversal',
    // status: 'only',
    markup: `
      <div id="root" class="a">
        <section id="section" class="a">
          <article id="article">
            <span id="deep" class="x"></span>
          </article>

          <span id="section-child" class="x"></span>
        </section>

        <span id="root-child" class="x"></span>
        <div id="self" class="x"></div>

        <div id="sib-a1" class="sib-a"></div>
        <div id="sib-a2" class="sib-a"></div>
        <span id="general-sibling" class="sib-x"></span>

        <div id="adj-a" class="adj-a"></div>
        <span id="adjacent" class="adj-x"></span>
        <em id="gap"></em>
        <span id="not-adjacent" class="adj-x"></span>
      </div>
    `,
    cases: [
      // Descendant: multiple matching ancestors should not duplicate #deep.
      { select: '.a .x', expect: { ids: ['deep', 'section-child', 'root-child', 'self'] } },

      // Descendant does not include the candidate itself as its own ancestor.
      { select: '.x .x', expect: { ids: [] } },

      // Child: only the immediate parent is checked.
      { select: '.a > .x', expect: { ids: ['section-child', 'root-child', 'self'] } },
      { select: '#root > #deep', expect: { ids: [] } },

      // General sibling: multiple matching previous siblings should not duplicate.
      { select: '.sib-a ~ .sib-x', expect: { ids: ['general-sibling'] } },

      // Adjacent sibling: only the immediately preceding element is checked.
      { select: '.adj-a + .adj-x', expect: { ids: ['adjacent'] } },

      // Chained combinators must restore candidate state across inner checks.
      { select: '#root > .a > .x', expect: { ids: ['section-child'] } },
      { select: '.a ~ .sib-a + .sib-x', expect: { ids: ['general-sibling'] } },
    ],
  },

  {
    name: 'match descendant short-circuit keeps searching after partial left failure',
    // status: 'only',
    markup: `
      <div class="grand">
        <div class="x">
          <div class="parent">
            <span id="hit" class="target"></span>
          </div>
        </div>
      </div>
      <div class="parent">
        <span id="miss" class="target"></span>
      </div>
    `,
    cases: [
      { match: '.grand .parent .target', ref: { by: 'id', id: 'hit' }, expect: { count: 1 } },
      { match: '.grand .parent .target', ref: { by: 'id', id: 'miss' }, expect: { count: 0 } },
    ],
  },

  {
    name: 'match general sibling short-circuit after full left match only',
    markup: `
      <div id="box">
        <i class="grand"></i>
        <b class="noise"></b>
        <i class="left"></i>
        <span id="hit" class="target"></span>
        <span id="miss" class="target"></span>
      </div>
    `,
    cases: [
      { match: '.grand ~ .left ~ .target', ref: { by: 'id', id: 'hit' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'match general sibling short-circuit full chain',
    markup: `
      <div>
        <i class="grand"></i>
        <i class="left"></i>
        <span id="hit" class="target"></span>
      </div>
      <div>
        <i class="left"></i>
        <span id="miss" class="target"></span>
      </div>
    `,
    cases: [
      { match: '.grand ~ .left ~ .target', ref: { by: 'id', id: 'hit' }, expect: { count: 1 } },
      { match: '.grand ~ .left ~ .target', ref: { by: 'id', id: 'miss' }, expect: { count: 0 } },
    ],
  },

]);
