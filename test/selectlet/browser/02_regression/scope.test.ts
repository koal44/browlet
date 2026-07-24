import { runScenarios } from '../../dispatch';

runScenarios('scope', 'normal', [
  {
    name: 'scope-01a',
    markup: `
      <ul>
        <li id="scope"><a>abc</a></li>
        <li>def</li>
        <li><a>efg</a></li>
      </ul>
    `,
    cases: [
      { select: 'ul a', expect: { count: 2 } },
      { select: '#scope', expect: { count: 1 } },
      { select: 'a', ref: { by: 'id', id: 'scope' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'scope-01b',
    markup: `
      <ul>
        <li id="scope"><a>abc</a></li>
        <li>def</li>
        <li><a>efg</a></li>
      </ul>
    `,
    cases: [
      { select: '#scope', expect: { count: 1 } },
      { select: ':scope ul a', ref: { by: 'id', id: 'scope' }, expect: { count: 0, ids: [] } },
      { select: ':scope body ul a', ref: { by: 'id', id: 'scope' }, expect: { count: 0, ids: [] } },
      { select: ':scope a', ref: { by: 'id', id: 'scope' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'scope-02a/02b',
    markup: `
      <div class="a">
        <div class="a1"></div>
        <div class="a2"></div>
      </div>
    `,
    cases: [
      { select: '.a', expect: { count: 1 } },
      { select: 'body div', ref: { by: 'first', selector: '.a' }, expect: { count: 2 } },
      { select: ':scope body div', ref: { by: 'first', selector: '.a' }, expect: { count: 0, ids: [] } },
    ],
  },

  {
    name: 'scope-03a',
    markup: `
      <div class="block">
        <p class="para">
          <span class="inline">hello</span>
        </p>
      </div>
    `,
    cases: [
      { select: 'div', expect: { count: 1 } },
      { select: ':scope > p', ref: { by: 'first', selector: 'div' }, expect: { count: 1 } },
      { select: ':scope > span', ref: { by: 'first', selector: 'div' }, expect: { count: 0, ids: [] } },
    ],
  },

  {
    name: 'scope-03b',
    markup: `
      <div class="a">
        <div class="a1"></div>
        <div class="a2"></div>
      </div>
    `,
    cases: [
      { select: 'body div', ref: { by: 'first', selector: '.a' }, expect: { count: 2 } },
      { select: ':scope body div', ref: { by: 'first', selector: '.a' }, expect: { count: 0, ids: [] } },
      { select: ':scope > .a1, :scope > .a2', ref: { by: 'first', selector: '.a' }, expect: { count: 2 } },
    ],
  },

  {
    name: 'scope-04a',
    markupMode: 'html-document',
    markup: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>test nwsapi</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>@media (min-width:768px){.md\\:p-4{padding:1rem;}}</style>
        </head>
        <body class="md:p-4">
          <div data-test="foo"></div>
        </body>
      </html>
    `,
    cases: [
      { select: ':scope > [data-test="foo"]', ref: { by: 'first', selector: 'body' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'scope-04b',
    markup: `
      <div>
        <div class="outer">
          <div class="inner"></div>
        </div>
        <div class="other-outer"></div>
      </div>
    `,
    cases: [
      {
        select: ':scope > div', ref: { by: 'first', selector: 'div' },
        expect: { classes: ['outer', 'other-outer'] },
      },
    ],
  },

  {
    name: 'scope/context-vs-scope-anchoring',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html1">
      <head>
        <title>Scope tests</title>
      </head>
      <body id="body1">
        <main id="main1">
          <section id="outer" class="box">
            <div id="inner" class="box inner">
              <span id="x1" class="x item"></span>
              <span id="x2" class="x item"></span>
              <em id="em1" class="item"></em>
            </div>
            <div id="sibling" class="box sibling">
              <span id="x3" class="x item"></span>
            </div>
          </section>

          <section id="other" class="box">
            <div id="other-inner">
              <span id="x4" class="x item"></span>
            </div>
          </section>

          <div id="no-id-scope">
            <span id="no-id-child" class="item"></span>
          </div>

          <div id="odd.id" class="odd-id">
            <span id="odd-child" class="item"></span>
          </div>
        </main>
      </body>
      </html>
    `,
    cases: [
      // Document-level :scope.
      { select: ':scope', ref: { by: 'document' }, expect: { ids: ['html1'] } },
      { first: ':scope', ref: { by: 'document' }, expect: { ids: ['html1'] } },
      { select: ':scope > body', ref: { by: 'document' }, expect: { ids: ['body1'] } },
      { select: ':scope > .item', ref: { by: 'document' }, expect: { ids: [] } },

      // documentElement-level :scope.
      { select: ':scope', ref: { by: 'documentElement' }, expect: { ids: [] } },
      { select: ':scope > body', ref: { by: 'documentElement' }, expect: { ids: ['body1'] } },
      { first: ':scope > body', ref: { by: 'documentElement' }, expect: { ids: ['body1'] } },

      // Element-level :scope anchoring.
      { select: ':scope', ref: { by: 'id', id: 'inner' }, expect: { ids: [] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { first: ':scope > .item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1'] } },
      { select: ':scope .item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { select: ':scope > span.item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2'] } },
      { select: ':scope > em.item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['em1'] } },

      // Context filtering is not the same as :scope anchoring.
      // `#outer .x` can match descendants of `inner` because the full selector
      // is satisfied in the larger document, then results are filtered to `inner`.
      { select: '#outer .x', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2'] } },
      { first: '#outer .x', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1'] } },

      // Anchoring to `inner` prevents `#outer` from appearing below :scope.
      { select: ':scope #outer .x', ref: { by: 'id', id: 'inner' }, expect: { ids: [] } },
      { first: ':scope #outer .x', ref: { by: 'id', id: 'inner' }, expect: { ids: [] } },

      // Explicit subject weirdness: qSA does not return the context element itself.
      { select: 'section :scope', ref: { by: 'id', id: 'inner' }, expect: { ids: [] } },
      { select: 'main :scope', ref: { by: 'id', id: 'outer' }, expect: { ids: [] } },

      // Repeated :scope. Mostly useful to ensure parser/evaluator behavior is stable.
      { select: ':scope :scope', ref: { by: 'id', id: 'outer' }, expect: { ids: [] } },
      { select: ':scope :scope .item', ref: { by: 'id', id: 'outer' }, expect: { ids: [] } },

      // Forgiving pseudo containers with :scope.
      { select: ':is(:scope > .item)', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { select: ':where(:scope > .item)', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { select: ':not(:scope) > .item', ref: { by: 'id', id: 'inner' }, expect: { ids: [] } },
      { select: ':scope:not(.missing) > .item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { select: ':scope.inner > .item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { select: ':scope.missing > .item', ref: { by: 'id', id: 'inner' }, expect: { ids: [] } },

      // Temporary-id / escaping hazards for engines that implement :scope by rewriting to #id.
      { select: ':scope > .item', ref: { by: 'id', id: 'no-id-scope' }, expect: { ids: ['no-id-child'] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'odd.id' }, expect: { ids: ['odd-child'] } },

      // Pseudo-element invalidity in selector APIs.
      { select: ':scope::before', ref: { by: 'id', id: 'inner' }, expect: { count: 0 } },
      { first: ':scope::before', ref: { by: 'id', id: 'inner' }, expect: { count: 0 } },

      // matches() behavior.
      { match: ':scope', ref: { by: 'id', id: 'inner' }, expect: { count: 1 } },
      { match: ':scope.inner', ref: { by: 'id', id: 'inner' }, expect: { count: 1 } },
      { match: ':scope.missing', ref: { by: 'id', id: 'inner' }, expect: { count: 0 } },
      { match: 'section :scope', ref: { by: 'id', id: 'inner' }, expect: { count: 1 } },
      { match: 'main :scope', ref: { by: 'id', id: 'outer' }, expect: { count: 1 } },
      { match: ':scope > .item', ref: { by: 'id', id: 'x1' }, expect: { count: 0 } },
      { match: ':scope::before', ref: { by: 'id', id: 'inner' }, expect: { count: 0 } },

      // closest() behavior.
      { closest: ':scope', ref: { by: 'id', id: 'inner' }, expect: { ids: ['inner'] } },
      { closest: ':scope.inner', ref: { by: 'id', id: 'inner' }, expect: { ids: ['inner'] } },
      { closest: ':scope.missing', ref: { by: 'id', id: 'inner' }, expect: { ids: [] } },
      { closest: 'section :scope', ref: { by: 'id', id: 'inner' }, expect: { ids: ['inner'] } },
      { closest: 'main :scope', ref: { by: 'id', id: 'outer' }, expect: { ids: ['outer'] } },
      { closest: ':scope > .item', ref: { by: 'id', id: 'x1' }, expect: { ids: [] } },
      { closest: ':scope::before', ref: { by: 'id', id: 'inner' }, expect: { count: 0 } },
    ],
  },

  {
    name: ':scope native behavior in fragments and template content',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html1">
      <body id="body1">
        <template id="tmpl1">
          <section id="tmpl-section" class="scope-root">
            <span id="tmpl-child-1" class="item"></span>
            <span id="tmpl-child-2" class="item"></span>
          </section>
          <span id="tmpl-top-span" class="item"></span>
        </template>

        <div id="frag-source">
          <section id="frag-section" class="scope-root">
            <span id="frag-child-1" class="item"></span>
            <span id="frag-child-2" class="item"></span>
          </section>
          <span id="frag-top-span" class="item"></span>
        </div>

        <section id="live-section" class="scope-root">
          <span id="live-child-1" class="item"></span>
          <span id="live-child-2" class="item"></span>
        </section>
      </body>
      </html>
    `,
    cases: [
      { select: ':scope > .item', ref: { by: 'id', id: 'live-section' }, expect: { ids: ['live-child-1', 'live-child-2'] } },

      // Native browser behavior: plain selectors can find descendants in a DocumentFragment,
      // but :scope does not bind to the fragment as a structural parent.
      { select: '#frag-source', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-source'] } },
      { select: '.item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { select: '#frag-source .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },

      // DocumentFragment + :scope: native engines return no matches, even for top-level children.
      { select: ':scope', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope > *', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope > #frag-source', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope > div', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope > .scope-root', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':is(:scope > #frag-source)', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':where(:scope .item)', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },

      // To target the cloned element inside the fragment, use `within`.
      // Once the context is a real Element again, :scope works normally.
      { select: ':scope', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: [] } },
      { select: ':scope > *', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-section', 'frag-top-span'] } },
      { select: ':scope > .scope-root', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-section'] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-top-span'] } },
      { select: ':scope .item', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { first: ':scope > *', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-section'] } },
      { match: ':scope', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { count: 1 } },
      { closest: ':scope', ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-source'] } },

      // Descendant element inside the fragment.
      { select: ':scope', ref: { by: 'id', id: 'frag-section', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: [] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'frag-section', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-child-1', 'frag-child-2'] } },
      { select: ':scope .item', ref: { by: 'id', id: 'frag-section', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-child-1', 'frag-child-2'] } },
      { match: ':scope', ref: { by: 'id', id: 'frag-section', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { count: 1 } },
      { closest: ':scope', ref: { by: 'id', id: 'frag-section', within: { by: 'id', id: 'frag-source', home: 'fragment' } }, expect: { ids: ['frag-section'] } },

      // template.content is also a DocumentFragment.
      // Plain selectors work.
      { select: '#tmpl-section', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: ['tmpl-section'] } },
      { select: '.item', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: ['tmpl-child-1', 'tmpl-child-2', 'tmpl-top-span'] } },
      { select: '#tmpl-section .item', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: ['tmpl-child-1', 'tmpl-child-2'] } },

      // template.content + :scope: same fragment behavior; no matches.
      { select: ':scope', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { select: ':scope > *', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { select: ':scope > .item', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { select: ':scope > .scope-root', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { select: ':scope .item', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { first: ':scope > .scope-root', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { select: ':is(:scope > .item)', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { select: ':where(:scope > .scope-root)', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },
      { select: ':scope :scope .item', ref: { by: 'template', id: 'tmpl1' }, expect: { ids: [] } },

      // Element inside template.content: real Element context, so :scope works normally again.
      { select: ':scope', ref: { by: 'id', id: 'tmpl-section', within: { by: 'template', id: 'tmpl1' } }, expect: { ids: [] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'tmpl-section', within: { by: 'template', id: 'tmpl1' } }, expect: { ids: ['tmpl-child-1', 'tmpl-child-2'] } },
      { select: ':scope .item', ref: { by: 'id', id: 'tmpl-section', within: { by: 'template', id: 'tmpl1' } }, expect: { ids: ['tmpl-child-1', 'tmpl-child-2'] } },
      { match: ':scope', ref: { by: 'id', id: 'tmpl-section', within: { by: 'template', id: 'tmpl1' } }, expect: { count: 1 } },
      { closest: ':scope', ref: { by: 'id', id: 'tmpl-section', within: { by: 'template', id: 'tmpl1' } }, expect: { ids: ['tmpl-section'] } },
    ],
  },

  {
    name: ':scope native behavior in XML document contexts',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root id="root1" xmlns="http://example/default" xmlns:test="http://example/test">
        <item id="default-item-1" class="item" />
        <test:item id="test-item-1" class="item" />

        <plain id="plain1" xmlns="">
          <item id="no-ns-item-1" class="item" />
        </plain>

        <group id="group1">
          <item id="default-item-2" class="item" />
          <test:item id="test-item-2" class="item" />
        </group>
      </root>
    `,
    cases: [
      // XML document-level :scope should be the document element.
      { select: ':scope', ref: { by: 'document' }, expect: { ids: ['root1'] } },
      { first: ':scope', ref: { by: 'document' }, expect: { ids: ['root1'] } },
      { select: ':scope > .item', ref: { by: 'document' }, expect: { ids: ['default-item-1', 'test-item-1'] } },

      // Element-level qSA still returns descendants, not the context element.
      { select: ':scope', ref: { by: 'id', id: 'group1' }, expect: { ids: [] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'group1' }, expect: { ids: ['default-item-2', 'test-item-2'] } },
      { first: ':scope > .item', ref: { by: 'id', id: 'group1' }, expect: { ids: ['default-item-2'] } },

      // Raw colon is not valid type-selector syntax here.
      { select: ':scope > test:item', ref: { by: 'document' }, expect: { throws: true } },

      // Escaped colon is an identifier escape, not namespace-prefix syntax.
      // In XML, <test:item> has localName "item", not localName "test:item".
      { byTag: 'test:item', ref: { by: 'document' }, expect: { ids: ['test-item-1', 'test-item-2'] }, debug: false },
      { byTag: 'test\\:item', ref: { by: 'document' }, expect: { ids: [] } },
      { select: 'test\\:item', ref: { by: 'document' }, expect: { ids: [] }, debug: false },
      { select: ':scope > test\\:item', ref: { by: 'document' }, expect: { ids: [] } },
      { select: ':scope > test\\:item', ref: { by: 'id', id: 'group1' }, expect: { ids: [] } },

      // Namespace wildcard matches localName item in any namespace.
      { select: ':scope > *|item', ref: { by: 'document' }, expect: { ids: ['default-item-1', 'test-item-1'] } },
      { select: ':scope > *|item', ref: { by: 'id', id: 'group1' }, expect: { ids: ['default-item-2', 'test-item-2'] } },

      // Empty namespace selector should not match namespaced XML elements.
      { select: ':scope > |item', ref: { by: 'document' }, expect: { ids: [] } },
      { select: ':scope > |item', ref: { by: 'id', id: 'group1' }, expect: { ids: [] } },

      // A named namespace prefix requires CSS namespace registration; xmlns:test is not enough.
      { select: ':scope > test|item', ref: { by: 'document' }, expect: { throws: true } },

      // A subtree can clear the default XML namespace with xmlns="".
      { select: ':scope > *|plain', ref: { by: 'document' }, expect: { ids: ['plain1'] } },
      { select: ':scope > |plain', ref: { by: 'document' }, expect: { ids: ['plain1'] } },

      // Side-by-side namespace semantics for no-namespace elements.
      { select: ':scope > *|item', ref: { by: 'id', id: 'plain1' }, expect: { ids: ['no-ns-item-1'] } },
      { select: ':scope > |item', ref: { by: 'id', id: 'plain1' }, expect: { ids: ['no-ns-item-1'] } },
      { select: ':scope > item', ref: { by: 'id', id: 'plain1' }, expect: { ids: ['no-ns-item-1'] } },

      // matches/closest in XML element context.
      { match: ':scope', ref: { by: 'id', id: 'group1' }, expect: { count: 1 } },
      { match: 'root :scope', ref: { by: 'id', id: 'group1' }, expect: { count: 1 } },
      { closest: ':scope', ref: { by: 'id', id: 'group1' }, expect: { ids: ['group1'] } },
      { closest: 'root :scope', ref: { by: 'id', id: 'group1' }, expect: { ids: ['group1'] } },
    ],
  },

  {
    name: ':scope rewrite requires a unique context reference',
    // status: 'only',
    markup: `
      <div data-id="outer">
        <span id="item-1" class="item"></span>
        <span id="item-2" class="item"></span>

        <div data-id="inner">
          <span id="item-3" class="item"></span>
          <span id="item-4" class="item"></span>
        </div>
      </div>

      <div data-id="sibling">
        <span id="item-5" class="item"></span>
        <span id="item-6" class="item"></span>
      </div>
    `,
    cases: [
      {
        select: 'div > .item',
        ref: { by: 'first', selector: '[data-id="outer"]' },
        expect: { ids: ['item-1', 'item-2', 'item-3', 'item-4'] },
      },
      {
        select: ':scope > .item',
        ref: { by: 'first', selector: '[data-id="outer"]' },
        expect: { ids: ['item-1', 'item-2'] },
      },
    ],
  },

  {
    name: ':scope native behavior in DocumentFragment selector composition',
    // status: 'only',
    markup: `
      <div id="frag-source">
        <section id="frag-section" class="scope-root">
          <span id="frag-child-1" class="item"></span>
          <span id="frag-child-2" class="item alt"></span>
        </section>
        <span id="frag-top-span" class="item"></span>
      </div>
    `,
    cases: [
      // Baseline: plain selectors still search inside the DocumentFragment.
      { select: '#frag-source', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-source'] } },
      { select: '.item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { select: '#frag-source .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },

      // Positive :scope never binds to the DocumentFragment.
      { select: ':scope', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':SCOPE', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope > *', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope > #frag-source', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },
      { select: ':scope .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },

      // If :scope matches no element, :not(:scope) should match real elements.
      { select: ':not(:scope)', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-source', 'frag-section', 'frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { select: ':not(:scope).item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { select: ':not(:scope) .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { select: ':not(:scope) > .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },

      // Forgiving/container pseudos: :scope contributes nothing, other arms still work.
      { select: ':is(:scope, .item)', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { select: ':where(:scope, .item)', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] } },
      { select: ':is(:scope > .item, .alt)', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-2'] } },
      { select: ':where(:scope > .item, .alt)', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-2'] } },

      // Repeated :scope should still contribute no positive matches.
      { select: ':scope, .alt', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-2'] } },
      { select: ':scope, :scope > .item, .alt', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: ['frag-child-2'] } },
      { select: ':scope :scope .item', ref: { by: 'id', id: 'frag-source', home: 'fragment' }, expect: { ids: [] } },

      // The same selectors on the real element inside the fragment behave normally.
      {
        select: ':ScOpE > *',
        ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } },
        expect: { ids: ['frag-section', 'frag-top-span'] },
      },
      {
        select: ':scope .item',
        ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } },
        expect: { ids: ['frag-child-1', 'frag-child-2', 'frag-top-span'] },
      },
      {
        select: ':not(:scope)',
        ref: { by: 'id', id: 'frag-source', within: { by: 'id', id: 'frag-source', home: 'fragment' } },
        expect: { ids: ['frag-section', 'frag-child-1', 'frag-child-2', 'frag-top-span'] },
      },

      //
      { match: 'div:scope', ref: { by: 'id', id: 'frag-source' }, expect: { ids: ['frag-source'] } },
      { select: 'div:scope > *', ref: { by: 'id', id: 'frag-source' }, expect: { ids: ['frag-section', 'frag-top-span'] } },
    ],
  },

  {
    name: 'ampersand nesting selector behavior',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html">
        <body id="body">
          <div id="outer" class="foo">
            <span id="direct" class="direct bar"></span>
            <div id="middle">
              <span id="deep" class="deep bar"></span>
            </div>
          </div>
          <span id="outside" class="direct deep bar"></span>
        </body>
      </html>
    `,
    cases: [
      // Document context: & behaves like :scope, i.e. the document element.
      { select: '&', ref: { by: 'document' }, expect: { ids: ['html'] } },
      { select: ':scope', ref: { by: 'document' }, expect: { ids: ['html'] } },

      // No direct .direct children under <html>.
      { select: '& > .direct', ref: { by: 'document' }, expect: { ids: [] } },
      { select: ':scope > .direct', ref: { by: 'document' }, expect: { ids: [] } },

      // Element querySelectorAll does not include the context element itself.
      { select: '&', ref: { by: 'id', id: 'outer' }, expect: { ids: [] } },
      { select: ':scope', ref: { by: 'id', id: 'outer' }, expect: { ids: [] } },

      { select: '& span', ref: { by: 'id', id: 'outer' }, expect: { ids: ['direct', 'deep'] } },
      { select: ':scope span', ref: { by: 'id', id: 'outer' }, expect: { ids: ['direct', 'deep'] } },
      { select: '& span', ref: { by: 'id', id: 'outer' }, expect: { equivalentCase: { select: ':scope span', ref: { by: 'id', id: 'outer' } } } },

      // Element context: & behaves like :scope for descendant/child anchoring.
      { select: '& > .direct', ref: { by: 'id', id: 'outer' }, expect: { ids: ['direct'] } },
      { select: ':scope > .direct', ref: { by: 'id', id: 'outer' }, expect: { ids: ['direct'] } },

      { select: '& .deep', ref: { by: 'id', id: 'outer' }, expect: { ids: ['deep'] } },
      { select: ':scope .deep', ref: { by: 'id', id: 'outer' }, expect: { ids: ['deep'] } },

      // Compound with &: the context element is .foo, but qSA returns descendants,
      // so this still does not return the context element.
      { select: '&.foo', ref: { by: 'id', id: 'outer' }, expect: { ids: [] } },

      // matches() does test the element itself.
      { match: '&', ref: { by: 'id', id: 'outer' }, expect: { ids: ['outer'], classes: ['foo'] } },
      { match: ':scope', ref: { by: 'id', id: 'outer' }, expect: { ids: ['outer'] } },
      { match: '&.foo', ref: { by: 'id', id: 'outer' }, expect: { ids: ['outer'] } },

      // These are valid selectors, but they do not match this tree.
      { select: '#outer & > .direct', ref: { by: 'document' }, expect: { ids: [] } },
      { select: 'div & span', ref: { by: 'document' }, expect: { ids: [] } },

      // QSA takes selectors, not stylesheet rules.
      { select: '#outer { & > .direct }', expect: { throws: true } },
    ],
  },

  {
    name: ':scope without marker mutation',
    // status: 'only',
    // engines: ['selectlet'],
    markup: `
      <section id="outer">
        <div id="ctx">
          <span id="child-1" class="x"></span>
          <span id="child-2"></span>
          <em id="em-1"><span id="nested" class="x"></span></em>
        </div>
        <span id="outside" class="x"></span>
      </section>
    `,
    cases: [
      { select: ':scope', ref: { by: 'id', id: 'ctx' }, expect: { ids: [] } },
      { select: ':scope > *', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['child-1', 'child-2', 'em-1'] } },
      { select: ':scope .x', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['child-1', 'nested'] } },
      { select: ':scope > .x', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['child-1'] } },
      { select: 'span', ref: { by: 'id', id: 'ctx' }, expect: { ids: ['child-1', 'child-2', 'nested'] } },
    ],
  },

  {
    name: ':scope inside :is/:where/:not preserves query scope',
    // status: 'only',
    markup: `
      <div id="inner">
        <span id="x1" class="item"></span>
        <span id="x2" class="item"></span>
        <em id="em1" class="item"></em>
        <strong id="nope"></strong>
      </div>
    `,
    cases: [
      { match: ':scope.item', ref: { by: 'id', id: 'x1' }, expect: { ids: ['x1'] } },
      { select: ':scope > .item', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { select: ':is(:scope > .item)', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] }, debug: false },
      { select: ':where(:scope > .item)', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1'] } },
      { select: ':not(:scope)', ref: { by: 'id', id: 'inner' }, expect: { ids: ['x1', 'x2', 'em1', 'nope'] } },
    ],
  },

]);
