import { describe, expect, it } from 'vitest';

import { HTML_NAMESPACE } from '../../../../../src/infra/index';
import { ContentCategory } from '../../../../../src/browlet/dom/nodes/html/content-model';
import { createTestDocument } from '../../../../support/dom';

// Category-first expectations from §3.2.5.2 and the form-category tables.
// Conditional entries use a detached element with no attributes; input's default type is Text.
// https://html.spec.whatwg.org/multipage/dom.html#kinds-of-content
// https://html.spec.whatwg.org/multipage/forms.html#categories
const categoryMembers: [ContentCategory, string][] = [
  [ContentCategory.Metadata, `
    base link meta noscript script style template title
  `],
  [ContentCategory.Flow, `
    a abbr address article aside audio b bdi bdo blockquote br button canvas cite code data datalist del
    details dfn dialog div dl em embed fieldset figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i
    iframe img input ins kbd label map mark menu meter nav noscript object ol output p picture pre progress
    q ruby s samp script search section select slot small span strong sub sup table template textarea time u
    ul var video wbr
  `],
  [ContentCategory.Sectioning, `
    article aside nav section
  `],
  [ContentCategory.Heading, `
    h1 h2 h3 h4 h5 h6
  `],
  [ContentCategory.Phrasing, `
    a abbr audio b bdi bdo br button canvas cite code data datalist del dfn em embed i iframe img input ins
    kbd label map mark meter noscript object output picture progress q ruby s samp script select slot small
    span strong sub sup template textarea time u var video wbr
  `],
  [ContentCategory.Embedded, `
    audio canvas embed iframe img object picture video
  `],
  [ContentCategory.Interactive, `
    button details embed iframe input label select textarea
  `],
  [ContentCategory.Palpable, `
    a abbr address article aside b bdi bdo blockquote button canvas cite code data del details dfn div em
    embed fieldset figure footer form h1 h2 h3 h4 h5 h6 header hgroup i iframe img input ins kbd label main
    map mark meter nav object output p picture pre progress q ruby s samp search section select small span
    strong sub sup table textarea time u var video
  `],
  [ContentCategory.ScriptSupporting, `
    script template
  `],
  [ContentCategory.FormAssociated, `
    button fieldset input object output select textarea img
  `],
  [ContentCategory.Listed, `
    button fieldset input object output select textarea
  `],
  [ContentCategory.Labelable, `
    button input meter output progress select textarea
  `],
  [ContentCategory.Submittable, `
    button input select textarea
  `],
  [ContentCategory.Resettable, `
    input output select textarea
  `],
  [ContentCategory.AutocapitalizeAndAutocorrectInheriting, `
    button fieldset input output select textarea
  `],
];

const defaultMembers = new Map(categoryMembers.map(([category, names]) => [category, new Set(names.trim().split(/\s+/))]));
const elementNames = `
  a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite
  code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure
  footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link
  main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp
  rt ruby s samp script search section select selectedcontent slot small source span strong style sub
  summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr
`.trim().split(/\s+/);

describe('HTML category inventory', () => {
  it.each(elementNames)('accounts for %s across every implemented category', (name) => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, name);
    const other = document.createElementNS(HTML_NAMESPACE, name);
    expect(element.categories).toBeDefined();
    expect(element.categories).toBe(other.categories);
    expect(Object.hasOwn(element, 'categories')).toBe(false);
    for (const [category, members] of defaultMembers) {
      if (name === 'main' && category === ContentCategory.Flow) {
        expect(() => element.hasCategory(category)).toThrow('Main-element hierarchy checking is not implemented');
      } else {
        expect(element.hasCategory(category), ContentCategory[category]).toBe(members.has(name));
      }
    }
  });
});
