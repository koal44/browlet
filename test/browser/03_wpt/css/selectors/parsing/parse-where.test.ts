import { runScenarios } from '../../../../../dispatch';

runScenarios('where pseudo-class parsing', 'normal', [
  {
    name: ':where() pseudo-class selectors parse',
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
      { match: ':where(ul,ol,.list) > [hidden]', ref: { by: 'id', id: 'hidden-item' }, expect: { throws: false } },
      { match: ':where(:hover,:focus)', ref: { by: 'id', id: 'anchor' }, expect: { throws: false } },
      { match: 'a:where(:not(:hover))', ref: { by: 'id', id: 'anchor' }, expect: { throws: false } },

      { match: ':where(#a)', ref: { by: 'id', id: 'a' }, expect: { throws: false } },
      { match: '.a.b ~ :where(.c.d ~ .e.f)', ref: { by: 'id', id: 'right' }, expect: { throws: false } },
      { match: '.a.b ~ .c.d:where(span.e + .f, .g.h > .i.j .k)', ref: { by: 'id', id: 'middle' }, expect: { throws: false } },
    ],
  },
]);
