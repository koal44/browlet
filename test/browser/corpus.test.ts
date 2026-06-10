
import { runScenarios } from '../dispatch';
import { readFileSync } from 'node:fs';

const htmlStandard = readFileSync('test/browser/fixtures/slick/template-standard.html', 'utf8');

runScenarios('various', 'normal', [
  {
    name: 'template-standard selector perf candidates',
    // status: 'only',
    markup: htmlStandard,
    markupMode: 'html-document',
    cases: [
      // ID selectors
      { select: '#title', expect: { count: 1 } },
      { select: 'h1#title', expect: { count: 1 } },
      { select: 'div.head h1#title', expect: { count: 1 } },

      // Class selectors
      { select: 'dd.vcard > .fn', expect: { count: 5 } },
      { select: '.vcard .url.fn', expect: { count: 2 } },
      { select: '.nest.a1 .flatInNest.a6', expect: { count: 1 } },

      // Attribute selectors
      { select: 'a.url.fn[lang="tr"]', expect: { count: 1 } },
      { select: 'a[href^="http://www.w3.org/TR/"][href*="selectors"]', expect: { count: 4 } },
      { select: 'a[href$=".html"]', expect: { count: 1 } },
      { select: 'a[name="attribute-substrings"]', expect: { count: 1 } },
      { select: 'a[href*="Consortium/Legal"]', expect: { count: 4 } },

      // Table / structural selectors
      { select: 'table.selectorsReview tr > td.pattern', expect: { count: 39 } },
      { select: 'li.tocline2 > a[href^="#"]', expect: { count: 12 } },
      { select: 'li.tocline3 > ul.toc a[href="#universal-selector"]', expect: { count: 0 }, debug: false },

      // :has()
      { select: 'tr:has(> td.pattern)', expect: { count: 39 } },
      { select: 'div.example:has(> pre)', expect: { count: 41 } },
      { select: 'dd.vcard:has(a.url.fn[href^="mailto:"])', expect: { count: 1 } },
      { select: 'h4:has(a[name="attribute-substrings"]) + p + dl dt code', expect: { count: 3 } },
      { select: 'div:has(> b.flatOut.a1) > i.flatOut.a2 + b.flatOut.a3', expect: { count: 1 } },

      // :is()
      { select: ':is(h1, h2, h3)', expect: { count: 35 } },
      { select: 'div:is(.head, .subtoc, .example)', expect: { count: 45 } },
      { select: 'li:is(.tocline2, .tocline3) > a[href^="#"]', expect: { count: 23 } },
      { select: 'a:is(.url.fn, [href^="mailto:"], [href$="css3-selectors"])', expect: { count: 3 } },

      // Grouped selector lists / multiple arms
      { select: 'h1#title, div.subtoc > h2, p.copyright', expect: { count: 3 } },
      { select: 'td.pattern, td.meaning, td.origin', expect: { count: 117 } },
      { select: 'div > b.flatOut.a1, div > i.flatOut.a2, div > b.flatOut.a3', expect: { count: 3 } },
    ],
  },
]);
