import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('attribute selector parsing', 'normal', [
  {
    name: 'attribute presence and value selectors parse',
    // status: 'only',
    markup: `
      <div id="box" att="val"></div>
      <h1 id="heading" title="heading title"></h1>
      <span id="span" class="example"></span>
      <a id="link-fr" hreflang="fr"></a>
      <a id="link-en-us" hreflang="en-US"></a>
    `,
    cases: [
      { match: '[att]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: '[att=val]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: '[att~=val]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: '[att|=val]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: 'h1[title]', ref: { by: 'id', id: 'heading' }, expect: { ids: ['heading'] } },
      { match: "span[class='example']", ref: { by: 'id', id: 'span' }, expect: { ids: ['span'] } },
      { match: 'a[hreflang=fr]', ref: { by: 'id', id: 'link-fr' }, expect: { ids: ['link-fr'] } },
      { match: "a[hreflang|='en']", ref: { by: 'id', id: 'link-en-us' }, expect: { ids: ['link-en-us'] } },
    ],
  },
  {
    name: 'substring matching attribute selectors parse',
    // status: 'only',
    markup: `
      <div id="box" att="value"></div>
      <object id="object-image" type="image/png"></object>
      <a id="link-html" href="index.html"></a>
      <p id="paragraph" title="well hello there"></p>
    `,
    cases: [
      { match: '[att^=val]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: '[att$=val]', ref: { by: 'id', id: 'box' }, expect: { ids: [] } },
      { match: '[att*=val]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: 'object[type^="image/"]', ref: { by: 'id', id: 'object-image' }, expect: { ids: ['object-image'] } },
      { match: 'a[href$=".html"]', ref: { by: 'id', id: 'link-html' }, expect: { ids: ['link-html'] } },
      { match: 'p[title*="hello"]', ref: { by: 'id', id: 'paragraph' }, expect: { ids: ['paragraph'] } },
    ],
  },
  {
    name: 'namespace attribute selector examples parse',
    // status: 'only',
    markup: `
      <div id="box" att="val"></div>
    `,
    cases: [
      { match: '[*|att]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
      { match: '[|att]', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] } },
    ],
  },
]);
