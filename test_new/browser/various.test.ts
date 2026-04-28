import { runScenarios } from "./harness/scenarios";

runScenarios('various', 'normal', [
  {
    name: 'byClass fragment fallback escapes regex metacharacters',
    // status: 'only',
    markup: `
      <template id="frag">
        <span id="literal" class="foo.bar"></span>
        <span id="false-positive" class="fooXbar"></span>
      </template>
    `,
    cases: [
      { byClass: 'foo.bar', ref: { by: 'id', id: 'literal', within: { by: 'template', id: 'frag' }, home: 'fragment' }, expect: { ids: ['literal'] } },
      { byClass: 'foo.bar', ref: { by: 'id', id: 'false-positive', within: { by: 'template', id: 'frag' }, home: 'fragment' }, expect: { ids: [] } },

      { byClass: 'foo.bar', ref: { by: 'template', id: 'frag' }, expect: { ids: ['literal'] } },
    ],
  },

  {
    name: 'native byTag fragment oracle handles selector-sensitive tag names',
    // status: 'only',
    markup: `
      <div id="root">
        <x-foo id="custom"></x-foo>
        <foo.bar id="dot"></foo.bar>
        <foo_bar id="underscore"></foo_bar>
        <foo:bar id="colon"></foo:bar>
        <foo\:diez id="escaped-colon"></foo\:diez>
        <foo123 id="digits"></foo123>
      </div>

      <template id="frag">
        <x-foo id="custom"></x-foo>
        <foo.bar id="dot"></foo.bar>
        <foo_bar id="underscore"></foo_bar>
        <foo:bar id="colon"></foo:bar>
        <foo\:diez id="escaped-colon"></foo\:diez>
        <foo123 id="digits"></foo123>
      </template>
    `,
    cases: [
      { byTag: '*', ref: { by: 'id', id: 'root' }, expect: { ids: ['custom', 'dot', 'underscore', 'colon', 'escaped-colon', 'digits'] } },
      { byTag: '*', ref: { by: 'template', id: 'frag' }, expect: { ids: ['custom', 'dot', 'underscore', 'colon', 'escaped-colon', 'digits'] } },

      { byTag: 'x-foo', ref: { by: 'id', id: 'root' }, expect: { ids: ['custom'] } },
      { byTag: 'x-foo', ref: { by: 'template', id: 'frag' }, expect: { ids: ['custom'] } },

      { byTag: 'foo.bar', ref: { by: 'id', id: 'root' }, expect: { ids: ['dot'] } },
      { byTag: 'foo.bar', ref: { by: 'template', id: 'frag' }, expect: { ids: ['dot'] } },

      { byTag: 'foo_bar', ref: { by: 'id', id: 'root' }, expect: { ids: ['underscore'] } },
      { byTag: 'foo_bar', ref: { by: 'template', id: 'frag' }, expect: { ids: ['underscore'] } },

      { byTag: 'foo:bar', ref: { by: 'id', id: 'root' }, expect: { ids: ['colon'] } },
      { byTag: 'foo:bar', ref: { by: 'template', id: 'frag' }, expect: { ids: ['colon'] } },

      { byTag: 'foo:diez', ref: { by: 'id', id: 'root' }, expect: { ids: ['escaped-colon'] } },
      { byTag: 'foo:diez', ref: { by: 'template', id: 'frag' }, expect: { ids: ['escaped-colon'] } },

      { byTag: 'foo123', ref: { by: 'id', id: 'root' }, expect: { ids: ['digits'] } },
      { byTag: 'foo123', ref: { by: 'template', id: 'frag' }, expect: { ids: ['digits'] } },
    ],
  },

  {
    name: 'byClass quirks mode matches class names case-insensitively',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <html>
        <body>
          <div id="root">
            <span id="upper" class="Foo"></span>
            <span id="lower" class="foo"></span>
          </div>
        </body>
      </html>
    `,
    cases: [
      // { select: '.foo', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: ['upper', 'lower'] }, debug: true },
      { byClass: 'foo', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: ['upper', 'lower'] } },
      { byClass: 'FOO', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: ['upper', 'lower'] } },

      { byClass: 'foo', ref: { by: 'id', id: 'upper', home: 'fragment' }, expect: { ids: ['upper'] } },
      { byClass: 'FOO', ref: { by: 'id', id: 'lower', home: 'fragment' }, expect: { ids: ['lower'] } },
    ],
  },

  {
    name: 'byClass standards mode matches class names case-sensitively',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="root">
            <span id="upper" class="Foo"></span>
            <span id="lower" class="foo"></span>
          </div>
        </body>
      </html>
    `,
    cases: [
      // { select: '.foo', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: ['lower'] }, debug: true },
      { byClass: 'foo', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: ['lower'] } },
      { byClass: 'FOO', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: [] } },

      { byClass: 'foo', ref: { by: 'id', id: 'upper', home: 'fragment' }, expect: { ids: [] } },
      { byClass: 'FOO', ref: { by: 'id', id: 'lower', home: 'fragment' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'byTag fragment respects case in XML mode',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root id="myroot">
        <Foo id="upper"/>
        <foo id="lower"/>
      </root>
    `,
    cases: [
      // { byTag: 'Foo', expect: { ids: ['upper'] }, debug: true },
      { byTag: 'Foo', expect: { ids: ['upper'] } },
      { byTag: 'foo', expect: { ids: ['lower'] } },
      { byTag: 'Foo', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['upper'] } },
      { byTag: 'foo', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['lower'] } },
    ],
  },

  {
    name: 'byTag fragment is case-insensitive in HTML mode',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
      <div id="myroot">
        <Foo id="upper"></Foo>
        <foo id="lower"></foo>
        <x-Thing id="custom"></x-Thing>
      </div>
      </html>
    `,
    cases: [
      { byTag: 'Foo', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['upper', 'lower'] } },
      { byTag: 'foo', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['upper', 'lower'] } },

      { byTag: 'x-Thing', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['custom'] } },
      { byTag: 'x-thing', ref: { by: 'id', id: 'myroot', home: 'fragment' }, expect: { ids: ['custom'] } },
    ],
  },

  {
    name: 'byTag fragment matches top-level HTML elements case-insensitively',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
      <Div id="top"></Div>
      </html>
    `,
    cases: [
      { byTag: 'DIV', ref: { by: 'id', id: 'top', home: 'fragment' }, expect: { ids: ['top'] } },
      { byTag: 'Div', ref: { by: 'id', id: 'top', home: 'fragment' }, expect: { ids: ['top'] } },
      { byTag: 'div', ref: { by: 'id', id: 'top', home: 'fragment' }, expect: { ids: ['top'] } },
    ],
  },

  {
    name: ':scope native behavior in HTML document and element contexts',
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
      { byTag: 'test:item', ref: { by: 'document' }, expect: { ids: ['test-item-1', 'test-item-2'] } },
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
    name: 'escaped colon type selector in HTML-created element',
    markupMode: 'html-document',
    // status: 'only',
    markup: `
      <!doctype html>
      <html>
      <body id="body1"></body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const el = document.createElement('test:item');
        el.id = 'literal-colon-item';
        document.body.appendChild(el);
      });
    },
    cases: [
      { select: 'test\\:item', ref: { by: 'document' }, expect: { ids: ['literal-colon-item'] } },
    ],
  },

  {
    name: 'native probe: type selector qSA vs getElementsByTagName in HTML and XML',
    // status: 'only',
    status: 'skip', // exploratory test for understanding native engine behavior
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
      <body>
        <div id="html-root"></div>
      </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const htmlRoot = document.getElementById('html-root')!;

        const addHtml = (name: string, id: string) => {
          const el = document.createElement(name);
          el.id = id;
          htmlRoot.appendChild(el);
        };

        const xmlDoc = document.implementation.createDocument(null, 'root');
        const xmlRoot = xmlDoc.documentElement;
        xmlRoot.setAttribute('id', 'xml-root');
        xmlRoot.setAttribute('xmlns:test', 'http://example/test');

        const addXml = (qname: string, id: string, ns: string | null = null) => {
          const el = xmlDoc.createElementNS(ns, qname);
          el.setAttribute('id', id);
          xmlRoot.appendChild(el);
        };

        // <div id="html-root">
        //   <test.item id="html-dot"></test.item>
        //   <test_item id="html-underscore"></test_item>
        //   <test-item id="html-hyphen"></test-item>
        //   <item id="html-item"></item>
        //   <test:item id="html-colon"></test:item>
        // </div>
        //
        // XML tree:
        //
        // <root id="xml-root" xmlns:test="http://example/test">
        //   <test.item id="xml-dot" />
        //   <test_item id="xml-underscore" />
        //   <test-item id="xml-hyphen" />
        //   <item id="xml-item" />
        //   <test:item id="xml-ns-colon" />
        // </root>

        addHtml('test.item', 'html-dot');
        addXml( 'test.item', 'xml-dot');

        addHtml('test_item', 'html-underscore');
        addXml( 'test_item', 'xml-underscore');

        addHtml('test-item', 'html-hyphen');
        addXml( 'test-item', 'xml-hyphen');

        addHtml('item', 'html-item');
        addXml( 'item', 'xml-item');

        // Colon case: same visual qname, different DOM name model.
        addHtml('test:item', 'html-colon');
        addXml( 'test:item', 'xml-ns-colon', 'http://example/test');

        // Local copy of CSS ident unescape for browser-native probe.
        // Equivalent to cssIdentUnescape for the cases under test.
        const cssIdentUnescapeLocal = (str: string): string =>
          /\\/.test(str)
            ? str.replace(/\\([0-9a-fA-F]{1,6}[\t\n\f\r ]?|.)/g, (_m, esc: string) => {
                if (/^[0-9a-fA-F]/.test(esc)) {
                  const cp = parseInt(esc, 16);
                  return cp === 0 ? '\uFFFD' : String.fromCodePoint(cp);
                }
                return esc;
              })
            : str;

        const ids = (nodes: Iterable<Element>): string[] =>
          Array.from(nodes, el => el.id);

        const qsaIds = (root: ParentNode, selector: string): string[] =>
          ids(root.querySelectorAll(selector));

        const tagIds = (root: Document | Element, name: string): string[] =>
          ids(root.getElementsByTagName(name));

        const assertSame = (label: string, actual: string[], expected: string[]) => {
          if (actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
            throw new Error(`${label}\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(actual)}`);
          }
        };

        const assertPair = (
          label: string,
          root: Document | Element,
          selector: string,
          expectedQsa: string[],
          expectedTag: string[],
        ) => {
          const tagName = cssIdentUnescapeLocal(selector);

          assertSame(`${label} qSA(${selector})`, qsaIds(root, selector), expectedQsa);
          assertSame(`${label} tag(${tagName})`, tagIds(root, tagName), expectedTag);
        };

        // Dot: escaped CSS type selector and DOM tag-name lookup agree in both HTML and XML.
        assertPair('html dot', htmlRoot, 'test\\.item', ['html-dot'], ['html-dot']);
        assertPair('xml dot',  xmlRoot,  'test\\.item', ['xml-dot'],  ['xml-dot']);

        // Underscore: no escaping required; qSA and tag lookup agree.
        assertPair('html underscore', htmlRoot, 'test_item', ['html-underscore'], ['html-underscore']);
        assertPair('xml underscore',  xmlRoot,  'test_item', ['xml-underscore'],  ['xml-underscore']);

        // Hyphen: no escaping required; qSA and tag lookup agree.
        assertPair('html hyphen', htmlRoot, 'test-item', ['html-hyphen'], ['html-hyphen']);
        assertPair('xml hyphen',  xmlRoot,  'test-item', ['xml-hyphen'],  ['xml-hyphen']);

        // Bare item in XML qSA matches localName item in any namespace.
        // getElementsByTagName('item') appears to do the same here.
        assertPair('html item', htmlRoot, 'item', ['html-item'], ['html-item']);
        assertPair('xml item',  xmlRoot,  'item', ['xml-item', 'xml-ns-colon'], ['xml-item']);

        // Colon: this is the exception.
        //
        // HTML:
        //   qSA('test\\:item') and getElementsByTagName('test:item') agree.
        //
        // XML:
        //   qSA('test\\:item') does NOT match <test:item>,
        //   but getElementsByTagName('test:item') DOES match by qualified name.
        assertPair('html escaped colon', htmlRoot, 'test\\:item', ['html-colon'], ['html-colon']);
        assertPair('xml escaped colon',  xmlRoot,  'test\\:item', [],            ['xml-ns-colon']);
      });
    },
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
    name: ':scope marker is cleaned after select',
    engines: ['nw'],
    markup: `
      <div id="ctx">
        <span id="child-1"></span>
        <span id="child-2"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const ctx = document.getElementById('ctx')!;
        const results = [...NW?.Dom?.select(':scope > *', ctx) ?? []];

        const ids = results.map((e) => e.id);
        if (ids.join(',') !== 'child-1,child-2') {
          throw new Error(`Expected child-1,child-2; got ${ids.join(',')}`);
        }

        const marked = [...document.querySelectorAll('[data-nwsapi-scope]')].map((e) => e.id || e.localName);
        if (marked.length) {
          throw new Error(`scope marker leaked after select: ${marked.join(',')}`);
        }
      });
    }
  },

  {
    name: ':scope marker is not visible during select callback',
    status: 'fixme',
    engines: ['nw'],
    markup: `
      <div id="ctx">
        <span id="child-1"></span>
        <span id="child-2"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const ctx = document.getElementById('ctx')!;
        const observed: string[] = [];

        const cb = (el: Element) => {
          observed.push(ctx.outerHTML);
          return true;
        };

        const results = [...NW?.Dom?.select(':scope > *', ctx, cb) ?? []];

        const resultIds = results.map((e) => e.id);
        if (resultIds.join(',') !== 'child-1,child-2') {
          throw new Error(`Expected result ids child-1,child-2; got ${resultIds.join(',')}`);
        }

        const exposed = observed.filter((html) => html.includes('data-nwsapi-scope'));
        if (exposed.length) {
          throw new Error(`callback observed scope marker:\n${exposed.join('\n')}`);
        }

        const marked = [...document.querySelectorAll('[data-nwsapi-scope]')].map((e) => e.id || e.localName);
        if (marked.length) {
          throw new Error(`scope marker leaked after callback select: ${marked.join(',')}`);
        }
      });
    },
  },

  {
    name: 'native attribute-name selector edge cases',
    // status: 'only',
    // browsers: ['webkit'],
    markup: `
      <div id="wrapper"></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const wrapper = document.getElementById('wrapper')!;

        const add = (id: string, attrs: Record<string, string>) => {
          const el = document.createElement('span');
          el.id = id;
          for (const [name, value] of Object.entries(attrs)) {
            el.setAttribute(name, value);
          }
          wrapper.appendChild(el);
        };

        add('plain-attr', { foo: 'yes' });
        add('hyphen-attr', { 'foo-bar': 'yes' });
        add('underscore-attr', { 'foo_bar': 'yes' });
        add('digit-attr', { 'foo123': 'yes' });
        // add('digit-start-attr', { '123': 'yes' }); // ff
        add('colon-attr', { 'foo:bar': 'yes' });
        // add('plus-attr', { 'foo+bar': 'yes' }); // ff
        add('non-ascii-attr', { föo: 'yes' });
        // add('unicode-attr', { 名前: 'yes' }); // chrome
      });
    },
    cases: [
      // Plain / normal-ish attribute names.
      { select: '[foo]', expect: { ids: ['plain-attr'] } },
      { select: '[foo-bar]', expect: { ids: ['hyphen-attr'] } },
      { select: '[foo_bar]', expect: { ids: ['underscore-attr'] } },
      { select: '[foo123]', expect: { ids: ['digit-attr'] } },

      // Digit-starting attribute names need CSS escaping.
      // { select: '[123]', expect: { throws: true } },
      // { select: '[\\31 23]', expect: { ids: ['digit-start-attr'] } },

      // Literal colon and plus in attribute names need CSS escaping.
      { select: '[foo:bar]', expect: { throws: true } },
      { select: '[foo\\:bar]', expect: { ids: ['colon-attr'] } },

      // { select: '[foo+bar]', expect: { throws: true } },
      // { select: '[foo\\+bar]', expect: { ids: ['plus-attr'] } },

      // Non-ASCII identifiers should work directly.
      // föo = f + U+00F6 + o
      { select: '[föo]', expect: { ids: ['non-ascii-attr'] } },
      { select: '[f\\F6 o]', expect: { ids: ['non-ascii-attr'] }, debug: false },

      // 名 = U+540D, 前 = U+524D
      // { select: '[名前]', expect: { ids: ['unicode-attr'] } },
      // { select: '[\\540D \\524D ]', expect: { ids: ['unicode-attr'] } },
    ],
  },

  {
    name: 'escaped colon attribute selector',
    // status: 'only',
    markup: `<div id="wrapper"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const wrapper = document.getElementById('wrapper')!;
        const el = document.createElement('span');
        el.id = 'colon-attr';
        el.setAttribute('foo:bar', 'yes');
        wrapper.appendChild(el);
      });
    },
    cases: [
      { select: '[foo:bar]', expect: { throws: true } },
      { select: '[foo\\:bar]', expect: { ids: ['colon-attr'] } },
    ],
  },

  {
    name: 'logical pseudo followed by functional pseudo',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="s1" class="a"></span>
        <span id="s2" class="b"></span>
        <span id="s3"></span>
        <span id="s4" class="a b"></span>
        <span id="s5" class="b"></span>
      </div>
    `,
    cases: [
      {
        select: ':is(:not(.a), .b):nth-child(2n+1)', ref: { by: 'id', id: 'root' },
        expect: { ids: ['s3', 's5'] },
        // debug: true,
      },
    ],
  },

  {
    name: 'malformed combinator placement rejects',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="child"></span>
      </div>
    `,
    cases: [
      { select: '> div', expect: { throws: true } },
      { select: 'div >> span', expect: { throws: true } },
      { select: 'div + > span', expect: { throws: true } },
    ],
  },

  {
    name: 'functional pseudo validation with namespace types and combinators',
    // status: 'only',
    markup: `
      <div id="root">
        <section id="card">
          <h1 id="title"></h1>
          <span id="badge" class="item"></span>
        </section>
        <div id="after" class="after"></div>
        <div id="tail" class="tail"></div>
      </div>
    `,
    cases: [
      // namespace type selectors inside functional pseudos
      { select: ':is(*|section)', expect: { ids: ['card'] } },
      { select: '#card > :is(*|h1)', expect: { ids: ['title'] } },
      { select: '#card:has(> *|h1)', expect: { ids: ['card'] } },
      { select: '#card:has(> *|span)', expect: { ids: ['card'] } },
      { select: '#card:has(> |span)', expect: { ids: [] } },

      // explicit combinators inside functional pseudos
      { select: '#card:has(> h1)', expect: { ids: ['card'] } },
      { select: '#card:has(>h1)', expect: { ids: ['card'] } },
      { select: '#card:has(+ .after)', expect: { ids: ['card'] } },
      { select: '#card:has(~ .tail)', expect: { ids: ['card'] } },
    ],
  },

  {
    name: 'attribute namespace selectors on xml attributes',
    // status: 'only',
    // browsers: ['firefox'],
    markupMode: 'xml-document',
    markup: `
      <root id="myroot">
        <item id="xml-lang" xml:lang="en"/>
        <item id="plain-lang" lang="en"/>
        <item id="xml-space" xml:space="preserve"/>
        <item id="plain-other" other="x"/>
      </root>
    `,
    cases: [
      { select: '[lang]', expect: { ids: ['plain-lang'] } },
      { select: '[*|lang]', expect: { ids: ['xml-lang', 'plain-lang'] } },
      { select: '[|lang]', expect: { ids: ['plain-lang'] } },
      { select: '[*|l.ng]', expect: { throws: true } },
      { select: '[*|l\\.ng]', expect: { count: 0 } },
      { select: '[xml|lang]', expect: { throws: true } },

      // Chromium/Firefox throw; WebKit accepts this form.
      { select: '[*|*]', expect: { throws: true }, status: 'fail' },

      { select: '[xml:lang]', expect: { throws: true } },
      { select: '[xml\:lang]', expect: { throws: true } },
      { select: '[xml\\:lang]', expect: { ids: [] } },
    ],
  },

  {
    name: 'xml type selectors with XHTML default namespace and foreign prefix',
    // status: 'only',
    // browsers: ['firefox'],
    markupMode: 'xml-document',
    markup: `
      <!DOCTYPE html>
      <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:test="http://example/test">
      <head>
        <title>Selectors</title>
        <link href="selectors.css" rel="stylesheet" type="text/css" />
      </head>
      <body>
        <test:p>Hello</test:p>
      </body>
      </html>
    `,
    cases: [
      { select: '*|p', expect: { count: 1 } },
      { select: 'test\\:p', expect: { count: 0 } },
      { select: 'test|p', expect: { throws: true } },
    ],
  },

  {
    name: 'callback compile cache does not leak across select calls',
    // status: 'only',
    markup: `
      <div id="d">
        <span id="a" class="x"></span>
        <span id="b" class="x"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const nwdom = NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom not found');

        // First compile/cache without callback.
        const plain = nwdom.select('#d .x', document);

        // Then same selector with callback.
        const withCb = nwdom.select('#d .x', document, (el: Element) => {
          calls.push(el.id);
          return false;
        });

        if (plain.length !== 2) throw new Error(`plain length ${plain.length}`);
        if (withCb.length !== 1) throw new Error(`withCb length ${withCb.length}`);
        if (calls.join(',') !== 'a') throw new Error(`callback calls ${calls.join(',')}`);
      });
    },
  },

  {
    name: 'callback compile cache does not leak into later non-callback select',
    // status: 'only',
    markup: `
      <div id="d">
        <span id="a" class="x"></span>
        <span id="b" class="x"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const nwdom = NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom not found');

        const withCb = nwdom.select('#d .x', document, (el: Element) => {
          calls.push(el.id);
          return false;
        });

        const plain = nwdom.select('#d .x', document);

        if (withCb.length !== 1) throw new Error(`withCb length ${withCb.length}`);
        if (plain.length !== 2) throw new Error(`plain length ${plain.length}`);
        if (calls.join(',') !== 'a') throw new Error(`callback calls ${calls.join(',')}`);
      });
    },
  },

  {
    name: 'select callback order and early stop',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="a" class="x"></span>
        <span id="b" class="x"></span>
        <span id="c" class="x"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const nwdom = NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom not found');

        const results = nwdom.select('#root > .x', document, (el: Element) => {
          calls.push(el.id);
          return el.id !== 'b';
        });

        const resultIds = [...results].map((el: Element) => el.id);

        if (calls.join(',') !== 'a,b') {
          throw new Error(`Expected callback calls a,b; got ${calls.join(',')}`);
        }

        if (resultIds.join(',') !== 'a,b') {
          throw new Error(`Expected results a,b; got ${resultIds.join(',')}`);
        }
      });
    },
  },

  {
    name: 'select callback false does not cache partial results for later callbacks',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="a"></span>
        <span id="b"></span>
        <span id="c"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const nwdom = NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom not found');

        const firstCalls: string[] = [];
        const first = nwdom.select('#a, #b, #c', document, (el: Element) => {
          firstCalls.push(el.id);
          return false;
        });

        const secondCalls: string[] = [];
        const second = nwdom.select('#a, #b, #c', document, (el: Element) => {
          secondCalls.push(el.id);
          return true;
        });

        const firstIds = [...first].map((el: Element) => el.id);
        const secondIds = [...second].map((el: Element) => el.id);

        if (firstCalls.join(',') !== 'a') {
          throw new Error(`Expected first callback calls a; got ${firstCalls.join(',')}`);
        }

        if (firstIds.join(',') !== 'a') {
          throw new Error(`Expected first results a; got ${firstIds.join(',')}`);
        }

        if (secondCalls.join(',') !== 'a,b,c') {
          throw new Error(`Expected second callback calls a,b,c; got ${secondCalls.join(',')}`);
        }

        if (secondIds.join(',') !== 'a,b,c') {
          throw new Error(`Expected second results a,b,c; got ${secondIds.join(',')}`);
        }
      });
    },
  },

  {
    name: 'select callback false stops across selector groups',
    // status: 'only',
    markup: `
      <div id="root">
        <span id="a" class="x"></span>
        <span id="b" class="y"></span>
        <span id="c" class="z"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const nwdom = NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom not found');

        const results = nwdom.select('#a, #b, #c', document, (el: Element) => {
          calls.push(el.id);
          return false;
        });

        const resultIds = [...results].map((el: Element) => el.id);

        if (calls.join(',') !== 'a') {
          throw new Error(`Expected callback calls a; got ${calls.join(',')}`);
        }

        if (resultIds.join(',') !== 'a') {
          throw new Error(`Expected results a; got ${resultIds.join(',')}`);
        }
      });
    },
  },

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
    name: 'registered selector extension can inject resolver vars',
    // status: 'only',
    engines: ['nw'],
    markup: `
      <div id="root">
        <button id="button1"></button>
        <input id="input1" />
        <textarea id="textarea1"></textarea>
        <span id="span1"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const nwdom = NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom not found');

        nwdom.registerSelector(
          'XControl',
          /^:(x-control)(.*)/i,
          (match, source) => {
            return {
              match,
              modvar: 'q',
              source: 'q=e.nodeName;if(/^(BUTTON|INPUT|SELECT|TEXTAREA)$/i.test(q)){' + source + '}',
              status: true,
            };
          },
        );
      });
    },
    cases: [
      { select: ':x-control', expect: { ids: ['button1', 'input1', 'textarea1'] } },
      { select: '#root > :x-control', expect: { ids: ['button1', 'input1', 'textarea1'] } },
      { select: 'span:x-control', expect: { ids: [] } },
    ],
  },

]);