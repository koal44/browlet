import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('lang pseudo', 'normal', [
  {
    name: 'wpt lang pseudo empty attributes block inheritance',
    // status: 'only',
    markupMode: 'xml-document',
    markup: `
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:foo="http://www.example.com/foo">
        <body>
          <p id="parent" xml:lang="de">
            <span lang="" id="emptyLang"/>
            <span xml:lang="" id="emptyXmlLang"/>
            <span id="noLang"/>
          </p>
        </body>
      </html>
    `,
    cases: [
      { select: 'span:lang(de)', expect: { ids: ['noLang'] } },
      { match: ':lang(de)', ref: { by: 'id', id: 'emptyLang' }, expect: { ids: [] } },
      { match: ':lang(de)', ref: { by: 'id', id: 'emptyXmlLang' }, expect: { ids: [] } },
      { match: ':lang(de)', ref: { by: 'id', id: 'noLang' }, expect: { ids: ['noLang'] } },
    ],
  },
]);
