import { runScenarios } from '../../../scenario/dispatch';

runScenarios('id-selector', 'normal', [
  {
    name: 'id-selector/document-all-awkward-id-names',
    // status: 'only',
    markup: `
      <div id="length" class="id-length"></div>
      <div id="item" class="id-item"></div>
      <div id="namedItem" class="id-namedItem"></div>
    `,
    cases: [
      { select: '#length', expect: { classes: ['id-length'] } },
      { select: '#item', expect: { classes: ['id-item'] } },
      { select: '#namedItem', expect: { classes: ['id-namedItem'] } },

      { first: '#length', expect: { classes: ['id-length'] } },
      { first: '#item', expect: { classes: ['id-item'] } },
      { first: '#namedItem', expect: { classes: ['id-namedItem'] } },
    ],
  },

  {
    name: 'id-selector/element-context-excludes-context-from-duplicate-id-collection',
    // status: 'only',
    markup: `<div id="dup" class="scope"><span id="dup" class="child"></span></div>`,
    cases: [
      { select: '#dup', ref: { by: 'first', selector: 'div#dup' }, expect: { classes: ['child'] } },
    ],
  },

  {
    name: 'id-selector/candidate-strategy-fallbacks',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="root-id" class="html-root">
      <body>
        <div id="root-id" class="body-dup">
          <div id="scope">
            <div id="dup" class="doc-a"></div>
            <input name="dup" class="name-only">
            <section id="subscope">
              <div id="dup" class="doc-b"></div>
            </section>
            <div id="weird.id" class="weird-dot"></div>
            <div id="colon:id" class="weird-colon"></div>
          </div>

          <div id="detached-scope">
            <span id="dup" class="detached-a"></span>
            <span id="dup" class="detached-b"></span>
          </div>

          <div id="fragment-scope">
            <span id="dup" class="fragment-a"></span>
            <span id="dup" class="fragment-b"></span>
          </div>

          <template id="tpl">
            <span id="dup" class="template-a"></span>
            <span id="dup" class="template-b"></span>
          </template>

        </div>
      </body>
      </html>
    `,
    steps: [
      {
        // document.all path where available; fragments still use non-mutation fallback.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = true;
            api.snapshot.hasTreeWalker = true;
          });
        },
        cases: [
          { select: '#dup', expect: { classes: ['doc-a', 'doc-b', 'detached-a', 'detached-b', 'fragment-a', 'fragment-b'] } },
          { select: '#dup', expect: { excludesClasses: ['name-only'] } },
          { select: '#dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a', 'doc-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { select: '#scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { select: '#dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a', 'detached-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a', 'fragment-b'] } },
          { select: '#dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a', 'template-b'] } },
          { select: '#root-id', expect: { classes: ['html-root', 'body-dup'] } },
          { select: '#weird\\.id', expect: { classes: ['weird-dot'] } },
          { select: '#colon\\:id', expect: { classes: ['weird-colon'] } },
          { select: '#weird\\.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
        ],
      },
      {
        // no document.all; mutation enabled; document/fragment can use getElementById mutation.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = true;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = true;
          });
        },
        cases: [
          { select: '#dup', expect: { classes: ['doc-a', 'doc-b', 'detached-a', 'detached-b', 'fragment-a', 'fragment-b'] } },
          { select: '#dup', expect: { excludesClasses: ['name-only'] } },
          { select: '#dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a', 'doc-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { select: '#scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { select: '#dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a', 'detached-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a', 'fragment-b'] } },
          { select: '#dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a', 'template-b'] } },
          { select: '#root-id', expect: { classes: ['html-root', 'body-dup'] } },
          { select: '#weird\\.id', expect: { classes: ['weird-dot'] } },
          { select: '#colon\\:id', expect: { classes: ['weird-colon'] } },
          { select: '#weird\\.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
        ],
      },
      {
        // no document.all; no mutation; TreeWalker fallback.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = true;
          });
        },
        cases: [
          { select: '#dup', expect: { classes: ['doc-a', 'doc-b', 'detached-a', 'detached-b', 'fragment-a', 'fragment-b'] } },
          { select: '#dup', expect: { excludesClasses: ['name-only'] } },
          { select: '#dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a', 'doc-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { select: '#scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { select: '#dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a', 'detached-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a', 'fragment-b'] } },
          { select: '#dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a', 'template-b'] } },
          { select: '#root-id', expect: { classes: ['html-root', 'body-dup'] } },
          { select: '#weird\\.id', expect: { classes: ['weird-dot'] } },
          { select: '#colon\\:id', expect: { classes: ['weird-colon'] } },
          { select: '#weird\\.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
        ],
      },
      {
        // final fallback: tag scan.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = false;
          });
        },
        cases: [
          { select: '#dup', expect: { classes: ['doc-a', 'doc-b', 'detached-a', 'detached-b', 'fragment-a', 'fragment-b'] } },
          { select: '#dup', expect: { excludesClasses: ['name-only'] } },
          { select: '#dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a', 'doc-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { select: '#scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { select: '#dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a', 'detached-b'] } },
          { select: '#dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a', 'fragment-b'] } },
          { select: '#dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a', 'template-b'] } },
          { select: '#root-id', expect: { classes: ['html-root', 'body-dup'] } },
          { select: '#weird\\.id', expect: { classes: ['weird-dot'] } },
          { select: '#colon\\:id', expect: { classes: ['weird-colon'] } },
          { select: '#weird\\.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
        ],
      },
    ],
  },

  {
    name: 'id-selector/xml-id-property-fallbacks',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <root id="xml-root" class="root-class">
        <item id="plain" class="plain"></item>
        <item id="weird.id" class="weird-dot"></item>
        <item id="colon:id" class="weird-colon"></item>
        <item id="ümlaut" class="unicode"></item>
        <item ID="upper-only" class="upper-id-attr"></item>
      </root>
    `,
    steps: [
      {
        // Force TreeWalker fallback.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = true;
          });
        },
        cases: [
          { select: '#xml-root', expect: { classes: ['root-class'] } },
          { select: '#plain', expect: { classes: ['plain'] } },
          { select: '#weird\\.id', expect: { classes: ['weird-dot'] } },
          { select: '#colon\\:id', expect: { classes: ['weird-colon'] } },
          { select: '#ümlaut', expect: { classes: ['unicode'] } },
          { select: '#upper-only', expect: { classes: [] } },
        ],
      },
      {
        // Force tag-scan fallback.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = false;
          });
        },
        cases: [
          { select: '#xml-root', expect: { classes: ['root-class'] } },
          { select: '#plain', expect: { classes: ['plain'] } },
          { select: '#weird\\.id', expect: { classes: ['weird-dot'] } },
          { select: '#colon\\:id', expect: { classes: ['weird-colon'] } },
          { select: '#ümlaut', expect: { classes: ['unicode'] } },
          { select: '#upper-only', expect: { classes: [] } },
        ],
      },
    ],
  },

  {
    name: 'byId/pathway-fallbacks',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="root-id" class="html-root">
      <body>
        <div id="root-id" class="body-dup">
          <div id="scope">
            <div id="dup" class="doc-a"></div>
            <input name="dup" class="name-only">
            <section id="subscope">
              <div id="dup" class="doc-b"></div>
            </section>

            <div id="weird.id" class="weird-dot"></div>
            <div id="colon:id" class="weird-colon"></div>

            <form id="troubleForm" class="hit">
              <input name="id">
            </form>
          </div>

          <div id="detached-scope">
            <span id="dup" class="detached-a"></span>
            <span id="dup" class="detached-b"></span>
          </div>

          <div id="fragment-scope">
            <span id="dup" class="fragment-a"></span>
            <span id="dup" class="fragment-b"></span>
          </div>

          <template id="tpl">
            <span id="dup" class="template-a"></span>
            <span id="dup" class="template-b"></span>
          </template>

        </div>
      </body>
      </html>
    `,
    steps: [
      {
        // document.all path for connected element contexts; document/fragment use getElementById.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = true;
            api.snapshot.hasTreeWalker = true;
          });
        },
        cases: [
          { byId: 'dup', expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { byId: 'scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { byId: 'dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a'] } },
          { byId: 'dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a'] } },
          { byId: 'root-id', expect: { classes: ['html-root'] } },
          { byId: 'weird.id', expect: { classes: ['weird-dot'] } },
          { byId: 'colon:id', expect: { classes: ['weird-colon'] } },
          { byId: 'weird.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
          { byId: 'troubleForm', ref: { by: 'id', id: 'scope' }, expect: { classes: ['hit'] } },
        ],
      },
      {
        // no document.all; mutation enabled for connected element contexts.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = true;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = true;
          });
        },
        cases: [
          { byId: 'dup', expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { byId: 'scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { byId: 'dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a'] } },
          { byId: 'dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a'] } },
          { byId: 'root-id', expect: { classes: ['html-root'] } },
          { byId: 'weird.id', expect: { classes: ['weird-dot'] } },
          { byId: 'colon:id', expect: { classes: ['weird-colon'] } },
          { byId: 'weird.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
          { byId: 'troubleForm', ref: { by: 'id', id: 'scope' }, expect: { classes: ['hit'] } },
        ],
      },
      {
        // no document.all; no mutation; TreeWalker fallback.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = true;
          });
        },
        cases: [
          { byId: 'dup', expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { byId: 'scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { byId: 'dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a'] } },
          { byId: 'dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a'] } },
          { byId: 'root-id', expect: { classes: ['html-root'] } },
          { byId: 'weird.id', expect: { classes: ['weird-dot'] } },
          { byId: 'colon:id', expect: { classes: ['weird-colon'] } },
          { byId: 'weird.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
          { byId: 'troubleForm', ref: { by: 'id', id: 'scope' }, expect: { classes: ['hit'] } },
        ],
      },
      {
        // final fallback: tag scan.
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = false;
            api.snapshot.hasTreeWalker = false;
          });
        },
        cases: [
          { byId: 'dup', expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'scope' }, expect: { classes: ['doc-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['doc-b'] } },
          { byId: 'scope', ref: { by: 'id', id: 'scope' }, expect: { ids: [] } },
          { byId: 'dup', ref: { by: 'id', id: 'detached-scope', home: 'detached' }, expect: { classes: ['detached-a'] } },
          { byId: 'dup', ref: { by: 'id', id: 'fragment-scope', home: 'fragment' }, expect: { classes: ['fragment-a'] } },
          { byId: 'dup', ref: { by: 'template', id: 'tpl' }, expect: { classes: ['template-a'] } },
          { byId: 'root-id', expect: { classes: ['html-root'] } },
          { byId: 'weird.id', expect: { classes: ['weird-dot'] } },
          { byId: 'colon:id', expect: { classes: ['weird-colon'] } },
          { byId: 'weird.id', ref: { by: 'id', id: 'scope' }, expect: { classes: ['weird-dot'] } },
          { byId: 'troubleForm', ref: { by: 'id', id: 'scope' }, expect: { classes: ['hit'] } },
        ],
      },
    ],
  },

  {
    name: 'byId/document-all-nodeType-id-collision',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
      <body>
        <div id="outside">
          <div id="nodeType" class="outside-a"></div>
        </div>

        <div id="scope">
          <div id="nodeType" class="scope-a"></div>
          <div id="nodeType" class="scope-b"></div>

          <section id="subscope">
            <div id="nodeType" class="subscope-a"></div>
          </section>
        </div>
      </body>
      </html>
    `,
    steps: [
      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            const api = selectlet;
            if (!api) throw new Error('selectlet not found');
            api.snapshot.config.MUTATE_IDS = false;
            api.snapshot.hasDocumentAll = true;
            api.snapshot.hasTreeWalker = false;
          });
        },
        cases: [
          // Document context uses native getElementById in public byId(), not byId_AllFirst.
          { byId: 'nodeType', expect: { classes: ['outside-a'] } },

          // If document.all.namedItem('nodeType') returns a collection and
          // `'nodeType' in item` misclassifies it as an Element, these will fail/throw.
          { byId: 'nodeType', ref: { by: 'id', id: 'scope' }, expect: { classes: ['scope-a'] } },
          { byId: 'nodeType', ref: { by: 'id', id: 'subscope' }, expect: { classes: ['subscope-a'] } },
        ],
      },
    ],
  },

  {
    name: 'select grouped id sort/dedupe',
    // status: 'only',
    markup: `
      <div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div><div id="e"></div>
    `,
    cases: [
      { select: '#e, #a, #d, #b, #a, #c, #e, #b', expect: { ids: ['a', 'b', 'c', 'd', 'e'] } },
    ],
  },

]);
