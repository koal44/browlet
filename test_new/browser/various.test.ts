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
    engines: ['native'],
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

  // {
  //   name: 'attribute namespace selectors on xml attributes',
  //   status: 'only',
  //   // browsers: ['firefox'],
  //   markupMode: 'xml-document',
  //   markup: `
  //     <root id="myroot">
  //       <item id="xml-lang" xml:lang="en"/>
  //       <item id="plain-lang" lang="en"/>
  //       <item id="xml-space" xml:space="preserve"/>
  //       <item id="plain-other" other="x"/>
  //     </root>
  //   `,
  //   cases: [
  //     { select: '[lang]', expect: { ids: ['plain-lang'] } },
  //     { select: '[*|lang]', expect: { ids: ['xml-lang', 'plain-lang'] } },
  //     { select: '[|lang]', expect: { ids: [] }, status: 'fixme' },
  //     { select: '[*|l.ng]', expect: { throws: true } },
  //     { select: '[*|l\\.ng]', expect: { count: 0 } },
  //     { select: '[xml|lang]', expect: { throws: true } },
  //     { select: '[*|*]', expect: { throws: true }, status: 'fixme' },
  //     { select: '[xml:lang]', expect: { ids: ['xml-lang'] }, status : 'fixme' },
  //     { select: '[xml\:lang]', expect: { ids: ['xml-lang'] }, status: 'fixme' },
  //     { select: '[xml\\:lang]', expect: { ids: ['xml-lang'] }, status: 'fixme' },
  //   ],
  // },

  // {
  //   name: 'https://stackoverflow.com/questions/62209922/',
  //   status: 'only',
  //   // browsers: ['firefox'],
  //   markupMode: 'xml-document',
  //   markup: `
  //     <!DOCTYPE html>
  //     <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:test="http://example/test">
  //     <head>
  //       <title>Selectors</title>
  //       <link href="selectors.css" rel="stylesheet" type="text/css" />
  //     </head>
  //     <body>
  //       <test:p>Hello</test:p>
  //     </body>
  //     </html>
  //   `,
  //   cases: [
  //     { select: '*|p', expect: { count: 1 } },
  //     { select: 'test\\:p', expect: { count: 1 } },
  //   ],
  // },


]);