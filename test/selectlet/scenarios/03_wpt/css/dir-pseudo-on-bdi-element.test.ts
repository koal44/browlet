import { runScenarios } from '../../../../scenario/dispatch';

runScenarios('dir pseudo', 'normal', [
  {
    name: 'wpt bdi dir directionality',
    // status: 'only',
    markup: `
      <div id="bdi-missing">
        <bdi id="missing-empty"></bdi>
        <bdi id="missing-rtl">ת</bdi>
      </div>

      <div id="bdi-invalid">
        <bdi id="invalid-empty" dir="foo"></bdi>
        <bdi id="invalid-rtl" dir="foo">ת</bdi>
      </div>

      <div id="bdi-auto">
        <bdi id="auto-empty" dir="auto"></bdi>
        <bdi id="auto-rtl" dir="auto">ת</bdi>
        <bdi id="AUTO-rtl" dir="AUTO">ת</bdi>
      </div>

      <div id="bdi-ltr">
        <bdi id="ltr-empty" dir="ltr"></bdi>
        <bdi id="LTR-empty" dir="LTR"></bdi>
        <bdi id="ltr-rtl-text" dir="ltr">ת</bdi>
      </div>

      <div id="bdi-rtl">
        <bdi id="rtl-empty" dir="rtl"></bdi>
        <bdi id="RTL-empty" dir="RTL"></bdi>
        <bdi id="rtl-rtl-text" dir="rtl">ת</bdi>
      </div>
    `,
    cases: [
      { select: '#bdi-missing > :dir(ltr)', expect: { ids: ['missing-empty'] } },
      { select: '#bdi-missing > :dir(rtl)', expect: { ids: ['missing-rtl'] } },

      { select: '#bdi-invalid > :dir(ltr)', expect: { ids: ['invalid-empty'] } },
      { select: '#bdi-invalid > :dir(rtl)', expect: { ids: ['invalid-rtl'] } },

      { select: '#bdi-auto > :dir(ltr)', expect: { ids: ['auto-empty'] } },
      { select: '#bdi-auto > :dir(rtl)', expect: { ids: ['auto-rtl', 'AUTO-rtl'] } },

      { select: '#bdi-ltr > :dir(ltr)', expect: { ids: ['ltr-empty', 'LTR-empty', 'ltr-rtl-text'] } },
      { select: '#bdi-ltr > :dir(rtl)', expect: { ids: [] } },

      { select: '#bdi-rtl > :dir(ltr)', expect: { ids: [] } },
      { select: '#bdi-rtl > :dir(rtl)', expect: { ids: ['rtl-empty', 'RTL-empty', 'rtl-rtl-text'] } },
    ],
  },
]);
