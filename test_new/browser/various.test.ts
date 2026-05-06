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

  {
    name: 'HTML attribute value case sensitivity',
    // status: 'only',
    markup: `
      <div id="root">
        <div id="align-upper" align="CENTER"></div>
        <div id="dir-upper" dir="RTL"></div>
        <p id="lang-upper" lang="EN-us"></p>
        <input id="type-upper" type="TEXT">
        <input id="checked-upper" checked="CHECKED">
        <button id="disabled-upper" disabled="DISABLED"></button>
        <option id="selected-upper" selected="SELECTED"></option>
        <a id="target-upper" target="_BLANK"></a>

        <div id="data-upper" data-mode="ON"></div>
        <div id="title-upper" title="HELLO"></div>
        <div id="role-upper" role="BUTTON"></div>
        <div id="class-upper" class="LOUD"></div>
      </div>
    `,
    cases: [
      // HTML attributes whose values are matched case-insensitively by default.
      { select: '[align="center"]',      expect: { ids: ['align-upper'] } },
      { select: '[dir="rtl"]',           expect: { ids: ['dir-upper'] } },
      { select: '[lang="en-us"]',        expect: { ids: ['lang-upper'] } },
      { select: '[type="text"]',         expect: { ids: ['type-upper'] } },
      { select: '[checked="checked"]',   expect: { ids: ['checked-upper'] } },
      { select: '[disabled="disabled"]', expect: { ids: ['disabled-upper'] } },
      { select: '[selected="selected"]', expect: { ids: ['selected-upper'] } },
      { select: '[target="_blank"]',     expect: { ids: ['target-upper'] } },

      // Ordinary/custom attribute values are case-sensitive by default.
      { select: '[data-mode="on"]', expect: { ids: [] } },
      { select: '[title="hello"]',  expect: { ids: [] } },
      { select: '[role="button"]',  expect: { ids: [] } },
      { select: '[class="loud"]',   expect: { ids: [] } },

      // Explicit i flag makes ordinary/custom attribute values case-insensitive.
      { select: '[data-mode="on" i]', expect: { ids: ['data-upper'] } },
      { select: '[title="hello" i]',  expect: { ids: ['title-upper'] } },
      { select: '[role="button" i]',  expect: { ids: ['role-upper'] } },
      { select: '[class="loud" i]',   expect: { ids: ['class-upper'] } },
    ],
  },

  {
    name: 'XML attribute value case sensitivity',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root id="root">
        <item id="align-upper" align="CENTER" />
        <item id="dir-upper" dir="RTL" />
        <item id="lang-upper" lang="EN-us" />
        <item id="type-upper" type="TEXT" />
        <item id="checked-upper" checked="CHECKED" />
        <item id="disabled-upper" disabled="DISABLED" />
        <item id="selected-upper" selected="SELECTED" />
        <item id="target-upper" target="_BLANK" />

        <item id="data-upper" data-mode="ON" />
        <item id="title-upper" title="HELLO" />
        <item id="role-upper" role="BUTTON" />
        <item id="class-upper" class="LOUD" />
      </root>
    `,
    cases: [
      // XML does not get HTML's default case-insensitive attribute value matching.
      { select: '[align="center"]',      expect: { ids: [] } },
      { select: '[dir="rtl"]',           expect: { ids: [] } },
      { select: '[lang="en-us"]',        expect: { ids: [] } },
      { select: '[type="text"]',         expect: { ids: [] } },
      { select: '[checked="checked"]',   expect: { ids: [] } },
      { select: '[disabled="disabled"]', expect: { ids: [] } },
      { select: '[selected="selected"]', expect: { ids: [] } },
      { select: '[target="_blank"]',     expect: { ids: [] } },

      // Ordinary/custom values are also case-sensitive by default.
      { select: '[data-mode="on"]', expect: { ids: [] } },
      { select: '[title="hello"]',  expect: { ids: [] } },
      { select: '[role="button"]',  expect: { ids: [] } },
      { select: '[class="loud"]',   expect: { ids: [] } },

      // Explicit i flag works in XML too.
      { select: '[align="center" i]', expect: { ids: ['align-upper'] } },
      { select: '[type="text" i]',    expect: { ids: ['type-upper'] } },
      { select: '[data-mode="on" i]', expect: { ids: ['data-upper'] } },
      { select: '[title="hello" i]',  expect: { ids: ['title-upper'] } },
    ],
  },

  {
    name: 'escaped ID selector values in compiled ancestor filter',
    // status: 'only',
    markup: `
      <div id="foo.bar">
        <span id="dot" class="x"></span>
      </div>

      <div id="foo+bar">
        <span id="plus" class="x"></span>
      </div>

      <div id="foo[bar]">
        <span id="bracket" class="x"></span>
      </div>

      <div id="foo\\bar">
        <span id="backslash" class="x"></span>
      </div>

      <div id="123">
        <span id="digit" class="x"></span>
      </div>

      <div id="é">
        <span id="unicode" class="x"></span>
      </div>

      <div id="foo&#10;bar">
        <span id="newline" class="x"></span>
      </div>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the escaped ID is checked by the compiled ancestor filter.
      { select: '#foo.bar > .x', expect: { ids: [] } },
      { select: '#foo\\.bar > .x', expect: { ids: ['dot'] } },
      { select: '#foo\\+bar > .x', expect: { ids: ['plus'] } },
      { select: '#foo\\[bar\\] > .x', expect: { ids: ['bracket'] } },
      { select: '#foo\\\\bar > .x', expect: { ids: ['backslash'] } },
      { select: '#\\31 23 > .x', expect: { ids: ['digit'] } },
      { select: '#\\e9 > .x', expect: { ids: ['unicode'] } },
      { select: '#foo\\a bar > .x', expect: { ids: ['newline'] } },
    ],
  },

  {
    name: 'class seed rejects whitespace after CSS unescape',
    // status: 'only',
    markup: `<div id="root"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const root = document.getElementById('root')!;
        const el = document.createElement('div');
        el.id = 'newline-class';
        el.setAttribute('class', 'foo\nbar');
        root.appendChild(el);
      });
    },
    cases: [
      // .foo\a bar decodes to the class query "foo\nbar", but selector class
      // matching is token-based. getElementsByClassName has different behavior,
      // so the optimizer must not use it for decoded whitespace class names.
      { select: '.foo\\a bar', expect: { ids: [] } },
      { select: '.foo\nbar', expect:   { ids: [] } },
      { byClass: 'foo\nbar', expect:   { ids: ['newline-class'] } },
    ],
  },

  {
    name: 'escaped class selector values in compiled ancestor filter',
    // status: 'only',
    markup: `
      <div class="foo.bar">
        <span id="dot" class="x"></span>
      </div>

      <div class="foo+bar">
        <span id="plus" class="x"></span>
      </div>

      <div class="foo[bar]">
        <span id="bracket" class="x"></span>
      </div>

      <div class="foo\\bar">
        <span id="backslash" class="x"></span>
      </div>

      <div class="123">
        <span id="digit" class="x"></span>
      </div>

      <div class="é">
        <span id="unicode" class="x"></span>
      </div>

      <div class="foo&#10;bar">
        <span id="newline" class="x"></span>
      </div>

      <div class="alpha foo.bar omega">
        <span id="multi" class="x"></span>
      </div>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the escaped class selector is
      // checked by the compiled ancestor filter.
      { select: '.foo\\.bar > .x',    expect: { ids: ['dot', 'multi'] } },
      { select: '.foo\\+bar > .x',    expect: { ids: ['plus'] } },
      { select: '.foo\\[bar\\] > .x', expect: { ids: ['bracket'] } },
      { select: '.foo\\\\bar > .x',   expect: { ids: ['backslash'] } },
      { select: '.\\31 23 > .x',      expect: { ids: ['digit'] } },
      { select: '.\\e9 > .x',         expect: { ids: ['unicode'] } },

      // The decoded class fragment contains LF, so it cannot be one class token.
      { select: '.foo\\a bar > .x',   expect: { ids: [] } },
    ],
  },

  {
    name: 'compiled class filter does not match missing class attribute as null',
    // status: 'only',
    markup: `
      <div>
        <span id="missing-class" class="x"></span>
      </div>

      <div class="null">
        <span id="real-null-class" class="x"></span>
      </div>
    `,
    cases: [
      // The rightmost .x is the optimized seed; .null is checked by the compiled
      // ancestor filter. Missing class must not be coerced to the string "null".
      { select: '.null > .x', expect: { ids: ['real-null-class'] } },
    ],
  },

  {
    name: 'compiled class filter treats dot as class separator unless escaped',
    // status: 'only',
    markup: `
      <div class="foo.bar">
        <span id="literal-dot" class="x"></span>
      </div>

      <div class="foo bar">
        <span id="compound" class="x"></span>
      </div>
    `,
    cases: [
      { select: '.foo.bar > .x', expect: { ids: ['compound'] } },
      { select: '.foo\\.bar > .x', expect: { ids: ['literal-dot'] } },
    ],
  },

  {
    name: 'compiled class filter is case-sensitive in standards mode',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div class="LOUD">
            <span id="upper" class="x"></span>
          </div>
          <div class="loud">
            <span id="lower" class="x"></span>
          </div>
        </body>
      </html>
    `,
    cases: [
      { select: '.loud > .x', expect: { ids: ['lower'] } },
    ],
  },

  {
    name: 'compiled class filter is case-insensitive in quirks mode',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <html>
        <body>
          <div class="LOUD">
            <span id="upper" class="x"></span>
          </div>
          <div class="loud">
            <span id="lower" class="x"></span>
          </div>
        </body>
      </html>
    `,
    cases: [
      { select: '.loud > .x', expect: { ids: ['upper', 'lower'] } },
    ],
  },

  {
    name: 'HTML tag selector values in compiled ancestor filter',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <div>
            <span id="div-lower" class="x"></span>
          </div>

          <x-foo>
            <span id="custom-lower" class="x"></span>
          </x-foo>
        </body>
      </html>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the tag selector is checked by
      // the compiled ancestor filter.
      { select: 'div > .x', expect: { ids: ['div-lower'] } },
      { select: 'DIV > .x', expect: { ids: ['div-lower'] } },
      { select: 'd\\69v > .x', expect: { ids: ['div-lower'] } },

      { select: 'x-foo > .x', expect: { ids: ['custom-lower'] } },
      { select: 'X-FOO > .x', expect: { ids: ['custom-lower'] } },
      { select: 'x\\-foo > .x', expect: { ids: ['custom-lower'] } },
    ],
  },

  {
    name: 'XML tag selector values in compiled ancestor filter',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root>
        <Item>
          <child id="upper-item" class="x" />
        </Item>

        <item>
          <child id="lower-item" class="x" />
        </item>
      </root>
    `,
    cases: [
      // XML tag selectors are case-sensitive.
      { select: 'Item > .x', expect: { ids: ['upper-item'] } },
      { select: 'item > .x', expect: { ids: ['lower-item'] } },
      { select: 'ITEM > .x', expect: { ids: [] } },

      // Escaped CSS identifier spelling should decode before comparison.
      { select: 'It\\65m > .x', expect: { ids: ['upper-item'] } },
      { select: 'it\\65m > .x', expect: { ids: ['lower-item'] } },
    ],
  },

  {
    name: 'escaped leading XML tag selector in compiled ancestor filter',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root>
        <Item>
          <child id="upper-item" class="x" />
        </Item>
        <item>
          <child id="lower-item" class="x" />
        </item>
      </root>
    `,
    cases: [
      // \49 is "I"; XML remains case-sensitive.
      { select: '\\49 tem > .x', expect: { ids: ['upper-item'] } },
      { select: '\\69 tem > .x', expect: { ids: ['lower-item'] } },
    ],
  },

  {
    name: 'namespace selectors in compiled ancestor filter',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <test:root xmlns:test="http://example/test">
        <test:item>
          <child id="namespaced" class="x" />
        </test:item>

        <item>
          <child id="plain" class="x" />
        </item>

        <t:item xmlns:t="http://example/test">
          <child id="non-root-prefix" class="x" />
        </t:item>
      </test:root>
    `,
    cases: [
      // The rightmost .x is the optimized seed; the namespace/local-name selector
      // is checked by the compiled ancestor filter.
      { select: '*|item > .x', expect: { ids: ['namespaced', 'plain', 'non-root-prefix'] } },
      { select: '|item > .x', expect: { ids: ['plain'] } },
      { select: 'test|item > .x', expect: { throws: true } },
      { select: 'te\\73t|item > .x', expect: { throws: true } },

      // Escaped local names are handled by the tag resolver after the namespace part.
      { select: '*|it\\65m > .x', expect: { ids: ['namespaced', 'plain', 'non-root-prefix'] } },
      { select: '|it\\65m > .x', expect: { ids: ['plain'] } },

      // DOM querySelectorAll does not provide a namespace resolver, so named
      // namespace prefixes are invalid even when declared in the XML document.
      { select: 't|item > .x', expect: { throws: true } },
      { select: '\\74|item > .x', expect: { throws: true } },
    ],
  },

  {
    name: 'attribute value selectors do not match missing attributes as null',
    // status: 'only',
    markup: `
      <div>
        <span id="missing" class="x"></span>
      </div>

      <div data-value="null">
        <span id="real-null" class="x"></span>
      </div>

      <div data-value="n">
        <span id="starts-n" class="x"></span>
      </div>

      <div data-value="bell">
        <span id="ends-ll" class="x"></span>
      </div>

      <div data-value="sun">
        <span id="contains-u" class="x"></span>
      </div>
    `,
    cases: [
      // Missing attributes must not be coerced to the string "null".
      { select: '[data-value="null"] > .x', expect: { ids: ['real-null'] } },
      { select: '[data-value^="n"] > .x', expect: { ids: ['real-null', 'starts-n'] } },
      { select: '[data-value$="ll"] > .x', expect: { ids: ['real-null', 'ends-ll'] } },
      { select: '[data-value*="u"] > .x', expect: { ids: ['real-null', 'contains-u'] } },
    ],
  },

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
    name: 'registered combinator extension',
    // status: 'only',
    engines: ['nw'],
    markup: `
      <div class="card">
        <section>
          <h2 id="grandchild" class="title"></h2>
        </section>
      </div>

      <div class="card">
        <h2 id="child" class="title"></h2>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const nwdom = NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom not found');

        nwdom.registerCombinator('^', source =>
          `if(e&&(e=e.parentElement)&&(e=e.parentElement)){${source}}`
        );
      });
    },
    cases: [
      { select: '.card ^ .title', expect: { ids: ['grandchild'] }, debug: false },
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
    name: 'missing functional pseudo closing paren',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="root">
        <div id="a" class="a"></div>
        <div id="b" class="b"></div>
      </div>
    `,
    cases: [
      { select: ':is(.a, .b)', expect: { ids: ['a', 'b'] } },

      // Missing final ')' on the functional pseudo.
      { select: ':is(.a, .b', expect: { throws: false, count: 2 } },

      // A few neighboring malformed forms for comparison.
      { select: ':not(.a', expect: { throws: false, count: 5 } },
      { select: ':where(.a, .b', expect: { throws: false, count: 2 } },
      { select: ':has(.a', expect: { throws: false, count: 3 } },
    ],
  },

  {
    name: 'linguistic pseudos basic behavior',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <div id="en" lang="en"></div>
      <div id="en-us" lang="en-US"></div>
      <div id="fr" lang="fr"></div>
      <div id="rtl" dir="rtl">abc</div>
      <div id="ltr" dir="ltr">abc</div>
    `,
    cases: [
      { select: 'div:lang(en)', expect: { ids: ['en', 'en-us'] } },
      { select: 'div:dir(rtl)', expect: { ids: ['rtl'] } },
      { select: 'div:dir(ltr)', expect: { ids: ['en','en-us','fr','ltr'] } },
      { select: 'div:dir(tlr)', expect: { ids: [] } },
    ],
  },

  {
    name: 'dir auto uses first strong character',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <div id="auto-ltr" dir="auto">abc אבג</div>
      <div id="auto-rtl" dir="auto">אבג abc</div>
    `,
    cases: [
      { select: '#auto-ltr:dir(ltr)', expect: { ids: ['auto-ltr'] } },
      { select: '#auto-ltr:dir(rtl)', expect: { count: 0 } },
      { select: '#auto-rtl:dir(rtl)', expect: { ids: ['auto-rtl'] } },
      { select: '#auto-rtl:dir(ltr)', expect: { count: 0 } },
    ],
  },

  {
    name: 'lang inherited subtags',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <section id="parent" lang="en-US">
        <div id="child"></div>
      </section>
    `,
    cases: [
      { select: '#child:lang(en)', expect: { ids: ['child'] } },
      { select: '#child:lang(en-US)', expect: { ids: ['child'] } },
    ],
  },

  {
    name: 'location pseudos link element coverage',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <head>
          <link id="link-el" rel="author" href="/author">
        </head>
        <body>
          <a id="a-el" href="#a">a</a>
          <map name="m">
            <area id="area-el" href="#area">
          </map>
          <abbr id="abbr-el" href="#fake">abbr</abbr>
        </body>
      </html>
    `,
    url: 'https://test.local/page',
    cases: [
      { select: ':any-link', expect: { ids: ['a-el', 'area-el'] } },
      { select: ':link', expect: { ids: ['a-el', 'area-el'] } },
      { select: 'abbr:any-link', expect: { count: 0 } },
      { select: 'abbr:link', expect: { count: 0 } },
    ],
  },

  {
    name: 'defined matches built-in elements and defined custom elements',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-body',
    markup: `
      <div id="div-el"></div>
      <span id="span-el"></span>
      <x-later id="later-el"></x-later>
      <x-ready id="ready-el"></x-ready>
      <foo id="foo-el"></foo>
    `,
    setupPage: async page => {
      await page.evaluate(() => {
        customElements.define('x-ready', class extends HTMLElement {});
      });
    },
    cases: [
      { select: '#div-el:defined', expect: { ids: ['div-el'] } },
      { select: '#span-el:defined', expect: { ids: ['span-el'] } },
      { select: '#ready-el:defined', expect: { ids: ['ready-el'] } },
      { select: '#later-el:defined', expect: { ids: [] } },
      { select: '#foo-el:defined', expect: { ids: ['foo-el'] } },
    ],
  },

  {
    name: 'target matches raw fragment id',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-document',
    url: 'https://test.local/page',
    setupPage: async page => {
      await page.goto('https://test.local/page#a%20b');
    },
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="a b"></div>
          <div id="a%20b"></div>
        </body>
      </html>
    `,
    cases: [
      { select: ':target', expect: { ids: ['a%20b'] } },
    ],
  },

  {
    name: 'target basic id matching',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'html-document',
    url: 'https://test.local/page',
    setupPage: async page => {
      await page.goto('https://test.local/page#target');
    },
    markup: `
      <!doctype html>
      <html>
        <body>
          <div id="target"></div>
          <div id="other"></div>
        </body>
      </html>
    `,
    cases: [
      { select: ':target', expect: { ids: ['target'] } },
    ],
  },

  {
    name: 'defined in xml document',
    // status: 'only',
    // engines: ['native'],
    markupMode: 'xml-document',
    markup: `
      <root>
        <foo id="foo"/>
        <x-later id="later"/>
      </root>
    `,
    cases: [
      { select: 'foo:defined', expect: { ids: ['foo'] } },
      { select: 'x-later:defined', expect: { ids: ['later'] } },
    ],
  },

  {
    name: 'visited is not exposed through selector matching',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <a id="a" href="/x">x</a>
      <abbr id="abbr" href="/fake">abbr</abbr>
    `,
    setupPage: async page => {
      await page.evaluate(() => {
        (document.getElementById('a') as any).visited = true;
        (document.getElementById('abbr') as any).visited = true;
      });
    },
    cases: [
      { select: ':visited', expect: { count: 0 } },
      { select: 'a:visited', expect: { count: 0 } },
      { select: 'abbr:visited', expect: { count: 0 } },
      { select: ':any-link', expect: { ids: ['a'] } },
    ],
  },

  {
    name: 'user action hover matches target ancestors',
    // status: 'only',
    markup: `
      <div id="outer" style="width:40px;height:40px;">
        <div id="inner" style="width:20px;height:20px;"></div>
      </div>`,
    steps: [
      {
        setupPage: async page => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:hover', expect: { ids: [] } },
          { select: '#outer:hover', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.locator('#inner').hover();
        },
        cases: [
          { select: '#inner:hover', expect: { ids: ['inner'] } },
          { select: '#outer:hover', expect: { ids: ['outer'] } },
        ],
      },
    ],
  },

  {
    name: 'user action focus active and focus-visible behavior',
    // status: 'only',
    markup: `<input id="a" autofocus><input id="b">`,
    setupPage: async page => {
      await page.locator('#b').focus();
    },
    cases: [
      { select: '#b:focus', expect: { ids: ['b'] } },
      { select: '#a:focus', expect: { ids: [] } },
      { select: 'input:focus', expect: { ids: ['b'] } },

      // :active is not the same as document.activeElement.
      { select: '#b:active', expect: { ids: [] } },

      // autofocus alone does not imply current focus/focus-visible.
      { select: '#a:focus-visible', expect: { ids: [] } },

      // Focused text inputs are focus-visible in the tested engines.
      { select: '#b:focus-visible', expect: { ids: ['b'] } },
    ],
  },

  {
    name: 'user action focus-within matches focused element ancestors',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
      <body id="body">
        <div id="outer">
          <input id="inner">
        </div>
        <div id="other"></div>
      </body>
      </html>`,
    setupPage: async page => {
      await page.locator('#inner').focus();
    },
    cases: [
      { select: '#inner:focus-within', expect: { ids: ['inner'] } },
      { select: '#outer:focus-within', expect: { ids: ['outer'] } },
      { select: '#body:focus-within', expect: { ids: ['body'] } },
      { select: '#other:focus-within', expect: { ids: [] } },

      // :focus-visible is not ancestor-propagating.
      { select: '#outer:focus-visible', expect: { ids: [] } },
      { select: '#inner:focus-visible', expect: { ids: ['inner'] } },
    ],
  },

  {
    name: 'user action focus matches programmatic tabindex focus',
    // status: 'only',
    markup: `<div id="x" tabindex="-1"></div><input id="y">`,
    setupPage: async page => {
      await page.locator('#x').evaluate(el => (el as HTMLElement).focus());
    },
    cases: [
      { select: '#x:focus', expect: { ids: ['x'] } },
      { select: '#y:focus', expect: { ids: [] } },
    ],
  },

  {
    name: 'user action active matches pressed element ancestors',
    // status: 'only',
    markup: `
      <div id="outer" style="width:40px;height:40px;">
        <button id="inner" style="display:block;width:20px;height:20px;padding:0;"></button>
      </div>
      <div id="other" style="width:20px;height:20px;"></div>`,
    steps: [
      {
        setupPage: async page => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.locator('#inner').hover();
          await page.mouse.down();
        },
        cases: [
          { select: '#inner:active', expect: { ids: ['inner'] } },
          { select: '#outer:active', expect: { ids: ['outer'] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.mouse.up();
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active follows pointer down state',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="outer" style="width:40px;height:40px;">
        <div id="inner" style="width:20px;height:20px;"></div>
      </div>
      <div id="other" style="width:20px;height:20px;"></div>`,
    steps: [
      {
        setupPage: async page => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:hover', expect: { ids: [] } },
          { select: '#outer:hover', expect: { ids: [] } },
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.locator('#inner').hover();
        },
        cases: [
          { select: '#inner:hover', expect: { ids: ['inner'] } },
          { select: '#outer:hover', expect: { ids: ['outer'] } },
          { select: '#inner:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.mouse.down();
        },
        cases: [
          { select: '#inner:active', expect: { ids: ['inner'] } },
          { select: '#outer:active', expect: { ids: ['outer'] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.mouse.up();
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active matches pressed ordinary div',
    // status: 'only',
    markup: `<div id="x" style="width:20px;height:20px;"></div>`,
    steps: [
      {
        setupPage: async page => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#x:hover', expect: { ids: [] } },
          { select: '#x:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.locator('#x').hover();
          await page.mouse.down();
        },
        cases: [
          { select: '#x:hover', expect: { ids: ['x'] } },
          { select: '#x:active', expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async page => {
          await page.mouse.up();
        },
        cases: [
          { select: '#x:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active keyboard activation state',
    // status: 'only',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer">
        <button id="inner">x</button>
      </div>
      <button id="other">y</button>`,
    steps: [
      {
        setupPage: async page => {
          await page.locator('#inner').focus();
        },
        cases: [
          { select: '#inner:focus', expect: { ids: ['inner'] } },
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.keyboard.down('Space');
        },
        cases: [
          { select: '#inner:active', expect: { ids: ['inner'] }, browsers: ['chromium', 'webkit'] },
          { select: '#inner:active', expect: { ids: [] }, browsers: ['firefox'] },
          { select: '#outer:active', expect: { ids: [] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.keyboard.up('Space');
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action focus pseudos distinguish focus visible and within',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html">
      <body id="body">
        <section id="outer">
          <div id="middle">
            <input id="inner">
          </div>
        </section>
        <input id="other">
      </body>
      </html>`,
    setupPage: async page => {
      await page.locator('#inner').focus();
    },
    cases: [
      // :focus matches the focused element itself only.
      { select: '#inner:focus', expect: { ids: ['inner'] } },
      { select: '#middle:focus', expect: { ids: [] } },
      { select: '#outer:focus', expect: { ids: [] } },
      { select: '#other:focus', expect: { ids: [] } },

      // For focused text inputs, native engines expose :focus-visible.
      // Unlike :focus-within, it does not propagate to ancestors.
      { select: '#inner:focus-visible', expect: { ids: ['inner'] } },
      { select: '#middle:focus-visible', expect: { ids: [] } },
      { select: '#outer:focus-visible', expect: { ids: [] } },

      // :focus-within matches the focused element and its ancestors.
      { select: '#inner:focus-within', expect: { ids: ['inner'] } },
      { select: '#middle:focus-within', expect: { ids: ['middle'] } },
      { select: '#outer:focus-within', expect: { ids: ['outer'] } },
      { select: '#body:focus-within', expect: { ids: ['body'] } },
      { select: '#other:focus-within', expect: { ids: [] } },

      // Useful aggregate comparisons.
      { select: ':focus', expect: { ids: ['inner'] } },
      { select: ':focus-visible', expect: { ids: ['inner'] } },
      { select: ':focus-within', expect: { ids: ['html', 'body', 'outer', 'middle', 'inner'] } },
    ],
  },

  {
    name: 'user action focus-visible differs from focus for pointer-focused button',
    status: 'fixme',
    // engines: ['native'],
    // browsers: ['webkit'],
    markup: `
      <button id="button" style="display:block;width:40px;height:30px;">x</button>
      <input id="input" style="display:block;width:80px;height:30px;">`,
    steps: [
      {
        setupPage: async page => {
          await page.locator('#button').click();
        },
        cases: [
          { select: '#button:focus', expect: { ids: ['button'] }, browsers: ['chromium', 'firefox'] },
          { select: '#button:focus', expect: { ids: [] }, browsers: ['webkit'] },

          // Mouse-focused buttons generally do not get focus-visible.
          { select: '#button:focus-visible', expect: { ids: [] } },

          { select: '#input:focus', expect: { ids: [] } },
          { select: '#input:focus-visible', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.locator('#input').click();
        },
        cases: [
          { select: '#input:focus', expect: { ids: ['input'] } },

          // Text inputs support keyboard input, so browsers normally expose
          // focus-visible even when focus came from a pointer click.
          { select: '#input:focus-visible', expect: { ids: ['input'] } },

          { select: '#button:focus', expect: { ids: [] } },
          { select: '#button:focus-visible', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'shadow-root/declarative-slot',
    // status: 'only',
    markup: `
      <div id="host">
        <span id="light" slot="x"></span>
        <template shadowrootmode="open">
          <slot name="x"></slot>
        </template>
      </div>
    `,
    cases: [
      { select: '#light', ref: { by: 'id', id: 'host' }, expect: { ids: ['light'] } },
      { select: '#light', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
      { select: 'slot', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'shadow-root/basic-query-context',
    // status: 'only',
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' })!.innerHTML =
          `<section><p id="inside" class="x"></p></section>`;
      });
    },
    cases: [
      { select: '#inside', expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: 'section .x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'shadow-root/closest-stays-inside-shadow-tree',
    // status: 'only',
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' })!.innerHTML =
          `<section id="section"><p id="inside"></p></section>`;
      });
    },
    cases: [
      { closest: 'section', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['section'] } },
      { closest: '#host', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { count: 0 } },
    ],
  },

  {
    name: 'shadow-root/slotted-light-dom-is-not-shadow-descendant',
    // status: 'only',
    markup: `<div id="host"><span id="light" slot="x"></span></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' })!.innerHTML = `<slot name="x"></slot>`;
      });
    },
    cases: [
      { select: '#light', ref: { by: 'id', id: 'host' }, expect: { ids: ['light'] } },
      { select: '#light', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
      { select: 'slot', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'shadow-root/nested-shadow-context',
    // status: 'only',
    markup: `<div id="outer"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const outer = document.getElementById('outer')!;
        const outerRoot = outer.attachShadow({ mode: 'open' })!;
        outerRoot.innerHTML = `<div id="inner-host"></div>`;
        outerRoot.getElementById('inner-host')!.attachShadow({ mode: 'open' })!.innerHTML =
          `<p id="deep" class="x"></p>`;
      });
    },
    cases: [
      { select: '#deep', expect: { count: 0 } },
      { select: '#deep', ref: { by: 'shadowRoot', id: 'outer' }, expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'inner-host', within: { by: 'shadowRoot', id: 'outer' } }, expect: { ids: ['deep'] } },
    ],
  },

  {
    name: 'shadow-root/declarative-basic',
    // status: 'only',
    markup: `
      <div id="host">
        <template shadowrootmode="open">
          <p id="inside" class="x"></p>
        </template>
      </div>
    `,
    cases: [
      { select: '#inside', expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'user action focus-within crosses shadow boundary',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer">
        <div id="host">
          <template shadowrootmode="open">
            <section id="shadowOuter">
              <input id="inner">
            </section>
          </template>
        </div>
        <div id="other"></div>
      </div>
    `,
    setupPage: async page => {
      await page.locator('#host').evaluate(host => {
        const input = (host as HTMLElement).shadowRoot!.getElementById('inner') as HTMLInputElement;
        input.focus();
      });
    },
    cases: [
      { select: '#inner:focus', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
      { select: '#shadowOuter:focus-within', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['shadowOuter'] } },

      // These are the cross-boundary cases parentElement walking will miss.
      { select: '#host:focus-within', expect: { ids: ['host'] } },
      { select: '#outer:focus-within', expect: { ids: ['outer'] } },
      { select: '#other:focus-within', expect: { ids: [] } },
    ],
  },

  {
    name: 'user action hover crosses shadow boundary',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer" style="width:80px;height:80px;">
        <div id="host" style="display:block;width:60px;height:60px;">
          <template shadowrootmode="open">
            <section id="shadowOuter" style="display:block;width:40px;height:40px;">
              <div id="inner" style="width:20px;height:20px;"></div>
            </section>
          </template>
        </div>
        <div id="other" style="width:20px;height:20px;"></div>
      </div>
    `,
    steps: [
      {
        setupPage: async page => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#shadowOuter:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#host:hover', expect: { ids: [] } },
          { select: '#outer:hover', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.locator('#host').evaluate(host => {
            const inner = (host as HTMLElement).shadowRoot!.getElementById('inner') as HTMLElement;
            inner.scrollIntoView();
          });
          const box = await page.locator('#host').boundingBox();
          if (!box) throw new Error('missing host box');
          await page.mouse.move(box.x + 10, box.y + 10);
        },
        cases: [
          { select: '#inner:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
          { select: '#shadowOuter:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['shadowOuter'] } },

          // Cross-boundary propagation.
          { select: '#host:hover', expect: { ids: ['host'] } },
          { select: '#outer:hover', expect: { ids: ['outer'] } },
          { select: '#other:hover', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active crosses shadow boundary',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer" style="width:80px;height:80px;">
        <div id="host" style="display:block;width:60px;height:60px;">
          <template shadowrootmode="open">
            <section id="shadowOuter" style="display:block;width:40px;height:40px;">
              <button id="inner" style="display:block;width:20px;height:20px;padding:0;"></button>
            </section>
          </template>
        </div>
        <div id="other" style="width:20px;height:20px;"></div>
      </div>
    `,
    steps: [
      {
        setupPage: async page => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#shadowOuter:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#host:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          const box = await page.locator('#host').boundingBox();
          if (!box) throw new Error('missing host box');
          await page.mouse.move(box.x + 10, box.y + 10);
          await page.mouse.down();
        },
        cases: [
          { select: '#inner:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
          { select: '#shadowOuter:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['shadowOuter'] } },

          // Cross-boundary propagation.
          { select: '#host:active', expect: { ids: ['host'] } },
          { select: '#outer:active', expect: { ids: ['outer'] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.mouse.up();
        },
        cases: [
          { select: '#inner:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#host:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active propagates from label to labeled control',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <label id="label" for="control" style="display:block;width:80px;height:30px;">label</label>
      <input id="control" style="display:block;width:80px;height:30px;">
    `,
    steps: [
      {
        setupPage: async page => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#label:active', expect: { ids: [] } },
          { select: '#control:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async page => {
          await page.locator('#label').hover();
          await page.mouse.down();
        },
        cases: [
          { select: '#label:active', expect: { ids: ['label'] } },
          { select: '#control:active', expect: { ids: ['control'] } },
        ],
      },
      {
        setupPage: async page => {
          await page.mouse.up();
        },
        cases: [
          { select: '#label:active', expect: { ids: [] } },
          { select: '#control:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'input state enabled includes option and optgroup',
    // status: 'only',
    markup: `
      <select id="select">
        <optgroup id="group">
          <option id="option">x</option>
        </optgroup>
      </select>
    `,
    cases: [
      { select: '#select:enabled', expect: { ids: ['select'] } },
      { select: '#group:enabled', expect: { ids: ['group'] } },
      { select: '#option:enabled', expect: { ids: ['option'] } },
    ],
  },

  {
    name: 'input state enabled respects disabled fieldset',
    // status: 'only',
    markup: `
      <fieldset id="fs" disabled>
        <input id="inside">
        <button id="button">x</button>
      </fieldset>
      <input id="outside">
    `,
    cases: [
      { select: '#inside:enabled', expect: { ids: [] } },
      { select: '#button:enabled', expect: { ids: [] } },
      { select: '#outside:enabled', expect: { ids: ['outside'] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
      { select: '#button:disabled', expect: { ids: ['button'] } },
    ],
  },

  {
    name: 'input state disabled fieldset first legend exception',
    // status: 'only',
    markup: `
      <fieldset id="fs" disabled>
        <legend id="legend">
          <input id="legendInput">
        </legend>
        <input id="inside">
      </fieldset>
    `,
    cases: [
      { select: '#legendInput:enabled', expect: { ids: ['legendInput'] } },
      { select: '#legendInput:disabled', expect: { ids: [] } },
      { select: '#inside:enabled', expect: { ids: [] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'input state disabled fieldset only first legend excepted',
    // status: 'only',
    markup: `
      <fieldset disabled>
        <legend id="first"><input id="firstInput"></legend>
        <legend id="second"><input id="secondInput"></legend>
        <input id="inside">
      </fieldset>
    `,
    cases: [
      { select: '#firstInput:enabled', expect: { ids: ['firstInput'] } },
      { select: '#firstInput:disabled', expect: { ids: [] } },
      { select: '#secondInput:enabled', expect: { ids: [] } },
      { select: '#secondInput:disabled', expect: { ids: ['secondInput'] } },
      { select: '#inside:enabled', expect: { ids: [] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'input state disabled fieldset legend exception is scoped',
    // status: 'only',
    markup: `
      <fieldset id="outer" disabled>
        <fieldset id="inner">
          <legend id="innerLegend">
            <input id="innerLegendInput">
          </legend>
        </fieldset>
        <legend id="outerLegend">
          <input id="outerLegendInput">
        </legend>
      </fieldset>
    `,
    cases: [
      // Inner fieldset legend does not exempt from outer disabled fieldset.
      { select: '#innerLegendInput:disabled', expect: { ids: ['innerLegendInput'] } },
      { select: '#innerLegendInput:enabled', expect: { ids: [] } },
      { select: '#outerLegendInput:disabled', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state disabled fieldset only first direct legend is excepted',
    // status: 'only',
    markup: `
      <fieldset id="outer" disabled>
        <legend id="firstLegend">
          <input id="firstLegendInput">
        </legend>
        <legend id="secondLegend">
          <input id="secondLegendInput">
        </legend>
      </fieldset>
    `,
    cases: [
      { select: '#firstLegendInput:disabled', expect: { ids: [] } },
      { select: '#secondLegendInput:disabled', expect: { ids: ['secondLegendInput'] } },
    ],
  },

  {
    name: 'input state disabled fieldset first legend exception still applies',
    // status: 'only',
    markup: `
      <fieldset id="outer" disabled>
        <legend id="outerLegend">
          <input id="outerLegendInput">
        </legend>
        <input id="inside">
      </fieldset>
    `,
    cases: [
      { select: '#outerLegendInput:disabled', expect: { ids: [] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'input state read-write respects disabled fieldset',
    // status: 'only',
    markup: `
      <fieldset disabled>
        <input id="inside" value="x">
        <textarea id="text"></textarea>
      </fieldset>
      <input id="outside" value="x">
    `,
    cases: [
      { select: '#inside:read-only', expect: { ids: ['inside'] } },
      { select: '#inside:read-write', expect: { ids: [] } },
      { select: '#text:read-only', expect: { ids: ['text'] } },
      { select: '#text:read-write', expect: { ids: [] } },
      { select: '#outside:read-only', expect: { ids: [] } },
      { select: '#outside:read-write', expect: { ids: ['outside'] } },
    ],
  },

  {
    name: 'input state read-only read-write input types',
    // status: 'only',
    markup: `
      <input id="text" type="text">
      <input id="email" type="email">
      <input id="checkbox" type="checkbox">
      <input id="range" type="range">
      <input id="file" type="file">
      <input id="button" type="button">
    `,
    cases: [
      { select: '#text:read-write', expect: { ids: ['text'] } },
      { select: '#email:read-write', expect: { ids: ['email'] } },

      { select: '#checkbox:read-only', expect: { ids: ['checkbox'] } },
      { select: '#range:read-only', expect: { ids: ['range'] } },
      { select: '#file:read-only', expect: { ids: ['file'] } },
      { select: '#button:read-only', expect: { ids: ['button'] } },
    ],
  },

  {
    name: 'input state read-write follows contenteditable inheritance',
    // status: 'only',
    markup: `
      <div id="outer" contenteditable>
        <p id="inner"></p>
      </div>
      <div id="plain"></div>
    `,
    cases: [
      { select: '#outer:read-write', expect: { ids: ['outer'] } },
      { select: '#inner:read-write', expect: { ids: ['inner'] } },
      { select: '#plain:read-only', expect: { ids: ['plain'] } },
    ],
  },

  {
    name: 'input state read-only respects contenteditable false',
    // status: 'only',
    markup: `
      <div id="outer" contenteditable>
        <p id="editable"></p>
        <p id="notEditable" contenteditable="false"></p>
      </div>
    `,
    cases: [
      { select: '#editable:read-write', expect: { ids: ['editable'] } },
      { select: '#notEditable:read-only', expect: { ids: ['notEditable'] } },
      { select: '#notEditable:read-write', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state read-only read-write readonly controls',
    // status: 'only',
    markup: `
      <input id="input" readonly>
      <textarea id="textarea" readonly></textarea>
      <input id="normal">
    `,
    cases: [
      { select: '#input:read-only', expect: { ids: ['input'] } },
      { select: '#input:read-write', expect: { ids: [] } },
      { select: '#textarea:read-only', expect: { ids: ['textarea'] } },
      { select: '#textarea:read-write', expect: { ids: [] } },
      { select: '#normal:read-write', expect: { ids: ['normal'] } },
    ],
  },

  {
    name: 'input state disabled option follows disabled optgroup',
    // status: 'only',
    markup: `
      <select id="select">
        <optgroup id="group" disabled>
          <option id="option">x</option>
        </optgroup>
      </select>`,
    cases: [
      { select: '#group:disabled', expect: { ids: ['group'] } },
      { select: '#option:disabled', expect: { ids: ['option'] } },
      { select: '#option:enabled', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state placeholder-shown matches focused empty input',
    // status: 'only',
    markup: `<input id="x" placeholder="name"><input id="other">`,
    setupPage: async page => {
      await page.locator('#x').focus();
    },
    cases: [
      { select: '#x:focus', expect: { ids: ['x'] } },
      { select: '#x:placeholder-shown', expect: { ids: ['x'] } },
    ],
  },

  {
    name: 'input state placeholder-shown does not match non-empty values',
    // status: 'only',
    markup: `
      <input id="empty" placeholder="name">
      <input id="filled" placeholder="name" value="Eric">
      <textarea id="textEmpty" placeholder="text"></textarea>
      <textarea id="textFilled" placeholder="text">hello</textarea>
    `,
    cases: [
      { select: '#empty:placeholder-shown', expect: { ids: ['empty'] } },
      { select: '#filled:placeholder-shown', expect: { ids: [] } },
      { select: '#textEmpty:placeholder-shown', expect: { ids: ['textEmpty'] } },
      { select: '#textFilled:placeholder-shown', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state placeholder-shown empty placeholder attribute',
    // status: 'only',
    markup: `<input id="x" placeholder="">`,
    cases: [
      { select: '#x:placeholder-shown', expect: { ids: ['x'] }, browsers: ['chromium', 'firefox'] },
      { select: '#x:placeholder-shown', expect: { ids: [] }, browsers: ['webkit'], status: 'fail' }, // webkit does not consider empty placeholder to be "shown"
    ],
  },

  {
    name: 'input state default matches first submit button element',
    // status: 'only',
    markup: `
      <form id="form">
        <button id="first">first</button>
        <button id="second" type="submit">second</button>
        <input id="input" type="submit">
      </form>
    `,
    cases: [
      { select: '#first:default', expect: { ids: ['first'] } },
      { select: '#second:default', expect: { ids: [] } },
      { select: '#input:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default ignores non-submit buttons',
    // status: 'only',
    markup: `
      <form id="form">
        <button id="plainButton" type="button">button</button>
        <input id="submit" type="submit">
      </form>
    `,
    cases: [
      { select: '#plainButton:default', expect: { ids: [] } },
      { select: '#submit:default', expect: { ids: ['submit'] } },
    ],
  },

  {
    name: 'input state default includes image submit controls',
    // status: 'only',
    markup: `
      <form id="form">
        <input id="image" type="image" alt="go">
        <input id="submit" type="submit">
      </form>
    `,
    cases: [
      { select: '#image:default', expect: { ids: ['image'] } },
      { select: '#submit:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default submit precedes image submit',
    // status: 'only',
    markup: `
      <form id="form">
        <input id="submit" type="submit">
        <input id="image" type="image" alt="go">
      </form>
    `,
    cases: [
      { select: '#submit:default', expect: { ids: ['submit'] } },
      { select: '#image:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default matches default checked controls',
    // status: 'only',
    markup: `
      <input id="checkedBox" type="checkbox" checked>
      <input id="uncheckedBox" type="checkbox">
      <input id="checkedRadio" type="radio" name="r" checked>
      <input id="uncheckedRadio" type="radio" name="r">
    `,
    cases: [
      { select: '#checkedBox:default', expect: { ids: ['checkedBox'] } },
      { select: '#uncheckedBox:default', expect: { ids: [] } },
      { select: '#checkedRadio:default', expect: { ids: ['checkedRadio'] } },
      { select: '#uncheckedRadio:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default uses option default selectedness',
    // status: 'only',
    markup: `
      <select id="selectedSelect">
        <option id="first">first</option>
        <option id="selected" selected>selected</option>
      </select>
      <select id="autoSelect">
        <option id="autoFirst">auto first</option>
        <option id="autoSecond">auto second</option>
      </select>
    `,
    cases: [
      { select: '#first:default', expect: { ids: [] } },
      { select: '#selected:default', expect: { ids: ['selected'] } },
      { select: '#autoFirst:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default includes form-associated submit outside form',
    // status: 'only',
    markup: `
      <input id="outside" type="submit" form="form">
      <form id="form">
        <input id="inside" type="submit">
      </form>
    `,
    cases: [
      { select: '#outside:default', expect: { ids: ['outside'] } },
      { select: '#inside:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default includes outside image submit',
    // status: 'only',
    markup: `
      <input id="outsideImage" type="image" form="form" alt="go">
      <form id="form">
        <input id="insideSubmit" type="submit">
      </form>
    `,
    cases: [
      { select: '#outsideImage:default', expect: { ids: ['outsideImage'] } },
      { select: '#insideSubmit:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value checked matches checked controls and selected options',
    // status: 'only',
    markup: `
      <input id="checkedBox" type="checkbox" checked>
      <input id="uncheckedBox" type="checkbox">
      <input id="checkedRadio" type="radio" name="r" checked>
      <input id="uncheckedRadio" type="radio" name="r">
      <select>
        <option id="unselected">a</option>
        <option id="selected" selected>b</option>
      </select>
    `,
    cases: [
      { select: '#checkedBox:checked', expect: { ids: ['checkedBox'] } },
      { select: '#uncheckedBox:checked', expect: { ids: [] } },
      { select: '#checkedRadio:checked', expect: { ids: ['checkedRadio'] } },
      { select: '#uncheckedRadio:checked', expect: { ids: [] } },
      { select: '#selected:checked', expect: { ids: ['selected'] } },
      { select: '#unselected:checked', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value checked follows current option selectedness',
    // status: 'only',
    markup: `
      <select>
        <option id="first" selected>first</option>
        <option id="second">second</option>
      </select>
    `,
    setupPage: async page => {
      await page.evaluate(() => {
        const first = document.getElementById('first') as HTMLOptionElement;
        const second = document.getElementById('second') as HTMLOptionElement;
        first.selected = false;
        second.selected = true;
      });
    },
    cases: [
      { select: '#first:checked', expect: { ids: [] } },
      { select: '#second:checked', expect: { ids: ['second'] } },
    ],
  },

  {
    name: 'input value checked excludes non-checkable input types',
    // status: 'only',
    markup: `
      <input id="text" type="text">
      <input id="button" type="button">
      <input id="hidden" type="hidden">
    `,
    setupPage: async page => {
      await page.evaluate(() => {
        for (const id of ['text', 'button', 'hidden']) {
          (document.getElementById(id) as HTMLInputElement).checked = true;
        }
      });
    },
    cases: [
      { select: '#text:checked', expect: { ids: [] } },
      { select: '#button:checked', expect: { ids: [] } },
      { select: '#hidden:checked', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value checked matches auto-selected first option',
    // status: 'only',
    markup: `
      <select>
        <option id="first">first</option>
        <option id="second">second</option>
      </select>
    `,
    cases: [
      { select: '#first:checked', expect: { ids: ['first'] } },
      { select: '#second:checked', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate matches progress and checkbox states',
    // status: 'only',
    markup: `
      <progress id="progressNoValue"></progress>
      <progress id="progressValue" value="0.5"></progress>
      <input id="box" type="checkbox">
      <input id="plainBox" type="checkbox">
    `,
    setupPage: async page => {
      await page.evaluate(() => {
        (document.getElementById('box') as HTMLInputElement).indeterminate = true;
      });
    },
    cases: [
      { select: '#progressNoValue:indeterminate', expect: { ids: ['progressNoValue'] } },
      { select: '#progressValue:indeterminate', expect: { ids: [] } },
      { select: '#box:indeterminate', expect: { ids: ['box'] } },
      { select: '#plainBox:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate radio group outside form',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="r">
      <input id="b" type="radio" name="r">
      <input id="other" type="radio" name="other" checked>
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: ['a'] } },
      { select: '#b:indeterminate', expect: { ids: ['b'] } },
      { select: '#other:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate radio group outside form with checked member',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="r">
      <input id="b" type="radio" name="r" checked>
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: [] } },
      { select: '#b:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate radio name does not use raw selector text',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="a b">
      <input id="b" type="radio" name="a b">
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: ['a'] } },
      { select: '#b:indeterminate', expect: { ids: ['b'] } },
    ],
  },

  {
    name: 'input value indeterminate radio name with selector syntax',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="x]y">
      <input id="b" type="radio" name="x]y">
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: ['a'] } },
      { select: '#b:indeterminate', expect: { ids: ['b'] } },
    ],
  },

  {
    name: 'input value indeterminate radio group uses form owner',
    // status: 'only',
    markup: `
      <input id="outsideA" type="radio" name="r" form="f">
      <form id="f">
        <input id="insideB" type="radio" name="r">
      </form>
    `,
    cases: [
      { select: '#outsideA:indeterminate', expect: { ids: ['outsideA'] } },
      { select: '#insideB:indeterminate', expect: { ids: ['insideB'] } },
    ],
  },

  {
    name: 'input value indeterminate radio group form owner with checked member',
    // status: 'only',
    markup: `
      <input id="outsideA" type="radio" name="r" form="f" checked>
      <form id="f">
        <input id="insideB" type="radio" name="r">
      </form>
    `,
    cases: [
      { select: '#outsideA:indeterminate', expect: { ids: [] } },
      { select: '#insideB:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value required excludes unsupported input types',
    // status: 'only',
    markup: `
      <input id="text" type="text" required>
      <input id="hidden" type="hidden" required>
      <input id="button" type="button" required>
      <input id="submit" type="submit" required>
      <input id="reset" type="reset" required>
      <input id="range" type="range" required>
      <input id="color" type="color" required>
    `,
    cases: [
      { select: '#text:required', expect: { ids: ['text'] } },
      { select: '#hidden:required', expect: { ids: [] } },
      { select: '#button:required', expect: { ids: [] } },
      { select: '#submit:required', expect: { ids: [] } },
      { select: '#reset:required', expect: { ids: [] } },
      { select: '#range:required', expect: { ids: [] } },
      { select: '#color:required', expect: { ids: [] }, browsers: ['chromium', 'firefox'] },
      { select: '#color:required', expect: { ids: ['color'] }, browsers: ['webkit'] },
    ],
  },

  {
    name: 'input value required matches supported controls',
    // status: 'only',
    markup: `
      <input id="text" required>
      <input id="email" type="email" required>
      <input id="checkbox" type="checkbox" required>
      <input id="file" type="file" required>
      <select id="select" required><option>x</option></select>
      <textarea id="textarea" required></textarea>
      <input id="optional">
    `,
    cases: [
      { select: '#text:required', expect: { ids: ['text'] } },
      { select: '#email:required', expect: { ids: ['email'] } },
      { select: '#checkbox:required', expect: { ids: ['checkbox'] } },
      { select: '#file:required', expect: { ids: ['file'] } },
      { select: '#select:required', expect: { ids: ['select'] } },
      { select: '#textarea:required', expect: { ids: ['textarea'] } },
      { select: '#optional:required', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value required radio group behavior',
    // status: 'only',
    engines: ['native'],
    markup: `
      <input id="a" type="radio" name="r" required>
      <input id="b" type="radio" name="r">
      <input id="c" type="radio" name="other">
    `,
    cases: [
      { select: '#a:required', expect: { ids: ['a'] } },
      { select: '#b:required', expect: { ids: [] } },
      { select: '#c:required', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value optional matches supported non-required controls',
    // status: 'only',
    markup: `
      <input id="text" type="text">
      <input id="requiredText" type="text" required>
      <select id="select"><option>x</option></select>
      <select id="requiredSelect" required><option>x</option></select>
      <textarea id="textarea"></textarea>
      <textarea id="requiredTextarea" required></textarea>
    `,
    cases: [
      { select: '#text:optional', expect: { ids: ['text'] } },
      { select: '#requiredText:optional', expect: { ids: [] } },
      { select: '#select:optional', expect: { ids: ['select'] } },
      { select: '#requiredSelect:optional', expect: { ids: [] } },
      { select: '#textarea:optional', expect: { ids: ['textarea'] } },
      { select: '#requiredTextarea:optional', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value optional unsupported input type divergence',
    status: 'fail',
    markup: `
      <input id="hidden" type="hidden">
      <input id="button" type="button">
    `,
    cases: [
      { select: '#hidden:optional', expect: { ids: ['hidden'] }, browsers: ['chromium', 'webkit'] },
      { select: '#hidden:optional', expect: { ids: [] }, browsers: ['firefox'] },
      { select: '#button:optional', expect: { ids: ['button'] }, browsers: ['chromium', 'webkit'] },
      { select: '#button:optional', expect: { ids: [] }, browsers: ['firefox'] },
    ],
  },

  {
    name: 'input value invalid ignores form novalidate',
    // status: 'only',
    markup: `
      <form id="form" novalidate>
        <input id="input" required>
      </form>
    `,
    cases: [
      { select: '#form:invalid', expect: { ids: ['form'] } },
      { select: '#input:invalid', expect: { ids: ['input'] } },
      { select: '#input:valid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value fieldset valid requires no invalid descendants',
    // status: 'only',
    markup: `
      <fieldset id="fieldset">
        <input id="validInput" required value="x">
        <input id="invalidInput" required>
      </fieldset>
    `,
    cases: [
      { select: '#validInput:valid', expect: { ids: ['validInput'] } },
      { select: '#invalidInput:invalid', expect: { ids: ['invalidInput'] } },
      { select: '#fieldset:invalid', expect: { ids: ['fieldset'] } },
      { select: '#fieldset:valid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value empty form and fieldset validity',
    // status: 'only',
    markup: `
      <form id="form"></form>
      <fieldset id="fieldset"></fieldset>
    `,
    cases: [
      { select: '#form:valid', expect: { ids: ['form'] } },
      { select: '#form:invalid', expect: { ids: [] } },
      { select: '#fieldset:valid', expect: { ids: ['fieldset'] } },
      { select: '#fieldset:invalid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value form validity includes associated controls outside form',
    // status: 'only',
    markup: `
      <input id="outside" required form="form">
      <form id="form"></form>
    `,
    cases: [
      { select: '#outside:invalid', expect: { ids: ['outside'] } },
      { select: '#form:invalid', expect: { ids: ['form'] } },
      { select: '#form:valid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range basic number bounds',
    // status: 'only',
    markup: `
      <input id="in" type="number" min="1" max="10" value="5">
      <input id="under" type="number" min="1" max="10" value="0">
      <input id="over" type="number" min="1" max="10" value="11">
      <input id="empty" type="number" min="1" max="10">
    `,
    cases: [
      { select: '#in:in-range', expect: { ids: ['in'] } },
      { select: '#in:out-of-range', expect: { ids: [] } },

      { select: '#under:in-range', expect: { ids: [] } },
      { select: '#under:out-of-range', expect: { ids: ['under'] } },

      { select: '#over:in-range', expect: { ids: [] } },
      { select: '#over:out-of-range', expect: { ids: ['over'] } },

      // Empty value is not range underflow/overflow.
      { select: '#empty:in-range', expect: { ids: ['empty'] } },
      { select: '#empty:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range requires bounds for non-range inputs',
    // status: 'only',
    markup: `
      <input id="number" type="number" value="5">
      <input id="date" type="date" value="2024-01-01">
    `,
    cases: [
      { select: '#number:in-range', expect: { ids: [] } },
      { select: '#number:out-of-range', expect: { ids: [] } },
      { select: '#date:in-range', expect: { ids: [] } },
      { select: '#date:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range input has implicit bounds',
    // status: 'only',
    markup: `
      <input id="range" type="range" value="50">
    `,
    cases: [
      { select: '#range:in-range', expect: { ids: ['range'] } },
      { select: '#range:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range ignores formnovalidate',
    // status: 'only',
    markup: `
      <input id="submit" type="submit" formnovalidate>
      <input id="number" type="number" min="1" max="10" value="11" formnovalidate>
    `,
    cases: [
      { select: '#number:out-of-range', expect: { ids: ['number'] } },
      { select: '#number:in-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range does not use formnovalidate submitter state',
    // status: 'only',
    markup: `
      <form>
        <input id="number" type="number" min="1" max="10" value="11">
        <button id="submit" formnovalidate>submit</button>
      </form>
    `,
    cases: [
      { select: '#number:out-of-range', expect: { ids: ['number'] } },
      { select: '#submit:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range ignores disabled fieldset controls',
    // status: 'only',
    markup: `
      <fieldset disabled>
        <input id="number" type="number" min="1" max="10" value="11">
      </fieldset>
    `,
    cases: [
      { select: '#number:out-of-range', expect: { ids: [] } },
      { select: '#number:in-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range excludes unsupported input types',
    // status: 'only',
    markup: `
      <input id="text" type="text" min="1" max="10" value="11">
      <input id="email" type="email" min="1" max="10" value="x@y.com">
      <input id="hidden" type="hidden" min="1" max="10" value="11">
    `,
    cases: [
      { select: '#text:in-range', expect: { ids: [] } },
      { select: '#text:out-of-range', expect: { ids: [] } },
      { select: '#email:in-range', expect: { ids: [] } },
      { select: '#email:out-of-range', expect: { ids: [] } },
      { select: '#hidden:in-range', expect: { ids: [] } },
      { select: '#hidden:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'resource state muted matches audio and video muted property',
    // status: 'only',
    engines: ['nw'],
    markup: `
      <audio id="audio"></audio>
      <video id="video"></video>
      <audio id="plain"></audio>
    `,
    setupPage: async page => {
      await page.evaluate(() => {
        (document.getElementById('audio') as HTMLAudioElement).muted = true;
        (document.getElementById('video') as HTMLVideoElement).muted = true;
      });
    },
    cases: [
      { select: '#audio:muted', expect: { ids: ['audio'] } },
      { select: '#video:muted', expect: { ids: ['video'] } },
      { select: '#plain:muted', expect: { ids: [] } },
    ],
  },

  {
    name: 'resource state paused and seeking exclude non-media elements',
    // status: 'only',
    engines: ['nw'],
    markup: `<div id="x"></div><audio id="audio"></audio>`,
    cases: [
      { select: '#x:paused', expect: { ids: [] } },
      { select: '#x:seeking', expect: { ids: [] } },
      { select: '#x:playing', expect: { ids: [] } },
      { select: '#audio:paused', expect: { ids: ['audio'] } },
    ],
  },

  {
    name: 'resource state native support probe',
    // status: 'only',
    engines: ['native'],
    markup: `<audio id="audio"></audio><video id="video"></video>`,
    cases: [
      { select: '#audio:paused', expect: { throws: true }, browsers: ['chromium', 'firefox'] },
      { select: '#audio:paused', expect: { throws: false, ids: ['audio'] }, browsers: ['webkit'] },
      { select: '#audio:playing', expect: { throws: true }, browsers: ['chromium', 'firefox']  },
      { select: '#audio:playing', expect: { throws: false, ids: [] }, browsers: ['webkit']  },
      { select: '#audio:muted', expect: { throws: true }, browsers: ['chromium', 'firefox']  },
      { select: '#audio:muted', expect: { throws: false, ids: [] }, browsers: ['webkit']  },
    ],
  },

]);
