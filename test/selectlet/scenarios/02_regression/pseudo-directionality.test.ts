import { runScenarios } from '../../../scenario/dispatch';

// https://html.spec.whatwg.org/multipage/dom.html#the-dir-attribute
runScenarios('HTML directionality', 'normal', [
  {
    name: 'Unicode first-strong direction and excluded descendant subtrees',
    markup: `
      <div id="digits" dir="auto">١A</div>
      <div id="cjk" dir="auto">中א</div>
      <div id="adlam" dir="auto">𞤀A</div>
      <div id="marks" dir="auto">\u061C A</div>
      <div id="neutral" dir="auto">123😀</div>
      <div id="excluded" dir="auto"><script>/*א*/</script><style>/*א*/</style><textarea>א</textarea><bdi>א</bdi>A</div>
      <div id="boundary" dir="auto"><span dir="rtl">א</span>A</div>
      <div id="invalid" dir="auto"><span dir="invalid">א</span>A</div>
    `,
    cases: [
      { select: '#digits:dir(ltr)', expect: { ids: ['digits'] } },
      { select: '#cjk:dir(ltr)', expect: { ids: ['cjk'] } },
      { select: '#adlam:dir(rtl)', expect: { ids: ['adlam'] } },
      { select: '#marks:dir(rtl)', expect: { ids: ['marks'] } },
      { select: '#neutral:dir(ltr)', expect: { ids: ['neutral'] } },
      { select: '#excluded:dir(ltr)', expect: { ids: ['excluded'] } },
      { select: '#boundary:dir(ltr)', expect: { ids: ['boundary'] } },
      { select: '#invalid:dir(rtl)', expect: { ids: ['invalid'] } },
    ],
  },
  {
    name: 'CDATA participates in first-strong text direction',
    markup: '<div id="cdata" dir="auto"></div>',
    setupPage: async (page) => {
      await page.evaluate(() => {
        const xml = document.implementation.createDocument(null, 'root');
        document.getElementById('cdata')!.append(xml.createCDATASection('א'));
      });
    },
    cases: [
      { select: '#cdata:dir(rtl)', expect: { ids: ['cdata'] } },
    ],
  },
  {
    name: 'foreign dir does not change inheritance or create a text-scan boundary',
    markup: `
      <div dir="rtl"><svg id="foreign" dir="ltr"></svg></div>
      <div id="scan" dir="auto"><svg dir="rtl">A</svg>א</div>
    `,
    cases: [
      { select: '#foreign:dir(rtl)', expect: { ids: ['foreign'] }, engines: ['selectlet'] },
      { select: '#scan:dir(ltr)', expect: { ids: ['scan'] }, engines: ['selectlet'] },
      { select: '#foreign:dir(rtl)', expect: { ids: ['foreign'] }, engines: ['native'], browsers: ['chromium', 'firefox'] },
      { select: '#scan:dir(ltr)', expect: { ids: ['scan'] }, engines: ['native'], browsers: ['chromium', 'firefox'] },
      // SPEC_CLASH(dir-foreign-elements): WebKit returns [] for both; it interprets the foreign dir attributes.
      { select: '#foreign:dir(rtl)', expect: { ids: ['foreign'] }, engines: ['native'], browsers: ['webkit'], status: 'fail' },
      { select: '#scan:dir(ltr)', expect: { ids: ['scan'] }, engines: ['native'], browsers: ['webkit'], status: 'fail' },
    ],
  },
  {
    name: 'shadow inheritance and exclusion of an assigned root under slot auto',
    markup: '<div id="host" dir="rtl"><span dir="ltr">א</span></div>',
    setupPage: async (page) => {
      await page.evaluate(() => {
        const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
        root.innerHTML = '<span id="inherited"></span><slot id="slot" dir="auto"></slot>';
      });
    },
    cases: [
      { match: ':dir(rtl)', ref: { by: 'id', id: 'inherited', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['inherited'] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] }, engines: ['selectlet'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] }, engines: ['native'], browsers: ['chromium', 'firefox'] },
      // SPEC_CLASH(dir-assigned-root): WebKit returns []; it scans the assigned span despite its own dir.
      { match: ':dir(ltr)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] }, engines: ['native'], browsers: ['webkit'], status: 'fail' },
    ],
  },
  {
    name: 'auto uses live form values while other input types use contained text',
    markup: '<input id="text" dir="auto" value="A"><textarea id="textarea" dir="auto">א</textarea><input id="checkbox" type="checkbox" dir="auto" value="A">',
    setupPage: async (page) => {
      await page.evaluate(() => {
        (document.getElementById('text') as HTMLInputElement).value = 'א';
        (document.getElementById('textarea') as HTMLTextAreaElement).value = 'A';
        document.getElementById('checkbox')!.append('א');
      });
    },
    cases: [
      { select: '#text:dir(rtl)', expect: { ids: ['text'] } },
      { select: '#textarea:dir(ltr)', expect: { ids: ['textarea'] } },
      { select: '#checkbox:dir(rtl)', expect: { ids: ['checkbox'] }, engines: ['selectlet'] },
      { select: '#checkbox:dir(rtl)', expect: { ids: ['checkbox'] }, engines: ['native'], browsers: ['webkit'] },
      // SPEC_CLASH(dir-nontext-input): Chromium and Firefox return []; WebKit follows the written scan.
      { select: '#checkbox:dir(rtl)', expect: { ids: ['checkbox'] }, engines: ['native'], browsers: ['chromium'], status: 'fail' },
      { select: '#checkbox:dir(rtl)', expect: { ids: ['checkbox'] }, engines: ['native'], browsers: ['firefox'], status: 'fail' },
    ],
  },
  {
    name: 'direction reflects text and ancestry changes without a stale cache',
    markup: '<main dir="auto">A<span id="child"></span></main><aside dir="rtl"></aside>',
    steps: [
      { cases: [{ select: '#child:dir(ltr)', expect: { ids: ['child'] } }] },
      {
        setupPage: async (page) => { await page.evaluate(() => { document.querySelector('main')!.firstChild!.textContent = 'א'; }); },
        cases: [{ select: '#child:dir(rtl)', expect: { ids: ['child'] } }],
      },
      {
        setupPage: async (page) => { await page.evaluate(() => { document.querySelector('main')!.dir = 'ltr'; }); },
        cases: [{ select: '#child:dir(ltr)', expect: { ids: ['child'] } }],
      },
      {
        setupPage: async (page) => { await page.evaluate(() => { document.querySelector('aside')!.append(document.getElementById('child')!); }); },
        cases: [{ select: '#child:dir(rtl)', expect: { ids: ['child'] } }],
      },
    ],
  },
]);
