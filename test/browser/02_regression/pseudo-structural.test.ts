import { runScenarios } from '../../dispatch';

runScenarios('pseudo-structural', 'normal', [
  {
    name: 'nth selector caches reset between select calls',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="a"></span>
        <span id="b"></span>
        <span id="c"></span>
      </div>
    `,
    steps: [
      {
        cases: [
          { select: '#root > span:nth-child(2)', expect: { ids: ['b'] } },
          { select: '#root > span:nth-of-type(2)', expect: { ids: ['b'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            const root = document.getElementById('root')!;
            const x = document.createElement('span');
            x.id = 'x';
            root.insertBefore(x, root.firstElementChild);
          });
        },
        cases: [
          // Current span order: x, a, b, c
          { select: '#root > span:nth-child(2)', expect: { ids: ['a'] } },
          { select: '#root > span:nth-of-type(2)', expect: { ids: ['a'] } },
        ],
      },
    ],
  },

  {
    name: 'root and empty structural pseudo-classes',
    // status: 'only',
    markup: `
      <div id="empty"></div>
      <div id="comment"><!-- comment --></div>
      <div id="text"> </div>
      <div id="child"><span></span></div>
      <div id="marked" class="x">not empty</div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        document.documentElement.id = 'html-root';
      });
    },
    cases: [
      { select: ':root, .x', expect: { ids: ['html-root', 'marked'] } },
      { select: '.x, :root', expect: { ids: ['html-root', 'marked'] } },
      { select: 'div:empty', expect: { ids: ['empty', 'comment'] } },
    ],
  },

  {
    name: 'child-indexed structural pseudo-classes',
    // status: 'only',
    markup: `
      <div id="single">
        text before
        <!-- comment before -->
        <span id="only"></span>
        <!-- comment after -->
        text after
      </div>

      <div id="multi">
        text before
        <span id="first"></span>
        <!-- comment between -->
        text between
        <span id="middle"></span>
        <span id="last"></span>
        text after
      </div>
    `,
    cases: [
      // Text and comment nodes do not count as element siblings.
      { select: 'span:only-child', expect: { ids: ['only'] } },
      { select: 'span:first-child', expect: { ids: ['only', 'first'] } },
      { select: 'span:last-child', expect: { ids: ['only', 'last'] } },

      // Element siblings do count.
      { select: '#middle:first-child', expect: { ids: [] } },
      { select: '#middle:last-child', expect: { ids: [] } },
      { select: '#middle:only-child', expect: { ids: [] } },
    ],
  },

  {
    name: 'of-type structural pseudo-classes distinguish XML namespaces',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root xmlns:a="http://example/a" xmlns:b="http://example/b">
        <a:item id="a-first" class="x" />
        <b:item id="b-first" class="x" />
        <a:item id="a-last" class="x" />
        <b:item id="b-last" class="x" />
      </root>
    `,
    cases: [
      // Same localName, different namespaceURI: these should be different types.
      { select: '*|item:first-of-type', expect: { ids: ['a-first', 'b-first'] } },
      { select: '*|item:last-of-type', expect: { ids: ['a-last', 'b-last'] } },
      { select: '*|item:only-of-type', expect: { ids: [] } },
    ],
  },

  {
    name: 'of-type structural pseudo-classes',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="span-first"></span>
        <em id="em-only"></em>
        <span id="span-last"></span>
      </div>
    `,
    cases: [
      { select: 'span:first-of-type', expect: { ids: ['span-first'] } },
      { select: 'span:last-of-type', expect: { ids: ['span-last'] } },
      { select: 'em:only-of-type', expect: { ids: ['em-only'] } },
    ],
  },

  {
    name: 'nth-of-type distinguishes XML namespaces',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root xmlns:a="http://example/a" xmlns:b="http://example/b">
        <a:item id="a-first" class="x" />
        <b:item id="b-first" class="x" />
        <a:item id="a-last" class="x" />
        <b:item id="b-last" class="x" />
      </root>
    `,
    cases: [
      { select: '*|item:nth-of-type(1)', expect: { ids: ['a-first', 'b-first'] } },
      { select: '*|item:nth-last-of-type(1)', expect: { ids: ['a-last', 'b-last'] } },
      { select: '*|item:nth-of-type(2)', expect: { ids: ['a-last', 'b-last'] } },
      { select: '*|item:nth-last-of-type(2)', expect: { ids: ['a-first', 'b-first'] } },
    ],
  },

  {
    name: 'nth pseudo-class arguments are ASCII case-insensitive',
    // status: 'only',
    markup: `
      <div>
        <span id="one"></span>
        <span id="two"></span>
        <span id="three"></span>
      </div>
    `,
    cases: [
      { select: 'span:nth-child(odd)', expect: { ids: ['one', 'three'] } },
      { select: 'span:nth-child(ODD)', expect: { ids: ['one', 'three'] } },
      { select: 'span:nth-child(EVEN)', expect: { ids: ['two'] } },
      { select: 'span:nth-child(2N+1)', expect: { ids: ['one', 'three'] } },
    ],
  },

  {
    name: 'nth pseudo-class zero-step arguments',
    // status: 'only',
    markup: `
      <div>
        <span id="one"></span>
        <span id="two"></span>
        <span id="three"></span>
        <span id="four"></span>
        <span id="five"></span>
      </div>
    `,
    cases: [
      { select: 'span:nth-child(0n+2)', expect: { ids: ['two'] } },
      { select: 'span:nth-child(+0n+2)', expect: { ids: ['two'] } },
      { select: 'span:nth-child(-0n+2)', expect: { ids: ['two'] } },
      { select: 'span:nth-child(0n)', expect: { ids: [] } },
      { select: 'span:nth-child(0n-1)', expect: { ids: [] } },

      { select: 'span:nth-child(2n0)', expect: { throws: true } },
      { select: 'span:nth-child(2n+0)', expect: { ids: ['two', 'four'] } },
      { select: 'span:nth-child(2n)', expect: { ids: ['two', 'four'] } },
      { select: 'span:nth-child(2n1)', expect: { throws: true } },
      { select: 'span:nth-child(2n+1)', expect: { ids: ['one', 'three', 'five'] } },
      { select: 'span:nth-child(1n2)', expect: { throws: true } },
      { select: 'span:nth-child(1+2n)', expect: { throws: true } },
      { select: 'span:nth-child(n1)', expect: { throws: true } },
      { select: 'span:nth-child(n+1)', expect: { ids: ['one', 'two', 'three', 'four', 'five'] } },
      { select: 'span:nth-child(2n+)', expect: { throws: true } },
      { select: 'span:nth-child()', expect: { throws: true } },
    ],
  },

  {
    name: 'nth pseudo-class rejects reversed an+b syntax',
    // status: 'only',
    markup: `
      <div>
        <span id="one"></span>
        <span id="two"></span>
      </div>
    `,
    cases: [
      { select: 'span:nth-child(n+1)', expect: { ids: ['one', 'two'] } },
      { select: 'span:nth-child(1+n)', expect: { throws: true } },
    ],
  },

  {
    name: 'match nth-child cleanup runs after successful match',
    // status: 'only',
    markup: `
      <ul id="list">
        <li id="a"></li>
        <li id="b"></li>
        <li id="c"></li>
      </ul>
    `,
    steps: [
      {
        cases: [
          // Successful match is the important part: current early return skips nth cleanup.
          { match: ':nth-child(3)', ref: { by: 'id', id: 'c' }, expect: { count: 1 } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            const list = document.getElementById('list')!;
            const a = document.getElementById('a')!;
            const c = document.getElementById('c')!;
            list.insertBefore(c, a);
          });
        },
        cases: [
          // Order is now c, a, b.
          { match: ':nth-child(1)', ref: { by: 'id', id: 'c' }, expect: { count: 1 } },
          { match: ':nth-child(3)', ref: { by: 'id', id: 'c' }, expect: { count: 0 } },
        ],
      },
    ],
  },

  {
    name: 'match nth-of-type cleanup runs after successful match',
    // status: 'only',
    markup: `
      <div id="list">
        <i id="a"></i>
        <span id="noise"></span>
        <i id="b"></i>
        <i id="c"></i>
      </div>
    `,
    steps: [
      {
        cases: [
          // Among <i> siblings, c is initially third.
          { match: ':nth-of-type(3)', ref: { by: 'id', id: 'c' }, expect: { count: 1 } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            const list = document.getElementById('list')!;
            const a = document.getElementById('a')!;
            const c = document.getElementById('c')!;
            list.insertBefore(c, a);
          });
        },
        cases: [
          // Among <i> siblings, c is now first.
          { match: ':nth-of-type(1)', ref: { by: 'id', id: 'c' }, expect: { count: 1 } },
          { match: ':nth-of-type(3)', ref: { by: 'id', id: 'c' }, expect: { count: 0 } },
        ],
      },
    ],
  },

  {
    name: 'template fragment top-level nth match pseudos',
    // status: 'only',
    markup: `
      <template id="frag-template">
        <i id="top-i1"></i>
        <span id="top-span1"></span>
        <i id="top-i2"></i>
        <i id="top-i3"></i>
      </template>
    `,
    cases: [
      { match: ':nth-child(1)', ref: { by: 'id', id: 'top-i1', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-child(2)', ref: { by: 'id', id: 'top-span1', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-child(3)', ref: { by: 'id', id: 'top-i2', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },

      { match: ':nth-of-type(1)', ref: { by: 'id', id: 'top-i1', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-of-type(1)', ref: { by: 'id', id: 'top-span1', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-of-type(2)', ref: { by: 'id', id: 'top-i2', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-of-type(3)', ref: { by: 'id', id: 'top-i3', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },

      { match: ':nth-last-child(1)', ref: { by: 'id', id: 'top-i3', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-last-of-type(1)', ref: { by: 'id', id: 'top-i3', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
    ],
  },

  {
    name: 'nth structural pseudos cover local and cached helper paths',
    // status: 'only',
    markup: `
      <div id="root">
        <ul id="list">
          <li id="li1"></li>
          <li id="li2"></li>
          <li id="li3"></li>
          <li id="li4"></li>
          <li id="li5"></li>
        </ul>

        <div id="typed">
          <i id="i1"></i>
          <span id="s1"></span>
          <i id="i2"></i>
          <span id="s2"></span>
          <i id="i3"></i>
        </div>

        <template id="frag-template">
          <i id="top-i1"></i>
          <span id="top-s1"></span>
          <i id="top-i2"></i>
          <i id="top-i3"></i>
        </template>
      </div>
    `,
    cases: [
      // MATCH: exact integer path, h === null, local isNthElement/isNthOfType.
      { match: ':nth-child(3)', ref: { by: 'id', id: 'li3' }, expect: { count: 1 } },
      { match: ':nth-child(3)', ref: { by: 'id', id: 'li4' }, expect: { count: 0 } },
      { match: ':nth-last-child(2)', ref: { by: 'id', id: 'li4' }, expect: { count: 1 } },
      { match: ':nth-last-child(2)', ref: { by: 'id', id: 'li3' }, expect: { count: 0 } },

      { match: ':nth-of-type(2)', ref: { by: 'id', id: 'i2' }, expect: { count: 1 } },
      { match: ':nth-of-type(2)', ref: { by: 'id', id: 'i3' }, expect: { count: 0 } },
      { match: ':nth-last-of-type(1)', ref: { by: 'id', id: 'i3' }, expect: { count: 1 } },
      { match: ':nth-last-of-type(1)', ref: { by: 'id', id: 'i2' }, expect: { count: 0 } },

      // MATCH: formula path, h === null, local nthElement/nthOfType.
      { match: ':nth-child(odd)', ref: { by: 'id', id: 'li3' }, expect: { count: 1 } },
      { match: ':nth-child(even)', ref: { by: 'id', id: 'li3' }, expect: { count: 0 } },
      { match: ':nth-child(2n+1)', ref: { by: 'id', id: 'li5' }, expect: { count: 1 } },
      { match: ':nth-child(2n)', ref: { by: 'id', id: 'li4' }, expect: { count: 1 } },

      { match: ':nth-of-type(odd)', ref: { by: 'id', id: 'i3' }, expect: { count: 1 } },
      { match: ':nth-of-type(even)', ref: { by: 'id', id: 'i3' }, expect: { count: 0 } },

      // SELECT: exact integer path, h exists, cached isNthElement/isNthOfType.
      { select: '#list > li:nth-child(3)', expect: { ids: ['li3'] } },
      { select: '#list > li:nth-last-child(2)', expect: { ids: ['li4'] } },
      { select: '#typed > i:nth-of-type(2)', expect: { ids: ['i2'] } },
      { select: '#typed > i:nth-last-of-type(1)', expect: { ids: ['i3'] } },

      // SELECT: formula path, h exists, cached nthElement/nthOfType.
      { select: '#list > li:nth-child(odd)', expect: { ids: ['li1', 'li3', 'li5'] } },
      { select: '#list > li:nth-child(even)', expect: { ids: ['li2', 'li4'] } },
      { select: '#list > li:nth-child(2n+1)', expect: { ids: ['li1', 'li3', 'li5'] } },
      { select: '#list > li:nth-child(2n)', expect: { ids: ['li2', 'li4'] } },

      { select: '#typed > i:nth-of-type(odd)', expect: { ids: ['i1', 'i3'] } },
      { select: '#typed > i:nth-of-type(even)', expect: { ids: ['i2'] } },

      // Logical pseudo: select-owned h is passed into internal s.match(..., h).
      { select: '#list > li:is(:nth-child(3), .missing)', expect: { ids: ['li3'] } },
      { select: '#list > li:not(:nth-child(even))', expect: { ids: ['li1', 'li3', 'li5'] } },
      { select: '#typed > i:is(:nth-of-type(2), .missing)', expect: { ids: ['i2'] } },
      { select: '#typed > i:not(:nth-of-type(even))', expect: { ids: ['i1', 'i3'] } },

      // Template DocumentFragment top-level match: guards parentNode/ParentNode behavior.
      { match: ':nth-child(2)', ref: { by: 'id', id: 'top-s1', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-of-type(2)', ref: { by: 'id', id: 'top-i2', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
      { match: ':nth-last-of-type(1)', ref: { by: 'id', id: 'top-i3', within: { by: 'template', id: 'frag-template' } }, expect: { count: 1 } },
    ],
  },

  {
    name: 'nth structural pseudo legacy numeric aliases match native',
    // status: 'only',
    markup: `
      <ul id="list">
        <li id="li1"></li>
        <li id="li2"></li>
        <li id="li3"></li>
        <li id="li4"></li>
      </ul>
    `,
    cases: [
      { select: '#list > li:nth-child(2n0)', expect: { throws: true } },
      { select: '#list > li:nth-child(2n1)', expect: { throws: true } },
      { match: ':nth-child(2n0)', ref: { by: 'id', id: 'li2' }, expect: { throws: true } },
      { match: ':nth-child(2n1)', ref: { by: 'id', id: 'li3' }, expect: { throws: true } },
    ],
  },

]);
