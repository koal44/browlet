import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import type {
  CustomPropertyName, CustomPropertyRegistration, PropertyContext,
} from '../../../../src/stylelet/css/property';
import {
  parseStylesheet, type StyleSheet,
} from '../../../../src/stylelet/css/stylesheet';
import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import type { CascadedProperty } from '../../../../src/stylelet/engine/cascade';
import {
  CascadeEngine, type CascadeEngineOptions,
} from '../../../../src/stylelet/engine/cascade-engine';
import { DocumentOrShadowRootStyleState } from '../../../../src/stylelet/engine/document-or-shadow-root';
import { Snapshot } from '../../../../src/stylelet/snapshot';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { defineCustomProperty } from '../../../../src/stylelet/values/whole-value';
import { parseSyntax } from '../../../../src/stylelet/values/syntax-value';
import { createDomletDocument } from '../selector/domlet';

describe('custom property registration', () => {
  it('prefers the registered property set over stylesheet rules', () => {
    const declared = registration('--accent', 'red');
    const registered = registration('--accent', 'blue');
    const { engine, state } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    addStyleSheet(state, styleSheet(declared));

    expect(engine.getCustomPropertyRegistration('--accent', state))
      .toBe(registered);
  });

  it('returns the last stylesheet registration in document order', () => {
    const first = registration('--accent', 'red');
    const second = registration('--accent', 'green');
    const last = registration('--accent', 'blue');
    const { engine, state } = createCascade();
    addStyleSheet(state, styleSheet(first, second));
    addStyleSheet(state, styleSheet(last));

    expect(engine.getCustomPropertyRegistration('--accent', state)).toBe(last);
  });

  it('returns null when the custom property is unregistered', () => {
    const { engine, state } = createCascade();

    expect(engine.getCustomPropertyRegistration('--accent', state)).toBeNull();
  });

  // CSS Properties and Values API 1, 2.2. Parse-Time Behavior
  it('retains a declaration that violates a later registration', () => {
    const sheet = parseStylesheet('* { --accent: 10px }');
    const registered = registration('--accent', 'red');
    const { engine, state } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    const cssStyleSheet = addStyleSheet(state, sheet);

    expect(engine.getCustomPropertyRegistration('--accent', state))
      .toBe(registered);
    expect(engine.getCascadedProperty('--accent', state)).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: true,
        name: '--accent',
        originalText: '10px',
      },
      styleSheet: cssStyleSheet,
      scope: state,
    });
  });

  // CSS Properties and Values API 1, 2.3. Specified Value-Time Behavior
  it.skip.each([
    ['inherit', false, 'blue'],
    ['initial', false, 'red'],
    ['unset', false, 'red'],
    ['unset', true, 'blue'],
  ] as const)(
    'resolves %s using a registration whose inherit flag is %s',
    (keyword, inherits, expected) => {
      const registered = registration('--accent', 'red', inherits);
      const { engine, state } = createCascade({
        registeredPropertySet: new Map([[registered.name, registered]]),
      });
      addStyleSheet(
        state,
        parseStylesheet(`* { --accent: ${keyword} }`),
      );

      expect(resolveSpecifiedCustomProperty(
        engine,
        state,
        '--accent',
        'blue',
      ))
        .toBe(expected);
    },
  );

  // CSS Properties and Values API 1, 2.4. Computed Value-Time Behavior
  it('resolves a registered URL against its originating stylesheet', () => {
    const registered = registration(
      '--image',
      'url("fallback.png")',
      false,
      '<url>',
    );
    const location = new URL('https://example.com/styles/site.css');
    const { engine, state } = createCascade({
      environmentBaseUrl: new URL('https://example.com/document/'),
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    addStyleSheet(state, parseStylesheet(
      '* { --image: url("image.png") }',
      { location },
    ));

    expect(resolveCustomProperty(
      engine,
      state,
      '--image',
      'url("inherited.png")',
      ValueStage.Computed,
    )).toBe('url("https://example.com/styles/image.png")');
  });

  it('captures a registered local URL from each root use', () => {
    const registered = registration('--image', 'url("#fallback")', false, '<url>');
    const document = new JSDOM('<main></main>', {
      url: 'https://example.com/',
    }).window.document;
    const shadowRoot = document.querySelector('main')!
      .attachShadow({ mode: 'open' });
    const { engine } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
      snapshot: new Snapshot(document),
    });
    const documentState = new DocumentOrShadowRootStyleState(document, engine);
    const shadowState = new DocumentOrShadowRootStyleState(shadowRoot, engine);
    const sheet = engine.createStyleSheet() as CSSStyleSheetImpl;
    sheet.replaceSync('* { --image: url("#paint") }');
    documentState.adoptStyleSheet(sheet);
    shadowState.adoptStyleSheet(sheet);
    const documentProperty = engine.getCascadedProperty(
      '--image',
      documentState,
    )!;
    const shadowProperty = engine.getCascadedProperty(
      '--image',
      shadowState,
    )!;

    expect(resolveRegisteredCustomProperty(
      registered,
      documentProperty,
      engine,
    )).toMatchObject({
      value: {
        name: 'url',
        value: { local: true, treeScope: documentState },
      },
    });
    expect(resolveRegisteredCustomProperty(
      registered,
      shadowProperty,
      engine,
    )).toMatchObject({
      value: {
        name: 'url',
        value: { local: true, treeScope: shadowState },
      },
    });
  });

  it.skip.each([
    [false, 'red'],
    [true, 'blue'],
  ] as const)(
    'defaults a syntax-invalid computed value when inherit is %s',
    (inherits, expected) => {
      const registered = registration('--accent', 'red', inherits);
      const { engine, state } = createCascade({
        registeredPropertySet: new Map([[registered.name, registered]]),
      });
      addStyleSheet(state, parseStylesheet('* { --accent: 10px }'));

      expect(resolveCustomProperty(
        engine,
        state,
        '--accent',
        'blue',
        ValueStage.Computed,
      )).toBe(expected);
    },
  );

  it.skip('substitutes variables in a property with universal syntax', () => {
    const registered = registration('--accent', 'red', false, '*');
    const { engine, state } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    addStyleSheet(state, parseStylesheet(`
      * {
        --base: red;
        --accent: var(--base);
      }
    `));

    expect(resolveCustomProperty(
      engine,
      state,
      '--accent',
      'blue',
      ValueStage.Computed,
    )).toBe('red');
  });
});

function registration(
  name: CustomPropertyName,
  initial: string,
  inherits = false,
  syntaxText = '<color>',
): CustomPropertyRegistration {
  const syntax = parseSyntax(syntaxText)!;
  const definition = defineCustomProperty({ syntax });

  return {
    name,
    syntax,
    definition,
    inherits,
    initialValue: definition.parse(initial)!,
  };
}

function resolveSpecifiedCustomProperty(
  engine: CascadeEngine,
  state: DocumentOrShadowRootStyleState,
  name: CustomPropertyName,
  inherited: string,
): string | null {
  return resolveCustomProperty(
    engine,
    state,
    name,
    inherited,
    ValueStage.Specified,
  );
}

function resolveRegisteredCustomProperty(
  registration: CustomPropertyRegistration,
  cascaded: CascadedProperty,
  engine: CascadeEngine,
) {
  if (!cascaded.declaration.custom) return null;

  return registration.definition.parse(cascaded.declaration.value.components)
    ?.resolve(ValueStage.Computed, engine.getPropertyContext(cascaded)) ?? null;
}

function resolveCustomProperty(
  engine: CascadeEngine,
  state: DocumentOrShadowRootStyleState,
  name: CustomPropertyName,
  inherited: string,
  stage: ValueStage,
): string | null {
  const registration = engine.getCustomPropertyRegistration(name, state);
  const cascaded = engine.getCascadedProperty(name, state);

  if (
    registration === null ||
    cascaded === null ||
    !cascaded.declaration.custom
  ) {
    return null;
  }

  const declaration = cascaded.declaration;
  const inheritedValue = registration.definition.parse(inherited)
    ?.resolve(ValueStage.Computed, {});
  const context: PropertyContext & {
    customProperty: {
      engine: CascadeEngine;
      registration: CustomPropertyRegistration;
      inheritedValue: typeof inheritedValue;
    };
  } = {
    ...engine.getPropertyContext(cascaded),
    customProperty: { engine, registration, inheritedValue },
  };

  return registration.definition.parse(declaration.value.components)
    ?.resolve(stage, context)
    ?.serialize() ?? null;
}

function styleSheet(
  ...registrations: CustomPropertyRegistration[]
): StyleSheet {
  return {
    rules: registrations.map((registration) => ({
      type: 'property-rule',
      registration,
    })),
  };
}

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
  sheet: StyleSheet,
): CSSStyleSheetImpl {
  const styleSheet = CSSStyleSheetImpl.__create(
    state.cascade.snapshot,
    {
      location: sheet.location?.href ?? null,
      parentStyleSheet: null,
      ownerNode: null,
      ownerRule: null,
      media: '',
      title: '',
      alternate: false,
      originClean: true,
    },
    sheet,
  );

  state.addStyleSheet(styleSheet);
  return styleSheet;
}
