import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { serializePropertyDeclaration } from '../../../../src/stylelet/css/property';
import {
  parseStylesheet, type StyleSheetOptions,
} from '../../../../src/stylelet/css/stylesheet';
import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import {
  CascadeEngine, type CascadeEngineOptions,
} from '../../../../src/stylelet/engine/cascade-engine';
import { DocumentOrShadowRootStyleState } from '../../../../src/stylelet/engine/document-or-shadow-root';
import { Snapshot } from '../../../../src/stylelet/snapshot';
import { createDomletDocument } from '../selector/domlet';

describe('cascade engine', () => {
  it('reads the root-owned final stylesheets in document order', () => {
    const { engine, state } = createCascade();
    const first = addStyleSheet(state, '* { color: red }');
    const second = addStyleSheet(state, '* { color: blue }');

    expect([...state.styleSheets]).toEqual([first, second]);
    expect([...state.finalStyleSheets()]).toEqual([first, second]);
    expect([...engine.getActiveStyleSheets(state)]).toEqual([first, second]);
  });

  it('derives active stylesheets from the final stylesheet list', () => {
    const { engine, state } = createCascade();
    const disabled = addStyleSheet(state, '* { color: red }');
    const enabled = addStyleSheet(state, '* { color: blue }');
    disabled.disabled = true;

    expect([...state.finalStyleSheets()]).toEqual([disabled, enabled]);
    expect([...engine.getActiveStyleSheets(state)]).toEqual([enabled]);
  });

  it('finds an unambiguous property through the cascade boundary', () => {
    const { engine, state } = createCascade();
    const styleSheet = addStyleSheet(state, `
      * {
        --accent: red;
        color: var(--accent);
      }
    `);

    expect(engine.getCascadedProperty('color', state)).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: false,
        name: 'color',
        value: { type: 'substitution-value' },
      },
      styleSheet,
      scope: state,
    });
    expect(engine.getCascadedProperty('--accent', state)).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: true,
        name: '--accent',
      },
      styleSheet,
      scope: state,
    });
  });

  it('derives URL context from stylesheet provenance and the environment', () => {
    const environmentBaseUrl = new URL('https://example.com/document/');
    const location = new URL('https://example.com/styles/site.css');
    const explicitBaseUrl = new URL('https://cdn.example.com/assets/');
    const context = (options: StyleSheetOptions = {}) => {
      const { engine, state } = createCascade({ environmentBaseUrl });
      addStyleSheet(state, '* { color: red }', options);

      return engine.getPropertyContext(
        engine.getCascadedProperty('color', state)!,
      );
    };

    expect([
      context().baseUrl,
      context({ location }).baseUrl,
      context({ location, baseUrl: explicitBaseUrl }).baseUrl,
    ]).toEqual([
      environmentBaseUrl,
      location,
      explicitBaseUrl,
    ]);
  });

  it('captures a constructed stylesheet location at creation', () => {
    const document = createDomletDocument('');
    const location = new URL('https://example.com/constructed/');
    Object.defineProperty(document, 'baseURI', { value: location.href });
    const { engine, state } = createCascade({
      environmentBaseUrl: new URL('https://example.com/environment/'),
      snapshot: new Snapshot(document),
    });
    const styleSheet = engine.createStyleSheet() as CSSStyleSheetImpl;
    styleSheet.replaceSync('* { color: red }');
    state.adoptStyleSheet(styleSheet);

    const property = engine.getCascadedProperty('color', state)!;

    expect(engine.getPropertyContext(property).baseUrl).toEqual(location);
  });

  it('captures an embedded stylesheet base when its source is parsed', () => {
    const document = createDomletDocument('');
    const baseUrl = new URL('https://example.com/embedded/');
    Object.defineProperty(document, 'baseURI', { value: baseUrl.href });
    const { engine, state } = createCascade({
      environmentBaseUrl: new URL('https://example.com/environment/'),
      snapshot: new Snapshot(document),
    });
    const ownerNode = document.createElement('style');
    state.createInlineStyleSheet(ownerNode, '* { color: red }');

    const property = engine.getCascadedProperty('color', state)!;

    expect(engine.getPropertyContext(property).baseUrl).toEqual(baseUrl);
  });

  it('distinguishes separate tree-scope uses of an adopted stylesheet', () => {
    const document = new JSDOM('<main></main>', {
      url: 'https://example.com/',
    }).window.document;
    const shadowRoot = document.querySelector('main')!
      .attachShadow({ mode: 'open' });
    const { engine } = createCascade({ snapshot: new Snapshot(document) });
    const documentState = new DocumentOrShadowRootStyleState(document, engine);
    const shadowState = new DocumentOrShadowRootStyleState(shadowRoot, engine);
    const styleSheet = engine.createStyleSheet() as CSSStyleSheetImpl;
    styleSheet.replaceSync('* { color: red }');
    documentState.adoptStyleSheet(styleSheet);
    shadowState.adoptStyleSheet(styleSheet);

    const documentProperty = engine.getCascadedProperty(
      'color',
      documentState,
    )!;
    const shadowProperty = engine.getCascadedProperty('color', shadowState)!;

    expect(documentProperty.styleSheet).toBe(styleSheet);
    expect(shadowProperty.styleSheet).toBe(styleSheet);
    expect(engine.getPropertyContext(documentProperty).treeScope)
      .toBe(documentState);
    expect(engine.getPropertyContext(shadowProperty).treeScope)
      .toBe(shadowState);
    expect(documentState.root).toBe(document);
    expect(shadowState.root).toBe(shadowRoot);
  });

  it('observes CSSOM rule replacement, insertion, and deletion', () => {
    const { engine, state } = createCascade();
    const styleSheet = engine.createStyleSheet() as CSSStyleSheetImpl;
    state.adoptStyleSheet(styleSheet);

    styleSheet.replaceSync('* { color: red }');
    expect(engine.getCascadedProperty('color', state)?.declaration)
      .toMatchObject({ name: 'color' });

    const rule = styleSheet.cssRules.item(0) as CSSStyleRule;
    rule.style.setProperty('color', 'blue');
    expect(serializePropertyDeclaration(
      engine.getCascadedProperty('color', state)!.declaration,
    ).value).toBe('blue');

    styleSheet.insertRule('* { opacity: 0.5 }');
    expect(engine.getCascadedProperty('opacity', state)?.declaration)
      .toMatchObject({ name: 'opacity' });

    styleSheet.deleteRule(0);
    expect(engine.getCascadedProperty('opacity', state)).toBeNull();
  });

  it('matches a target and sorts author declarations by cascade precedence', () => {
    const document = createDomletDocument(
      '<main id="target" class="target"></main>',
    );
    const target = document.getElementById('target')!;
    const { engine, state } = createCascade({
      snapshot: new Snapshot(document),
    });
    addStyleSheet(state, `
      .target { color: red !important }
      #target { color: green }
      main { color: black !important }
      .target { color: blue !important }
      .other { color: white !important }
    `);

    const result = engine.getCascadedPropertyForElement(
      'color',
      target,
      state,
    );

    expect(result).not.toBeNull();
    expect(serializePropertyDeclaration(result!.declaration).value)
      .toBe('blue');
  });
});

function createCascade(options: Partial<CascadeEngineOptions> = {}) {
  const snapshot = options.snapshot ?? new Snapshot(createDomletDocument(''));
  const engine = new CascadeEngine({ ...options, snapshot });

  return {
    engine,
    state: new DocumentOrShadowRootStyleState(snapshot.document, engine),
  };
}

function addStyleSheet(
  state: DocumentOrShadowRootStyleState,
  source: string,
  options: StyleSheetOptions = {},
): CSSStyleSheetImpl {
  const styleSheet = CSSStyleSheetImpl.__create(
    state.cascade.snapshot,
    {
      location: options.location?.href ?? null,
      parentStyleSheet: null,
      ownerNode: null,
      ownerRule: null,
      media: '',
      title: '',
      alternate: false,
      originClean: true,
    },
    parseStylesheet(source, options),
  );

  state.addStyleSheet(styleSheet);
  return styleSheet;
}
