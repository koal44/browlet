import { readFileSync } from 'node:fs';
import { runPerfScenarios } from './perf-scenario';

const htmlStandard = readFileSync('test/browser/fixtures/slick/template-standard.html', 'utf8');

runPerfScenarios('jsdom-perf', [
  {
    name: 'select template-standard selector corpus',
    status: 'only',
    markup: htmlStandard,
    markupMode: 'html-document',
    quickIters: 100,
    benches: [
      // ID selectors
      { op: 'select', selector: '#title', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'h1#title', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'div.head h1#title', ref: { by: 'document' }, iters: 1_000 },

      // Class selectors
      { op: 'select', selector: 'dd.vcard > .fn', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: '.vcard .url.fn', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: '.nest.a1 .flatInNest.a6', ref: { by: 'document' }, iters: 1_000 },

      // Attribute selectors
      { op: 'select', selector: 'a.url.fn[lang="tr"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'a[href^="http://www.w3.org/TR/"][href*="selectors"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'a[href$=".html"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'a[name="attribute-substrings"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'a[href*="Consortium/Legal"]', ref: { by: 'document' }, iters: 1_000 },

      // Table / structural selectors
      { op: 'select', selector: 'table.selectorsReview tr > td.pattern', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'li.tocline2 > a[href^="#"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'li.tocline3 > ul.toc a[href="#universal-selector"]', ref: { by: 'document' }, iters: 1_000 },

      // :has()
      { op: 'select', selector: 'tr:has(> td.pattern)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'div.example:has(> pre)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'dd.vcard:has(a.url.fn[href^="mailto:"])', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'h4:has(a[name="attribute-substrings"]) + p + dl dt code', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'div:has(> b.flatOut.a1) > i.flatOut.a2 + b.flatOut.a3', ref: { by: 'document' }, iters: 1_000 },

      // :is()
      { op: 'select', selector: ':is(h1, h2, h3)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'div:is(.head, .subtoc, .example)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'li:is(.tocline2, .tocline3) > a[href^="#"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'a:is(.url.fn, [href^="mailto:"], [href$="css3-selectors"])', ref: { by: 'document' }, iters: 1_000 },

      // Grouped selector lists / multiple arms
      { op: 'select', selector: 'h1#title, div.subtoc > h2, p.copyright', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'td.pattern, td.meaning, td.origin', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'div > b.flatOut.a1, div > i.flatOut.a2, div > b.flatOut.a3', ref: { by: 'document' }, iters: 1_000 },
    ],
  },

  {
    name: 'first template-standard selector corpus',
    status: 'only',
    markup: htmlStandard,
    markupMode: 'html-document',
    quickIters: 100,
    benches: [
      // ID selectors
      { op: 'first', selector: '#title', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'h1#title', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'div.head h1#title', ref: { by: 'document' }, iters: 1_000 },

      // Class selectors
      { op: 'first', selector: 'dd.vcard > .fn', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: '.vcard .url.fn', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: '.nest.a1 .flatInNest.a6', ref: { by: 'document' }, iters: 1_000 },

      // Attribute selectors
      { op: 'first', selector: 'a.url.fn[lang="tr"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'a[href^="http://www.w3.org/TR/"][href*="selectors"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'a[href$=".html"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'a[name="attribute-substrings"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'a[href*="Consortium/Legal"]', ref: { by: 'document' }, iters: 1_000 },

      // Table / structural selectors
      { op: 'first', selector: 'table.selectorsReview tr > td.pattern', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'li.tocline2 > a[href^="#"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'li.tocline3 > ul.toc a[href="#universal-selector"]', ref: { by: 'document' }, iters: 1_000 },

      // :has()
      { op: 'first', selector: 'tr:has(> td.pattern)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'div.example:has(> pre)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'dd.vcard:has(a.url.fn[href^="mailto:"])', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'h4:has(a[name="attribute-substrings"]) + p + dl dt code', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'div:has(> b.flatOut.a1) > i.flatOut.a2 + b.flatOut.a3', ref: { by: 'document' }, iters: 1_000 },

      // :is()
      { op: 'first', selector: ':is(h1, h2, h3)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'div:is(.head, .subtoc, .example)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'li:is(.tocline2, .tocline3) > a[href^="#"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'a:is(.url.fn, [href^="mailto:"], [href$="css3-selectors"])', ref: { by: 'document' }, iters: 1_000 },

      // Grouped selector lists / multiple arms
      { op: 'first', selector: 'h1#title, div.subtoc > h2, p.copyright', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'td.pattern, td.meaning, td.origin', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'div > b.flatOut.a1, div > i.flatOut.a2, div > b.flatOut.a3', ref: { by: 'document' }, iters: 1_000 },
    ],
  },

  {
    name: 'lookup path comparison on template-standard',
    // status: 'only',
    markup: htmlStandard,
    markupMode: 'html-document',
    quickIters: 500,
    benches: [
      // ID: separates cached single lookup from querySelector/querySelectorAll semantics.
      { op: 'byId', id: 'title', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: '#title', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: '#title', ref: { by: 'document' }, iters: 2_000 },

      { op: 'first', selector: 'h1#title', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: 'h1#title', ref: { by: 'document' }, iters: 2_000 },

      // Tag: likely memoized collection path.
      { op: 'byTag', tag: 'h1', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: 'h1', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: 'h1', ref: { by: 'document' }, iters: 2_000 },

      { op: 'byTag', tag: 'a', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: 'a', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: 'a', ref: { by: 'document' }, iters: 2_000 },

      // Class: likely memoized collection path.
      { op: 'byClass', cls: 'vcard', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: '.vcard', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: '.vcard', ref: { by: 'document' }, iters: 2_000 },

      { op: 'byClass', cls: 'tocline2', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: '.tocline2', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: '.tocline2', ref: { by: 'document' }, iters: 2_000 },

      // Attribute-only: no obvious native cached seed; useful contrast against ID/class/tag.
      { op: 'first', selector: '[name="attribute-substrings"]', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: '[name="attribute-substrings"]', ref: { by: 'document' }, iters: 2_000 },

      { op: 'first', selector: '[href$=".html"]', ref: { by: 'document' }, iters: 2_000 },
      { op: 'select', selector: '[href$=".html"]', ref: { by: 'document' }, iters: 2_000 },
    ],
  },

]);
