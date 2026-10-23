import { describe, expect, it } from 'vitest';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { JSDOM } from 'jsdom';
import { CascadeEngine } from '../../../../src/stylelet/engine/cascade-engine';
import { TreeScope } from '../../../../src/stylelet/engine/tree-scope';
import { StyleletContext } from '../../../../src/stylelet/context';
import { UrlValue } from '../../../../src/stylelet/values/url';

describe('local URL tree scopes', () => {
  it('captures the active tree scope independently for each use', () => {
    const value = UrlValue.parse('url("#paint")', {})!;
    const { documentScope, shadowScope } = createUrlTreeScopes();
    const documentValue = value.resolve(ValueStage.Specified, { treeScope: documentScope });
    const shadowValue = value.resolve(ValueStage.Specified, { treeScope: shadowScope });

    expect(documentValue).toHaveProperty('repr.treeScope', documentScope);
    expect(shadowValue).toHaveProperty('repr.treeScope', shadowScope);
  });

  it('retains the captured tree scope through inheritance', () => {
    const { documentScope, shadowScope } = createUrlTreeScopes();
    const specified = UrlValue.parse('url("#paint")', {})!.resolve(ValueStage.Specified, { treeScope: documentScope });
    const inherited = specified.resolve(ValueStage.Computed, { treeScope: shadowScope });

    expect(inherited).toHaveProperty('repr.treeScope', documentScope);
  });
});

function createUrlTreeScopes(): {
  documentScope: TreeScope;
  shadowScope: TreeScope;
} {
  const document = new JSDOM('<main></main>', {
    url: 'https://example.com/',
  }).window.document;
  const context = new StyleletContext(document);
  const cascade = new CascadeEngine({ context });
  const shadowRoot = document.querySelector('main')!
    .attachShadow({ mode: 'open' });

  return {
    documentScope: new TreeScope(document, cascade),
    shadowScope: new TreeScope(shadowRoot, cascade),
  };
}
