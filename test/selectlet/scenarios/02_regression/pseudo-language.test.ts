import { runScenarios } from '../../../scenario/dispatch';

// https://drafts.csswg.org/selectors/#the-lang-pseudo
runScenarios('pseudo-language', 'normal', [
  {
    name: 'identifier ranges preserve inheritance, ASCII casing, and escapes',
    markup: `
      <section lang="en-US">
        <p id="inherited"></p>
        <p id="french" lang="fr"></p>
        <p id="unknown" lang=""><span id="unknown-child"></span></p>
      </section>
    `,
    cases: [
      { select: 'p:lang(en)', expect: { ids: ['inherited'] } },
      { select: 'p:lang(EN-us)', expect: { ids: ['inherited'] } },
      { select: String.raw`p:lang(\65 n)`, expect: { ids: ['inherited'] } },
      { select: 'p:lang(fr)', expect: { ids: ['french'] } },
      { select: '#unknown-child:lang(en)', expect: { ids: [] } },
      { select: 'p:lang(de)', expect: { ids: [] } },
    ],
  },
  {
    name: 'language matching folds ASCII letters only',
    markup: '<p id="ascii" lang="ko"></p><p id="unicode" lang="Ko"></p>',
    cases: [
      { select: '#ascii:lang(KO)', expect: { ids: ['ascii'] } },
      // String.toLowerCase() folds the Kelvin sign to k; ASCII matching must not.
      { select: '#ascii:lang(Ko)', expect: { ids: [] } },
      { select: '#unicode:lang(ko)', expect: { ids: [] } },
    ],
  },
  {
    name: 'XML language has priority, including an empty value',
    markup: `
      <section lang="en">
        <p id="xml-priority" lang="de"></p>
        <p id="xml-empty" lang="de"><span id="xml-empty-child"></span></p>
        <p id="literal" xml:lang="de"></p>
      </section>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const xml = 'http://www.w3.org/XML/1998/namespace';
        document.getElementById('xml-priority')!.setAttributeNS(xml, 'xml:lang', 'fr');
        document.getElementById('xml-empty')!.setAttributeNS(xml, 'xml:lang', '');
      });
    },
    cases: [
      { select: '#xml-priority:lang(fr)', expect: { ids: ['xml-priority'] } },
      { select: '#xml-priority:lang(de)', expect: { ids: [] } },
      { select: '#xml-empty:lang(de)', expect: { ids: [] } },
      { select: '#xml-empty-child:lang(en)', expect: { ids: [] } },
      { select: '#literal:lang(en)', expect: { ids: ['literal'] } },
      { select: '#literal:lang(de)', expect: { ids: [] } },
    ],
  },
  {
    name: 'plain lang applies to HTML and SVG but not other namespaces',
    markup: '<section id="parent" lang="en"></section>',
    setupPage: async (page) => {
      await page.evaluate(() => {
        for (const [id, namespace, localName] of [
          ['svg', 'http://www.w3.org/2000/svg', 'svg'],
          ['math', 'http://www.w3.org/1998/Math/MathML', 'math'],
          ['foreign', 'urn:language-test', 'item'],
        ]) {
          const element = document.createElementNS(namespace!, localName!);
          element.id = id!;
          element.setAttribute('lang', 'fr');
          document.getElementById('parent')!.append(element);
        }
      });
    },
    cases: [
      { select: '#svg:lang(fr)', expect: { ids: ['svg'] } },
      { select: '#svg:lang(en)', expect: { ids: [] } },
      { select: '#math:lang(en)', expect: { ids: ['math'] } },
      { select: '#math:lang(fr)', expect: { ids: [] } },
      { select: '#foreign:lang(en)', expect: { ids: ['foreign'] } },
      { select: '#foreign:lang(fr)', expect: { ids: [] } },
    ],
  },
  {
    name: 'quoted ranges decode escapes and distinguish wildcard from unknown',
    markup: `
      <p id="english" lang="en-US"></p>
      <p id="french" lang="fr"></p>
      <p id="undetermined" lang="und"></p>
      <p id="unknown" lang=""></p>
    `,
    cases: [
      { select: 'p:lang("EN")', expect: { ids: ['english'] }, engines: ['selectlet'] },
      { select: 'p:lang("EN")', expect: { ids: ['english'] }, engines: ['native'], browsers: ['firefox', 'webkit'] },
      // SPEC_CLASH(language-selector-ranges): Chromium's default grammar rejects string ranges.
      { select: 'p:lang("EN")', expect: { ids: ['english'] }, engines: ['native'], browsers: ['chromium'], status: 'fail' },
      { select: String.raw`p:lang('\65 n')`, expect: { ids: ['english'] }, engines: ['selectlet'] },
      { select: String.raw`p:lang('\65 n')`, expect: { ids: ['english'] }, engines: ['native'], browsers: ['firefox', 'webkit'] },
      { select: String.raw`p:lang('\65 n')`, expect: { ids: ['english'] }, engines: ['native'], browsers: ['chromium'], status: 'fail' },
      { select: 'p:lang("*")', expect: { ids: ['english', 'french', 'undetermined'] }, engines: ['selectlet'] },
      { select: 'p:lang("*")', expect: { ids: ['english', 'french', 'undetermined'] }, engines: ['native'], browsers: ['firefox', 'webkit'] },
      { select: 'p:lang("*")', expect: { ids: ['english', 'french', 'undetermined'] }, engines: ['native'], browsers: ['chromium'], status: 'fail' },
      { select: 'p:lang("")', expect: { ids: ['unknown'] }, engines: ['selectlet'] },
      { select: 'p:lang("")', expect: { ids: ['unknown'] }, engines: ['native'], browsers: ['chromium'], status: 'fail' },
      // SPEC_CLASH(language-selector-ranges): Firefox/WebKit accept the empty range but never match it.
      // https://github.com/w3c/csswg-drafts/issues/6915
      { select: 'p:lang("")', expect: { ids: ['unknown'] }, engines: ['native'], browsers: ['firefox'], status: 'fail' },
      { select: 'p:lang("")', expect: { ids: ['unknown'] }, engines: ['native'], browsers: ['webkit'], status: 'fail' },
    ],
  },
  {
    name: 'language strings reject raw newlines and permit escaped line continuations',
    markup: '<p id="english" lang="en"></p>',
    cases: [
      { select: 'p:lang("e\nn")', expect: { throws: true } },
      { select: 'p:lang("e\\\nn")', expect: { ids: ['english'] }, engines: ['selectlet'] },
      { select: 'p:lang("e\\\nn")', expect: { ids: ['english'] }, engines: ['native'], browsers: ['firefox', 'webkit'] },
      { select: 'p:lang("e\\\nn")', expect: { ids: ['english'] }, engines: ['native'], browsers: ['chromium'], status: 'fail' },
    ],
  },
  {
    name: 'malformed lang arguments remain invalid and dir remains identifier-only',
    markup: '<p id="english" lang="en" dir="ltr"></p>',
    cases: [
      { select: 'p:lang()', expect: { throws: true } },
      { select: 'p:lang(123)', expect: { throws: true } },
      { select: 'p:lang(en fr)', expect: { throws: true } },
      { select: 'p:lang("en" "fr")', expect: { throws: true } },
      { select: 'p:dir("ltr")', expect: { throws: true } },
      { select: 'p:dir(ltr)', expect: { ids: ['english'] } },
    ],
  },
]);
