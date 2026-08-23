import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('is pseudo-class parsing', 'normal', [
  {
    name: ':is() pseudo-class selectors parse',
    // status: 'only',
    markup: `
      <ul id="list">
        <li id="hidden-item" hidden></li>
      </ul>

      <a id="anchor"></a>

      <div id="a"></div>

      <div id="left" class="a b"></div>
      <div id="middle" class="c d"></div>
      <div id="right" class="e f"></div>

      <span id="span" class="c d e"></span>
      <div id="span-adjacent" class="f"></div>

      <div id="parent" class="g h">
        <div class="i j">
          <div id="descendant" class="k"></div>
        </div>
      </div>
    `,
    cases: [
      { match: ':is(ul,ol,.list) > [hidden]', ref: { by: 'id', id: 'hidden-item' }, expect: { throws: false } },
      { match: ':is(:hover,:focus)', ref: { by: 'id', id: 'anchor' }, expect: { throws: false } },
      { match: 'a:is(:not(:hover))', ref: { by: 'id', id: 'anchor' }, expect: { throws: false } },

      { match: ':is(#a)', ref: { by: 'id', id: 'a' }, expect: { throws: false } },
      { match: '.a.b ~ :is(.c.d ~ .e.f)', ref: { by: 'id', id: 'right' }, expect: { throws: false } },
      { match: '.a.b ~ .c.d:is(span.e + .f, .g.h > .i.j .k)', ref: { by: 'id', id: 'middle' }, expect: { throws: false } },
    ],
  },
]);
