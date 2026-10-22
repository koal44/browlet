import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { exerciseCustomProperties, customPropertyExpectations } from '../../stylelet/custom-properties.contracts';

describe('custom properties through CSSOM bindings', () => {
  it('retains boundary and comment-only source through sheets, substitution, and copying', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('div');
      document.body.append(element);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`div {
        --value: /*v*/red/*e*/ !important;
        --only: /*only*/;
        --result: /*a*/fn(/*b*/var(--value)/*c*/)/*d*/;
        --empty: var(--only);
      }`);
      document.adoptedStyleSheets = [sheet];
      const computed = getComputedStyle(element);
      const result = ['--value', '--only', '--result', '--empty'].map((name) => computed.getPropertyValue(name));
      element.style.setProperty('--copy', computed.getPropertyValue('--only'));
      const text = element.style.cssText;
      element.style.cssText = text;
      return [...result, element.style.getPropertyValue('--copy'), getComputedStyle(element).getPropertyValue('--copy')];
    })).toEqual(['/*v*/red/*e*/', '/*only*/', '/*a*/fn(/*b*//*v*/red/*e*//*c*/)/*d*/', '/*only*/', '/*only*/', '/*only*/']);
  });

  it('retains comments exposed by empty replacements, including inside blocks', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('div');
      document.body.append(element);
      element.style.cssText = `
        --empty: ;
        --head: var(--empty)/**/one;
        --tail: one/**/var(--empty);
        --none: var(--empty)/**/var(--empty);
        --block: fn(var(--empty)/**/);
      `;
      const computed = getComputedStyle(element);
      return ['--head', '--tail', '--none', '--block'].map((name) => computed.getPropertyValue(name));
    })).toEqual(['/**/one', 'one/**/', '/**/', 'fn(/**/)']);
  });

  it.each(Object.keys(customPropertyExpectations) as (keyof typeof customPropertyExpectations)[])('%s', async (kind) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseCustomProperties, kind)).toEqual(customPropertyExpectations[kind]);
  });
});
