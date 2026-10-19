import { runScenarios } from '../../../scenario/dispatch';

runScenarios('lookup', 'normal', [
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
    name: 'native byTag fragment oracle handles non-selector tag names',
    // status: 'only',
    markup: `
      <div id="root">
        <x-foo id="custom"></x-foo>
        <foo.bar id="dot"></foo.bar>
        <foo_bar id="underscore"></foo_bar>
        <foo:bar id="colon"></foo:bar>
        <foo\\:diez id="escaped-colon"></foo\\:diez>
        <foo123 id="digits"></foo123>
      </div>

      <template id="frag">
        <x-foo id="custom"></x-foo>
        <foo.bar id="dot"></foo.bar>
        <foo_bar id="underscore"></foo_bar>
        <foo:bar id="colon"></foo:bar>
        <foo\\:diez id="escaped-colon"></foo\\:diez>
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

      { byTag: 'foo\\:diez', ref: { by: 'id', id: 'root' }, expect: { ids: ['escaped-colon'] } },
      { byTag: 'foo\\:diez', ref: { by: 'template', id: 'frag' }, expect: { ids: ['escaped-colon'] } },

      { byTag: 'foo123', ref: { by: 'id', id: 'root' }, expect: { ids: ['digits'] } },
      { byTag: 'foo123', ref: { by: 'template', id: 'frag' }, expect: { ids: ['digits'] } },
    ],
  },

  {
    name: 'byClass quirks mode matches class names case-insensitively',
    // status: 'only',
    // engines: ['native'],
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
      { byClass: 'foo', expect: { ids: ['upper', 'lower'] } },
      { byClass: 'FOO', expect: { ids: ['upper', 'lower'] } },

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
    browsers: ['chromium'],
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
      { byTag: 'Foo', expect: { ids: ['upper', 'lower'] } },
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
          Array.from(nodes, (el) => el.id);

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
    name: 'byclass/document-fragment-svg-top-level-class',
    // status: 'only',
    markup: `
      <template id=tmpl>
        <svg id=svg1 class="foo" width=10 height=10>
          <circle id=circle1 class="foo" cx=5 cy=5 r=5></circle>
        </svg>
      </template>
    `,
    cases: [
      { byClass: 'foo', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['svg1', 'circle1'] } },
    ],
  },

  {
    name: 'class lookup compound and rehomed contexts',
    // status: 'only',
    markup: `
      <section id="root">
        <div id="a" class="foo bar"></div>
        <div id="b" class="bar foo"></div>
        <div id="c" class="foo"></div>
        <div id="d" class="bar"></div>
        <div id="e" class="foo bar baz"><span id="ee" class="foo bar"></span></div>
      </section>
    `,
    cases: [
      { select: '.foo.bar', expect: { ids: ['a', 'b', 'e', 'ee'] } },
      { select: '.bar.foo', expect: { ids: ['a', 'b', 'e', 'ee'] } },
      { select: '.foo.baz', expect: { ids: ['e'] } },
      { select: '.missing.foo', expect: { count: 0 } },

      { byClass: 'foo bar', expect: { ids: ['a', 'b', 'e', 'ee'] } },
      { byClass: 'bar foo', expect: { ids: ['a', 'b', 'e', 'ee'] } },
      { byClass: 'foo baz', expect: { ids: ['e'] } },
      { byClass: 'missing foo', expect: { count: 0 } },

      { select: '.foo.bar', ref: { by: 'id', id: 'root' }, expect: { ids: ['a', 'b', 'e', 'ee'] } },
      { byClass: 'foo bar', ref: { by: 'id', id: 'root' }, expect: { ids: ['a', 'b', 'e', 'ee'] } },

      { select: '.foo.bar', ref: { by: 'id', id: 'e' }, expect: { ids: ['ee'] } },
      { byClass: 'foo bar', ref: { by: 'id', id: 'e' }, expect: { ids: ['ee'] } },

      { select: '.foo.bar', ref: { by: 'id', id: 'root', home: 'detached' }, expect: { ids: ['a', 'b', 'e', 'ee'] } },
      { byClass: 'foo bar', ref: { by: 'id', id: 'root', home: 'detached' }, expect: { ids: ['a', 'b', 'e', 'ee'] } },

      { select: '.foo.bar', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: ['a', 'b', 'e', 'ee'] } },
      { byClass: 'foo bar', ref: { by: 'id', id: 'root', home: 'fragment' }, expect: { ids: ['a', 'b', 'e', 'ee'] } },
    ],
  },

  {
    name: 'tag lookup includes fragment roots',
    // status: 'only',
    markup: `
      <template id="tpl">
        <div id="a"><span id="aa"></span></div>
        <p id="b"></p>
      </template>
    `,
    cases: [
      { byTag: 'div', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a'] } },
      { byTag: 'span', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['aa'] } },
      { byTag: '*', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a', 'aa', 'b'] } },

      { select: 'div', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a'] } },
      { select: 'span', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['aa'] } },
      { select: '*', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a', 'aa', 'b'] } },
    ],
  },

  {
    name: 'tag lookup case behavior in fragment roots',
    // status: 'only',
    markup: `
      <template id="tpl">
        <div id="a"><span id="aa"></span></div>
        <p id="b"></p>
      </template>
    `,
    cases: [
      { byTag: 'div', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a'] } },
      { byTag: 'DIV', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a'] } },
      { byTag: 'span', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['aa'] } },
      { byTag: 'SPAN', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['aa'] } },

      { select: 'div', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a'] } },
      { select: 'DIV', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['a'] } },
      { select: 'span', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['aa'] } },
      { select: 'SPAN', ref: { by: 'template', id: 'tpl' }, expect: { ids: ['aa'] } },
    ],
  },

  {
    name: 'tag lookup case behavior in xml fragment roots',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root>
        <item id="lower"></item>
        <Item id="upper"></Item>
      </root>
    `,
    cases: [
      { byTag: 'item', ref: { by: 'documentElement' }, expect: { ids: ['lower'] } },
      { byTag: 'Item', ref: { by: 'documentElement' }, expect: { ids: ['upper'] } },

      { select: 'item', ref: { by: 'documentElement' }, expect: { ids: ['lower'] } },
      { select: 'Item', ref: { by: 'documentElement' }, expect: { ids: ['upper'] } },
    ],
  },

  {
    name: 'fragment byTag folding is ascii only',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
        <body>
          <template id="tmpl">
            <FÖÖd id="upper-o-food"></FÖÖd>
            <fööd id="lower-o-food"></fööd>
          </template>
        </body>
      </html>
    `,
    cases: [
      { byTag: 'fÖÖd', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-o-food'] } },
      { byTag: 'fööd', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['lower-o-food'] } },
      { byTag: 'FÖÖD', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-o-food'] } },
    ],
  },

  {
    name: 'template fragment tag selectors preserve roots casing and order',
    // status: 'only',
    markup: `
      <template id="tmpl">
        <div id="d1"><p id="p1"><a id="a1"></a><code id="c1"></code></p></div>
        <section id="s1"><h2 id="h1"></h2><p id="p2"><code id="c2"></code></p></section>
        <article id="ar1"><p id="p3"><a id="a2"></a></p></article>
        <div id="d2"><span id="sp1"></span><p id="p4"></p></div>
        <FÖÖd id="upper-o-food"></FÖÖd>
        <fööd id="lower-o-food"></fööd>
      </template>
    `,
    cases: [
      { select: 'div', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['d1', 'd2'] } },
      { select: 'p', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['p1', 'p2', 'p3', 'p4'] } },
      { select: 'a', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['a1', 'a2'] } },
      { select: 'code', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['c1', 'c2'] } },
      { select: 'section', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['s1'] } },
      { select: 'article', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['ar1'] } },
      { select: 'madeup', ref: { by: 'template', id: 'tmpl' }, expect: { count: 0 } },
      { select: '*', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['d1', 'p1', 'a1', 'c1', 's1', 'h1', 'p2', 'c2', 'ar1', 'p3', 'a2', 'd2', 'sp1', 'p4', 'upper-o-food', 'lower-o-food'] } },

      { select: 'DIV', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['d1', 'd2'] } },
      { select: 'P', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['p1', 'p2', 'p3', 'p4'] } },

      // HTML parser/type selector folding is ASCII-only.
      { select: 'FÖÖD', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-o-food'] } },
      { select: 'fööd', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['lower-o-food'] } },

      // byTag on template fragments should include top-level children and descendants.
      { byTag: 'div', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['d1', 'd2'] } },
      { byTag: 'FÖÖD', ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-o-food'] } },
      { byTagNs: { ns: '*', local: 'fÖÖd' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['upper-o-food'] } },
      { byTagNs: { ns: '*', local: 'fööd' }, ref: { by: 'template', id: 'tmpl' }, expect: { ids: ['lower-o-food'] } },
    ],
  },

  {
    name: 'html-namespace-type-selector-oracle',
    // status: 'only',
    markup: `
      <div id="root">
        <item id="html-item"></item>
        <p id="p"></p>
        <svg id="svg" xmlns="http://www.w3.org/2000/svg">
          <item id="svg-item"></item>
          <circle id="circle"></circle>
        </svg>
      </div>
    `,
    cases: [
      // Plain type selector behavior in HTML document.
      { select: 'item', expect: { ids: ['html-item', 'svg-item'] }, debug: false },
      { select: 'p', expect: { ids: ['p'] } },

      // Any namespace + local name.
      { select: '*|item', expect: { ids: ['html-item', 'svg-item'] } },
      { select: '*|circle', expect: { ids: ['circle'] } },

      // Empty namespace only. In an HTML document, HTML/SVG elements are namespaced,
      { select: '|item', expect: { count: 0 } },
      { select: '|p', expect: { count: 0 } },
      { select: '|circle', expect: { count: 0 } },

      // Universal forms.
      { select: '*', expect: { includesIds: ['root', 'html-item', 'p', 'svg', 'svg-item', 'circle'] } },
      { select: '*|*', expect: { includesIds: ['root', 'html-item', 'p', 'svg', 'svg-item', 'circle'] } },

      // Empty namespace universal.
      { select: '|*', expect: { count: 0 } },
    ],
  },

  {
    name: 'xml-namespace-type-selector-oracle',
    // status: 'only',
    markup: `<?xml version="1.0"?>
      <cp:coreProperties
          xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
          xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title id="title"></dc:title>
        <plain id="plain" xmlns=""></plain>
      </cp:coreProperties>`,
    markupMode: 'xml-document',
    cases: [
      { select: 'coreProperties', expect: { count: 1 } },
      { select: '*|coreProperties', expect: { count: 1 } },
      { select: '|coreProperties', expect: { count: 0 } },

      // Child namespaced element.
      { select: 'title', expect: { ids: ['title'] } },
      { select: '*|title', expect: { ids: ['title'] } },
      { select: '|title', expect: { count: 0 } },

      // Explicit empty namespace element.
      { select: 'plain', expect: { ids: ['plain'] } },
      { select: '*|plain', expect: { ids: ['plain'] } },
      { select: '|plain', expect: { ids: ['plain'] } },

      // Universal namespace forms.
      { select: '*|*', expect: { count: 3 } },
      { select: '|*', expect: { ids: ['plain'] }, browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'] },
      { select: '|*', expect: { ids: [] }, browsers: ['webkit'], engines: ['native'] },
    ],
  },

]);
