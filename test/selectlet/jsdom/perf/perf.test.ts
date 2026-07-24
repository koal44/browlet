import { readFileSync } from 'node:fs';
import { runPerfScenarios } from './perf-scenario';

const htmlStandard = readFileSync(
  'test/selectlet/browser/fixtures/slick/template-standard.html',
  'utf8',
);

runPerfScenarios('jsdom-perf', [
  {
    name: 'select template-standard selector corpus',
    // status: 'only',
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

      // Attribute selector ordering
      { op: 'select', selector: 'a[href$=".html"], a[href*="Consortium/Legal"], a[name="attribute-substrings"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'a[href^="http://www.w3.org/TR/"], a[href$=".html"], a[href*="Consortium/Legal"]', ref: { by: 'document' }, iters: 1_000 },

      // Compound test ordering
      { op: 'select', selector: '[lang="tr"]:indeterminate', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: ':indeterminate[lang="tr"]', ref: { by: 'document' }, iters: 1_000 },
    ],
  },

  {
    name: 'first template-standard selector corpus',
    // status: 'only',
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

      // Attribute selector ordering
      { op: 'first', selector: 'a[href$=".html"], a[href*="Consortium/Legal"], a[name="attribute-substrings"]', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: 'a[href^="http://www.w3.org/TR/"], a[href$=".html"], a[href*="Consortium/Legal"]', ref: { by: 'document' }, iters: 1_000 },

      // Compound test ordering
      { op: 'first', selector: '[lang="tr"]:indeterminate', ref: { by: 'document' }, iters: 1_000 },
      { op: 'first', selector: ':indeterminate[lang="tr"]', ref: { by: 'document' }, iters: 1_000 },
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


  {
    name: 'match predicate miss costs',
    // status: 'only',
    engines: ['sx-vendor'],
    markup: `
      <form id="form">
        <input id="text-empty" name="alpha" lang="tr" required value="">
        <input id="text-filled" name="beta" lang="en" required value="x">
        <input id="text-disabled" name="gamma" disabled value="x">
        <input id="check1" type="checkbox" name="check">
        <input id="radio1" type="radio" name="r">
        <input id="radio2" type="radio" name="r">
        <button id="submit1" type="submit">Submit</button>
      </form>

      <div id="box" class="box a b" data-x="abcdef ghi" lang="zz">
        <span id="reject" data-x="abcdef ghi" lang="zz"></span>
        <span id="empty"></span>
        <span id="not-empty">x</span>
      </div>

      <ul id="list">
        <li id="n1" lang="en"></li>
        <li id="n2" lang="tr"></li>
        <li id="n3" lang="en"></li>
        <li id="n4" lang="tr"></li>
        <li id="n5" lang="en"></li>
      </ul>
    `,
    quickIters: 200_000,
    benches: [
      { op: 'match', selector: '#nope',                    ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: '.nope',                    ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: 'a',                        ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },

      { op: 'match', selector: '[missing]',                ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: '[lang="tr"]',              ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x^="zzz"]',          ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x$="zzz"]',          ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x*="zzz"]',          ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x~="zzz"]',          ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: '[lang|="fr"]',             ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },

      { op: 'match', selector: ':scope',                   ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':root',                    ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':empty',                   ref: { by: 'id', id: 'not-empty' }, iters: 2_000_000 },
      { op: 'match', selector: ':first-child',             ref: { by: 'id', id: 'n2' }, iters: 2_000_000 },
      { op: 'match', selector: ':last-child',              ref: { by: 'id', id: 'n4' }, iters: 2_000_000 },
      { op: 'match', selector: ':only-child',              ref: { by: 'id', id: 'n3' }, iters: 2_000_000 },
      { op: 'match', selector: ':first-of-type',           ref: { by: 'id', id: 'n2' }, iters: 2_000_000 },
      { op: 'match', selector: ':last-of-type',            ref: { by: 'id', id: 'n4' }, iters: 2_000_000 },
      { op: 'match', selector: ':only-of-type',            ref: { by: 'id', id: 'n3' }, iters: 2_000_000 },
      { op: 'match', selector: ':nth-child(3)',            ref: { by: 'id', id: 'n4' }, iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(3)',          ref: { by: 'id', id: 'n4' }, iters: 2_000_000 },

      { op: 'match', selector: ':indeterminate',           ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':default',                 ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':required',                ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':optional',                ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':enabled',                 ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':disabled',                ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':read-only',               ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':read-write',              ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':valid',                   ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },
      { op: 'match', selector: ':invalid',                 ref: { by: 'id', id: 'reject' }, iters: 2_000_000 },

    ],
  },

  {
    name: 'match predicate hit costs',
    status: 'skip',
    engines: ['sx-vendor'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html lang="en" id="html">
        <head>
          <meta charset="utf-8">
          <title>Selector Performance Test</title>
        </head>
        <body>
          <form id="form">
            <input id="text-empty" name="alpha" lang="tr" required value="">
            <input id="text-filled" name="beta" lang="en" required value="x">
            <input id="text-disabled" name="gamma" disabled value="x">
            <input id="check1" type="checkbox" name="check">
            <input id="radio1" type="radio" name="r">
            <input id="radio2" type="radio" name="r">
            <button id="submit1" type="submit">Submit</button>
          </form>

          <div id="box" class="box a b" data-x="abcdef ghi" lang="zz">
            <span id="hit" class="target" data-x="abcdef ghi" lang="zz"></span>
            <span id="empty"></span>
            <span id="not-empty">x</span>
          </div>

          <ul id="list">
            <li id="n1" lang="en"></li>
            <li id="n2" lang="tr"></li>
            <li id="n3" lang="en"></li>
            <li id="n4" lang="tr"></li>
            <li id="n5" lang="en"></li>
          </ul>
        </body>
      </html>
    `,
    quickIters: 200_000,
    benches: [
      { op: 'match', selector: '#hit',                    ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: '.target',                 ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: 'span',                    ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },

      { op: 'match', selector: '[data-x]',                ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: '[lang="zz"]',             ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x^="abc"]',         ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x$="ghi"]',         ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x*="def"]',         ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: '[data-x~="ghi"]',         ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: '[lang|="zz"]',            ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },

      { op: 'match', selector: ':scope',                  ref: { by: 'id', id: 'hit' }, iters: 2_000_000 },
      { op: 'match', selector: ':root',                   ref: { by: 'id', id: 'html' }, iters: 2_000_000 },
      { op: 'match', selector: ':empty',                  ref: { by: 'id', id: 'empty' }, iters: 2_000_000 },
      { op: 'match', selector: ':first-child',            ref: { by: 'id', id: 'n1' }, iters: 2_000_000 },
      { op: 'match', selector: ':last-child',             ref: { by: 'id', id: 'n5' }, iters: 2_000_000 },
      { op: 'match', selector: ':only-child',             ref: { by: 'id', id: 'empty' }, iters: 2_000_000 },
      { op: 'match', selector: ':first-of-type',          ref: { by: 'id', id: 'n1' }, iters: 2_000_000 },
      { op: 'match', selector: ':last-of-type',           ref: { by: 'id', id: 'n5' }, iters: 2_000_000 },
      { op: 'match', selector: ':only-of-type',           ref: { by: 'id', id: 'empty' }, iters: 2_000_000 },
      { op: 'match', selector: ':nth-child(3)',           ref: { by: 'id', id: 'n3' }, iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(3)',         ref: { by: 'id', id: 'n3' }, iters: 2_000_000 },

      { op: 'match', selector: ':required',               ref: { by: 'id', id: 'text-empty' }, iters: 2_000_000 },
      { op: 'match', selector: ':optional',               ref: { by: 'id', id: 'check1' }, iters: 2_000_000 },
      { op: 'match', selector: ':enabled',                ref: { by: 'id', id: 'text-filled' }, iters: 2_000_000 },
      { op: 'match', selector: ':disabled',               ref: { by: 'id', id: 'text-disabled' }, iters: 2_000_000 },
      { op: 'match', selector: ':read-only',              ref: { by: 'id', id: 'text-disabled' }, iters: 2_000_000 },
      { op: 'match', selector: ':read-write',             ref: { by: 'id', id: 'text-filled' }, iters: 2_000_000 },
      { op: 'match', selector: ':valid',                  ref: { by: 'id', id: 'text-filled' }, iters: 2_000_000 },
      { op: 'match', selector: ':invalid',                ref: { by: 'id', id: 'text-empty' }, iters: 2_000_000 },
    ],
  },

  {
    name: 'match nth predicate miss costs',
    status: 'skip',
    engines: ['sx-vendor'],
    markup: `
      <div id="short">
        <i id="si1"></i><span id="ss1"></span><i id="si2"></i><span id="ss2"></span><i id="si3"></i><span id="ss3"></span>
      </div>

      <div id="long">
        <b id="b1"></b><i id="i1"></i><span id="sp1"></span>
        <b id="b2"></b><i id="i2"></i><span id="sp2"></span>
        <b id="b3"></b><i id="i3"></i><span id="sp3"></span>
        <b id="b4"></b><i id="i4"></i><span id="sp4"></span>
        <b id="b5"></b><i id="i5"></i><span id="sp5"></span>
        <b id="b6"></b><i id="i6"></i><span id="sp6"></span>
        <b id="b7"></b><i id="i7"></i><span id="sp7"></span>
        <b id="b8"></b><i id="i8"></i><span id="sp8"></span>
        <b id="b9"></b><i id="i9"></i><span id="sp9"></span>
        <b id="b10"></b><i id="i10"></i><span id="sp10"></span>
      </div>
    `,
    quickIters: 200_000,
    benches: [
      { op: 'match', selector: ':nth-child(3)',           ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-child(3)',      ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(3)',         ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-of-type(3)',    ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },

      { op: 'match', selector: ':nth-child(odd)',         ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-child(even)',        ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(odd)',       ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(even)',      ref: { by: 'id', id: 'si3' },  iters: 2_000_000 },

      { op: 'match', selector: ':nth-child(3n+1)',        ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(3n+1)',      ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },

      { op: 'match', selector: ':nth-child(30)',          ref: { by: 'id', id: 'sp9' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-child(30)',     ref: { by: 'id', id: 'sp2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(10)',        ref: { by: 'id', id: 'i9' },   iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-of-type(10)',   ref: { by: 'id', id: 'i2' },   iters: 2_000_000 },
    ],
  },

  {
    name: 'match nth predicate hit costs',
    status: 'skip',
    engines: ['sx-vendor'],
    markup: `
      <div id="short">
        <i id="si1"></i><span id="ss1"></span><i id="si2"></i><span id="ss2"></span><i id="si3"></i><span id="ss3"></span>
      </div>

      <div id="long">
        <b id="b1"></b><i id="i1"></i><span id="sp1"></span>
        <b id="b2"></b><i id="i2"></i><span id="sp2"></span>
        <b id="b3"></b><i id="i3"></i><span id="sp3"></span>
        <b id="b4"></b><i id="i4"></i><span id="sp4"></span>
        <b id="b5"></b><i id="i5"></i><span id="sp5"></span>
        <b id="b6"></b><i id="i6"></i><span id="sp6"></span>
        <b id="b7"></b><i id="i7"></i><span id="sp7"></span>
        <b id="b8"></b><i id="i8"></i><span id="sp8"></span>
        <b id="b9"></b><i id="i9"></i><span id="sp9"></span>
        <b id="b10"></b><i id="i10"></i><span id="sp10"></span>
      </div>
    `,
    quickIters: 200_000,
    benches: [
      { op: 'match', selector: ':nth-child(4)',           ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-child(3)',      ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(2)',         ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-of-type(2)',    ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },

      { op: 'match', selector: ':nth-child(odd)',         ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-child(even)',        ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(odd)',       ref: { by: 'id', id: 'si3' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(even)',      ref: { by: 'id', id: 'si2' },  iters: 2_000_000 },

      { op: 'match', selector: ':nth-child(3n+1)',        ref: { by: 'id', id: 'ss2' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(3n+1)',      ref: { by: 'id', id: 'si1' },  iters: 2_000_000 },

      { op: 'match', selector: ':nth-child(27)',          ref: { by: 'id', id: 'sp9' },  iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-child(27)',     ref: { by: 'id', id: 'b2' },   iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(9)',         ref: { by: 'id', id: 'i9' },   iters: 2_000_000 },
      { op: 'match', selector: ':nth-last-of-type(9)',    ref: { by: 'id', id: 'i2' },   iters: 2_000_000 },
    ],
  },

  {
    name: 'match ui language predicate costs',
    status: 'skip',
    engines: ['sx-vendor'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html" lang="en" dir="ltr">
        <head><title>predicate costs</title></head>
        <body id="body">
          <main id="main" lang="en-US" dir="ltr">
            <section id="rtl-box" lang="ar" dir="rtl">
              <a id="link-hit" href="#target-node">link</a>
              <a id="link-nohref">not link</a>
              <span id="target-node">target</span>
              <span id="plain" lang="zz" dir="ltr"></span>
              <x-cost-probe id="custom"></x-cost-probe>
              <button id="button" type="button">button</button>
              <input id="input" value="x">
            </section>
          </main>
        </body>
      </html>
    `,
    quickIters: 200_000,
    benches: [
      { label: ':dir(ltr) (hit)',          op: 'match', selector: ':dir(ltr)',      ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':dir(rtl) (miss)',         op: 'match', selector: ':dir(rtl)',      ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':dir(rtl) (hit)',          op: 'match', selector: ':dir(rtl)',      ref: { by: 'id', id: 'rtl-box' },     iters: 2_000_000 },

      { label: ':lang(en) (miss)',         op: 'match', selector: ':lang(en)',      ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':lang(zz) (hit)',          op: 'match', selector: ':lang(zz)',      ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':lang(ar) (hit)',          op: 'match', selector: ':lang(ar)',      ref: { by: 'id', id: 'rtl-box' },     iters: 2_000_000 },

      { label: ':any-link (miss)',         op: 'match', selector: ':any-link',      ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':any-link (hit)',          op: 'match', selector: ':any-link',      ref: { by: 'id', id: 'link-hit' },    iters: 2_000_000 },
      { label: ':link (miss)',             op: 'match', selector: ':link',          ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':link (hit)',              op: 'match', selector: ':link',          ref: { by: 'id', id: 'link-hit' },    iters: 2_000_000 },
      { label: ':visited (miss)',          op: 'match', selector: ':visited',       ref: { by: 'id', id: 'link-hit' },    iters: 2_000_000 },

      { label: ':target (miss)',           op: 'match', selector: ':target',        ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':target (hit)',            op: 'match', selector: ':target',        ref: { by: 'id', id: 'target-node' }, iters: 2_000_000 },

      { label: ':defined (miss)',          op: 'match', selector: ':defined',       ref: { by: 'id', id: 'custom' },      iters: 2_000_000 },
      { label: ':defined (hit)',           op: 'match', selector: ':defined',       ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },

      { label: ':hover (miss)',            op: 'match', selector: ':hover',         ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':active (miss)',           op: 'match', selector: ':active',        ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':focus (miss)',            op: 'match', selector: ':focus',         ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':focus-visible (miss)',    op: 'match', selector: ':focus-visible', ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
      { label: ':focus-within (miss)',     op: 'match', selector: ':focus-within',  ref: { by: 'id', id: 'plain' },       iters: 2_000_000 },
    ],
  },

  {
    name: 'match form media predicate costs',
    status: 'skip',
    engines: ['sx-vendor'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html">
        <body id="body">
          <form id="form">
            <input id="text-empty" name="alpha" required value="">
            <input id="text-filled" name="beta" required value="x">
            <input id="text-disabled" name="gamma" disabled value="x">
            <input id="text-placeholder" name="delta" placeholder="hint" value="">
            <input id="check-checked" type="checkbox" checked>
            <input id="check-empty" type="checkbox">
            <input id="number-in" type="number" min="1" max="10" value="5">
            <input id="number-out" type="number" min="1" max="10" value="20">
            <button id="button" type="button">button</button>
          </form>

          <video id="video"></video>
          <audio id="audio" muted></audio>
          <span id="plain"></span>
        </body>
      </html>
    `,
    quickIters: 200_000,
    benches: [
      { label: ':enabled (miss)',             op: 'match', selector: ':enabled',             ref: { by: 'id', id: 'plain' },            iters: 2_000_000 },
      { label: ':enabled (hit)',              op: 'match', selector: ':enabled',             ref: { by: 'id', id: 'text-filled' },      iters: 2_000_000 },
      { label: ':disabled (miss)',            op: 'match', selector: ':disabled',            ref: { by: 'id', id: 'plain' },            iters: 2_000_000 },
      { label: ':disabled (hit)',             op: 'match', selector: ':disabled',            ref: { by: 'id', id: 'text-disabled' },    iters: 2_000_000 },

      { label: ':read-only (miss)',           op: 'match', selector: ':read-only',           ref: { by: 'id', id: 'text-filled' },      iters: 2_000_000 },
      { label: ':read-only (hit)',            op: 'match', selector: ':read-only',           ref: { by: 'id', id: 'text-disabled' },    iters: 2_000_000 },
      { label: ':read-write (miss)',          op: 'match', selector: ':read-write',          ref: { by: 'id', id: 'text-disabled' },    iters: 2_000_000 },
      { label: ':read-write (hit)',           op: 'match', selector: ':read-write',          ref: { by: 'id', id: 'text-filled' },      iters: 2_000_000 },

      { label: ':placeholder-shown (miss)',   op: 'match', selector: ':placeholder-shown',   ref: { by: 'id', id: 'plain' },            iters: 2_000_000 },
      { label: ':placeholder-shown (hit)',    op: 'match', selector: ':placeholder-shown',   ref: { by: 'id', id: 'text-placeholder' }, iters: 2_000_000 },

      { label: ':default (miss)',             op: 'match', selector: ':default',             ref: { by: 'id', id: 'plain' },            iters: 2_000_000 },
      { label: ':checked (miss)',             op: 'match', selector: ':checked',             ref: { by: 'id', id: 'check-empty' },      iters: 2_000_000 },
      { label: ':checked (hit)',              op: 'match', selector: ':checked',             ref: { by: 'id', id: 'check-checked' },    iters: 2_000_000 },
      { label: ':indeterminate (miss)',       op: 'match', selector: ':indeterminate',       ref: { by: 'id', id: 'plain' },            iters: 2_000_000 },

      { label: ':required (miss)',            op: 'match', selector: ':required',            ref: { by: 'id', id: 'plain' },            iters: 2_000_000 },
      { label: ':required (hit)',             op: 'match', selector: ':required',            ref: { by: 'id', id: 'text-empty' },       iters: 2_000_000 },
      { label: ':optional (miss)',            op: 'match', selector: ':optional',            ref: { by: 'id', id: 'text-empty' },       iters: 2_000_000 },
      { label: ':optional (hit)',             op: 'match', selector: ':optional',            ref: { by: 'id', id: 'check-empty' },      iters: 2_000_000 },

      { label: ':invalid (miss)',             op: 'match', selector: ':invalid',             ref: { by: 'id', id: 'text-filled' },      iters: 2_000_000 },
      { label: ':invalid (hit)',              op: 'match', selector: ':invalid',             ref: { by: 'id', id: 'text-empty' },       iters: 2_000_000 },
      { label: ':valid (miss)',               op: 'match', selector: ':valid',               ref: { by: 'id', id: 'text-empty' },       iters: 2_000_000 },
      { label: ':valid (hit)',                op: 'match', selector: ':valid',               ref: { by: 'id', id: 'text-filled' },      iters: 2_000_000 },

      { label: ':in-range (miss)',            op: 'match', selector: ':in-range',            ref: { by: 'id', id: 'number-out' },       iters: 2_000_000 },
      { label: ':in-range (hit)',             op: 'match', selector: ':in-range',            ref: { by: 'id', id: 'number-in' },        iters: 2_000_000 },
      { label: ':out-of-range (miss)',        op: 'match', selector: ':out-of-range',        ref: { by: 'id', id: 'number-in' },        iters: 2_000_000 },
      { label: ':out-of-range (hit)',         op: 'match', selector: ':out-of-range',        ref: { by: 'id', id: 'number-out' },       iters: 2_000_000 },

      { label: ':playing (miss)',             op: 'match', selector: ':playing',             ref: { by: 'id', id: 'video' },            iters: 2_000_000 },
      { label: ':paused (hit)',               op: 'match', selector: ':paused',              ref: { by: 'id', id: 'video' },            iters: 2_000_000 },
      { label: ':seeking (miss)',             op: 'match', selector: ':seeking',             ref: { by: 'id', id: 'video' },            iters: 2_000_000 },
      { label: ':buffering (miss)',           op: 'match', selector: ':buffering',           ref: { by: 'id', id: 'video' },            iters: 2_000_000 },
      { label: ':stalled (miss)',             op: 'match', selector: ':stalled',             ref: { by: 'id', id: 'video' },            iters: 2_000_000 },
      { label: ':muted (miss)',               op: 'match', selector: ':muted',               ref: { by: 'id', id: 'video' },            iters: 2_000_000 },
      { label: ':muted (hit)',                op: 'match', selector: ':muted',               ref: { by: 'id', id: 'audio' },            iters: 2_000_000 },
      { label: ':volume-locked (miss)',       op: 'match', selector: ':volume-locked',       ref: { by: 'id', id: 'video' },            iters: 2_000_000 },
    ],
  },

  {
    name: 'pseudo-lift and selector-list ordering',
    // status: 'only',
    markupMode: 'html-document',
    markup: htmlStandard,
    quickIters: 1_000,
    benches: [
      // :is() / :where() seed lifting
      { op: 'select', selector: 'div:is(h1.a, h2.a, h3.a)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: '[lang="tr"]:is(h1, h2, h3)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'section > [lang="tr"]:is(.a > h1, .a > h2)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'div:is(span.foo, div.example, p.copyright)', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: '[lang="tr"]:where(h1, h2, h3)', ref: { by: 'document' }, iters: 1_000 },

      { op: 'first', selector: '[lang="tr"]:is(h1, h2, h3)', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: 'section > [lang="tr"]:is(.a > h1, .a > h2)', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: 'div:is(span.foo, div.example, p.copyright)', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: '[lang="tr"]:where(h1, h2, h3)', ref: { by: 'document' }, iters: 2_000 },

      // Selector-list ordering: cheap/selective first vs expensive late/early.
      { op: 'select', selector: '#title, a[href*="Consortium/Legal"], input:invalid', ref: { by: 'document' }, iters: 1_000 },
      { op: 'select', selector: 'input:invalid, a[href*="Consortium/Legal"], #title', ref: { by: 'document' }, iters: 1_000 },

      { op: 'first', selector: '#title, a[href*="Consortium/Legal"], input:invalid', ref: { by: 'document' }, iters: 2_000 },
      { op: 'first', selector: 'input:invalid, a[href*="Consortium/Legal"], #title', ref: { by: 'document' }, iters: 2_000 },

      { op: 'match', selector: '#title, a[href*="Consortium/Legal"], input:invalid', ref: { by: 'id', id: 'title' }, iters: 200_000 },
      { op: 'match', selector: 'input:invalid, a[href*="Consortium/Legal"], #title', ref: { by: 'id', id: 'title' }, iters: 200_000 },

      { op: 'match', selector: '#title', ref: { by: 'id', id: 'title' }, iters: 2_000_000 },
      { op: 'match', selector: '[id="title"]', ref: { by: 'id', id: 'title' }, iters: 2_000_000 },
      { op: 'match', selector: ':nth-of-type(1)', ref: { by: 'id', id: 'title' }, iters: 2_000_000 },
    ],
  },

  {
    name: 'match selector-list arm ordering with expensive nth arm',
    // status: 'only',
    markup: `
      <div id="short">
        <i id="si1"></i><span id="ss1"></span><i id="si2"></i><span id="ss2"></span><i id="si3"></i><span id="ss3"></span>
      </div>

      <div id="long">
        <b id="b1"></b><i id="i1"></i><span id="sp1"></span>
        <b id="b2"></b><i id="i2"></i><span id="sp2"></span>
        <b id="b3"></b><i id="i3"></i><span id="sp3"></span>
        <b id="b4"></b><i id="i4"></i><span id="sp4"></span>
        <b id="b5"></b><i id="i5"></i><span id="sp5"></span>
        <b id="b6"></b><i id="i6"></i><span id="sp6"></span>
        <b id="b7"></b><i id="i7"></i><span id="sp7"></span>
        <b id="b8"></b><i id="i8"></i><span id="sp8"></span>
        <b id="b9"></b><i id="i9" data-hot="yes"></i><span id="sp9"></span>
        <b id="b10"></b><i id="i10"></i><span id="sp10"></span>
      </div>
    `,
    quickIters: 200_000,
    benches: [
      {
        op: 'match', selector: '#i9, [data-hot="yes"], :nth-of-type(9)',
        ref: { by: 'id', id: 'i9' }, iters: 200_000,
      },
      {
        op: 'match', selector: ':nth-of-type(9), [data-hot="yes"], #i9',
        ref: { by: 'id', id: 'i9' }, iters: 200_000,
      },
    ],
  },

  {
    name: 'match hot element accessors',
    // status: 'only',
    markupMode: 'html-body',
    markup: `
      <div id="access-root">
        <h1 id="access-target" class="alpha beta gamma" lang="tr" data-hot="yes" title="hello"></h1>
        <h2 id="access-other" class="alpha" lang="en" data-hot="no"></h2>
      </div>
    `,
    quickIters: 200_000,
    benches: [
      { op: 'match', selector: '#access-target', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },

      { op: 'match', selector: '.alpha', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },
      { op: 'match', selector: '.beta', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },
      { op: 'match', selector: '.missing', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },

      { op: 'match', selector: 'h1', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },
      { op: 'match', selector: 'h2', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },

      { op: 'match', selector: '[id="access-target"]', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },
      { op: 'match', selector: '[class~="beta"]', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },
      { op: 'match', selector: '[lang="tr"]', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },
      { op: 'match', selector: '[data-hot="yes"]', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },

      { op: 'match', selector: 'h1#access-target.alpha[lang="tr"][data-hot="yes"]', ref: { by: 'id', id: 'access-target' }, iters: 200_000 },
    ],
  },

  {
    name: 'nth predicate cost with tree versioning',
    // status: 'only',
    engines: ['sx-vendor', 'selectlet'],
    markup: `
      <div id="short">
        <i id="si1"></i><span id="ss1"></span><i id="si2"></i><span id="ss2"></span><i id="si3"></i><span id="ss3"></span>
      </div>

      <div id="long">
        <b id="b1"></b><i id="i1"></i><span id="sp1"></span>
        <b id="b2"></b><i id="i2"></i><span id="sp2"></span>
        <b id="b3"></b><i id="i3"></i><span id="sp3"></span>
        <b id="b4"></b><i id="i4"></i><span id="sp4"></span>
        <b id="b5"></b><i id="i5"></i><span id="sp5"></span>
        <b id="b6"></b><i id="i6"></i><span id="sp6"></span>
        <b id="b7"></b><i id="i7"></i><span id="sp7"></span>
        <b id="b8"></b><i id="i8"></i><span id="sp8"></span>
        <b id="b9"></b><i id="i9"></i><span id="sp9"></span>
        <b id="b10"></b><i id="i10"></i><span id="sp10"></span>
      </div>
    `,
    quickIters: 200_000,
    benches: [
      { op: 'select', selector: ':nth-child(4)',             iters: 20_000 },
      { op: 'select', selector: ':nth-last-child(3)',        iters: 20_000 },
      { op: 'select', selector: ':nth-of-type(2)',           iters: 20_000 },
      { op: 'select', selector: ':nth-last-of-type(2)',      iters: 20_000 },

      { op: 'select', selector: ':nth-child(odd)',           iters: 20_000 },
      { op: 'select', selector: ':nth-child(even)',          iters: 20_000 },
      { op: 'select', selector: ':nth-of-type(odd)',         iters: 20_000 },
      { op: 'select', selector: ':nth-of-type(even)',        iters: 20_000 },

      { op: 'select', selector: ':nth-child(3n+1)',          iters: 20_000 },
      { op: 'select', selector: ':nth-of-type(3n+1)',        iters: 20_000 },

      { op: 'select', selector: ':nth-child(27)',            iters: 20_000 },
      { op: 'select', selector: ':nth-last-child(27)',       iters: 20_000 },
      { op: 'select', selector: ':nth-of-type(9)',           iters: 20_000 },
      { op: 'select', selector: ':nth-last-of-type(9)',      iters: 20_000 },
    ],
  },

]);

const SELECTOR = '.box:first-child ~ .box:nth-of-type(4n) + .box .block.inner > .content';

/*
Selector:
  .box:first-child ~ .box:nth-of-type(4n) + .box .block.inner > .content

Tree:
  body
  └─ #container.container
     ├─ #box0.box.container                  .box:first-child
     │  ├─ .block.outer × 5
     │  │  └─ .block.inner × 5
     │  │     └─ p.content × 25
     │  ├─ total .content under #box0: 25
     │
     ├─ #box1.box.container
     │  └─ .content × 25
     │
     ├─ #box2.box.container
     │  └─ .content × 25
     │
     ├─ #box3.box.container
     │  └─ .content × 25
     │
     └─ #box4.box.container
        ├─ .block.outer × 5
        │  └─ .block.inner × 5
        │     └─ p.content × 25
*/

runPerfScenarios('perf', [
  {
    name: 'complex selector jsdom shape',
    // status: 'only',
    markup: complexMarkup(),
    benches: [
      { op: 'select', selector: SELECTOR, iters: 200 },
      { op: 'first', selector: SELECTOR, iters: 200 },

      { op: 'match', selector: SELECTOR, ref: { by: 'id', id: 'p4-4-4' }, iters: 200 },
      { op: 'closest', selector: SELECTOR, ref: { by: 'id', id: 'p4-4-4' }, iters: 200 },

      { op: 'select', selector: '.content', iters: 200 },
      { op: 'first', selector: '.content', iters: 200 },
      { op: 'select', selector: '#box4 .content', iters: 200 },
      { op: 'first', selector: '#box4 .content', iters: 200 },

      { op: 'select', selector: '#box4 .block.inner > .content', iters: 200 },
      { op: 'first', selector: '#box4 .block.inner > .content', iters: 200 },
    ],
  },
]);

function complexMarkup(): string {
  const x = 5;
  const y = 5;
  const z = 5;
  let html = '<div id="container" class="container">';

  for (let i = 0; i < x; i++) {
    html += `<div id="box${i}" class="box container">`;

    for (let j = 0; j < y; j++) {
      html += `<div id="div${i}-${j}" class="block outer">`;

      for (let k = 0; k < z; k++) {
        html += `<div id="div${i}-${j}-${k}" class="block inner">`;
        html += `<p id="p${i}-${j}-${k}" class="content">${i}-${j}-${k}</p>`;
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div>';
  return html;
}

runPerfScenarios('perf2', [
  {
    name: 'html collection source first paths',
    status: 'only',
    engines: ['sx-vendor'],
    markupMode: 'html-document',
    markup: htmlCollectionSourceMarkup(600),
    quickIters: 1_000,
    benches: [
      // Controls: pure tag lookup.
      { op: 'first',  selector: 'a', ref: { by: 'document' }, iters: 5_000 },
      { op: 'select', selector: 'a', ref: { by: 'document' }, iters: 5_000 },

      // Tag-seeded attr proof: should use getElementsByTagName('a') as candidate source.
      { label: 'first a[data-probe-near]', op: 'first',  selector: 'a[data-probe-near]', ref: { by: 'document' }, iters: 5_000 },
      { label: 'first a[data-probe-mid]',  op: 'first',  selector: 'a[data-probe-mid]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'first a[data-probe-far]',  op: 'first',  selector: 'a[data-probe-far]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'first a[data-probe-miss]', op: 'first',  selector: 'a[data-probe-miss]', ref: { by: 'document' }, iters: 5_000 },

      { label: 'select a[data-probe-near]', op: 'select', selector: 'a[data-probe-near]', ref: { by: 'document' }, iters: 5_000 },
      { label: 'select a[data-probe-mid]',  op: 'select', selector: 'a[data-probe-mid]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'select a[data-probe-far]',  op: 'select', selector: 'a[data-probe-far]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'select a[data-probe-miss]', op: 'select', selector: 'a[data-probe-miss]', ref: { by: 'document' }, iters: 5_000 },

      // Universal/unseeded attr proof: should use getElementsByTagName('*') or equivalent walk source.
      { label: 'first [data-probe-near]', op: 'first',  selector: '[data-probe-near]', ref: { by: 'document' }, iters: 5_000 },
      { label: 'first [data-probe-mid]',  op: 'first',  selector: '[data-probe-mid]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'first [data-probe-far]',  op: 'first',  selector: '[data-probe-far]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'first [data-probe-miss]', op: 'first',  selector: '[data-probe-miss]', ref: { by: 'document' }, iters: 5_000 },

      { label: 'select [data-probe-near]', op: 'select', selector: '[data-probe-near]', ref: { by: 'document' }, iters: 5_000 },
      { label: 'select [data-probe-mid]',  op: 'select', selector: '[data-probe-mid]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'select [data-probe-far]',  op: 'select', selector: '[data-probe-far]',  ref: { by: 'document' }, iters: 5_000 },
      { label: 'select [data-probe-miss]', op: 'select', selector: '[data-probe-miss]', ref: { by: 'document' }, iters: 5_000 },

      // Early-exit universal control. This should already be fast.
      { op: 'first', selector: ':not(button)', ref: { by: 'document' }, iters: 5_000 },

      //
      { op: 'first', selector: '.row', ref: { by: 'document' }, iters: 5_000 },
      { op: 'select', selector: '.row', ref: { by: 'document' }, iters: 5_000 },
      { op: 'first', selector: '.row[data-probe-far]', ref: { by: 'document' }, iters: 5_000 },
      { op: 'first', selector: '.row[data-probe-miss]', ref: { by: 'document' }, iters: 5_000 },
      { op: 'select', selector: '.row[data-probe-far]', ref: { by: 'document' }, iters: 5_000 },
      { op: 'select', selector: '.row[data-probe-miss]', ref: { by: 'document' }, iters: 5_000 },
    ],
  },
]);

function htmlCollectionSourceMarkup(count: number): string {
  const mid = Math.floor(count / 2);
  let html = '<!doctype html><html><body><main id="root">';

  for (let i = 0; i < count; i++) {
    const attrs = [
      i === 0 ? 'data-probe-near="yes"' : '',
      i === mid ? 'data-probe-mid="yes"' : '',
      i === count - 1 ? 'data-probe-far="yes"' : '',
    ].filter(Boolean).join(' ');

    html += `<section class="row" id="row-${i}">`;
    html += `<a id="link-${i}" href="#link-${i}" ${attrs}>link ${i}</a>`;
    html += `<span class="filler">filler ${i}</span>`;
    html += `</section>`;
  }

  html += '</main></body></html>';
  return html;
}
