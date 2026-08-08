import { describe, expect, it } from 'vitest';

import type {
  CustomPropertyName, CustomPropertyRegistration, PropertyContext,
} from '../../../../src/stylelet/css/property';
import {
  parseStylesheet, type StyleSheet,
} from '../../../../src/stylelet/css/stylesheet';
import { createTreeScope } from '../../../../src/stylelet/css/tree-scope';
import type { CascadedProperty } from '../../../../src/stylelet/engine/cascade';
import { StyleEngine } from '../../../../src/stylelet/engine/engine';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { defineCustomProperty } from '../../../../src/stylelet/values/whole-value';
import { parseSyntax } from '../../../../src/stylelet/values/syntax-value';

describe('custom property registration', () => {
  it('prefers the registered property set over stylesheet rules', () => {
    const declared = registration('--accent', 'red');
    const registered = registration('--accent', 'blue');
    const engine = new StyleEngine({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    engine.addStyleSheet(styleSheet(declared));

    expect(engine.getCustomPropertyRegistration('--accent')).toBe(registered);
  });

  it('returns the last stylesheet registration in document order', () => {
    const first = registration('--accent', 'red');
    const second = registration('--accent', 'green');
    const last = registration('--accent', 'blue');
    const engine = new StyleEngine();
    engine.addStyleSheet(styleSheet(first, second));
    engine.addStyleSheet(styleSheet(last));

    expect(engine.getCustomPropertyRegistration('--accent')).toBe(last);
  });

  it('returns null when the custom property is unregistered', () => {
    const engine = new StyleEngine();

    expect(engine.getCustomPropertyRegistration('--accent')).toBeNull();
  });

  // CSS Properties and Values API 1, 2.2. Parse-Time Behavior
  it('retains a declaration that violates a later registration', () => {
    const sheet = parseStylesheet('* { --accent: 10px }');
    const registered = registration('--accent', 'red');
    const engine = new StyleEngine({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    engine.addStyleSheet(sheet);

    expect(engine.getCustomPropertyRegistration('--accent')).toBe(registered);
    expect(engine.getCascadedProperty('--accent')).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: true,
        name: '--accent',
        originalText: '10px',
      },
      association: {
        styleSheet: sheet,
        treeScope: engine.treeScope,
      },
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
      const engine = new StyleEngine({
        registeredPropertySet: new Map([[registered.name, registered]]),
      });
      engine.addStyleSheet(parseStylesheet(`* { --accent: ${keyword} }`));

      expect(resolveSpecifiedCustomProperty(engine, '--accent', 'blue'))
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
    const engine = new StyleEngine({
      environmentBaseUrl: new URL('https://example.com/document/'),
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    engine.addStyleSheet(parseStylesheet(
      '* { --image: url("image.png") }',
      { location },
    ));

    expect(resolveCustomProperty(
      engine,
      '--image',
      'url("inherited.png")',
      ValueStage.Computed,
    )).toBe('url("https://example.com/styles/image.png")');
  });

  it('captures a registered local URL from its stylesheet association', () => {
    const registered = registration('--image', 'url("#fallback")', false, '<url>');
    const documentScope = createTreeScope();
    const shadowScope = createTreeScope();
    const engine = new StyleEngine({
      registeredPropertySet: new Map([[registered.name, registered]]),
      treeScope: documentScope,
    });
    const sheet = parseStylesheet('* { --image: url("#paint") }');
    engine.addStyleSheet(sheet);
    engine.addStyleSheet(sheet, shadowScope);
    const documentProperty = engine.getCascadedProperty('--image')!;
    const shadowProperty = engine.getCascadedProperty('--image', shadowScope)!;

    expect(resolveRegisteredCustomProperty(
      registered,
      documentProperty,
      engine,
    )).toMatchObject({
      value: {
        name: 'url',
        value: { local: true, treeScope: documentScope },
      },
    });
    expect(resolveRegisteredCustomProperty(
      registered,
      shadowProperty,
      engine,
    )).toMatchObject({
      value: {
        name: 'url',
        value: { local: true, treeScope: shadowScope },
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
      const engine = new StyleEngine({
        registeredPropertySet: new Map([[registered.name, registered]]),
      });
      engine.addStyleSheet(parseStylesheet('* { --accent: 10px }'));

      expect(resolveCustomProperty(
        engine,
        '--accent',
        'blue',
        ValueStage.Computed,
      )).toBe(expected);
    },
  );

  it.skip('substitutes variables in a property with universal syntax', () => {
    const registered = registration('--accent', 'red', false, '*');
    const engine = new StyleEngine({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    engine.addStyleSheet(parseStylesheet(`
      * {
        --base: red;
        --accent: var(--base);
      }
    `));

    expect(resolveCustomProperty(
      engine,
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
  engine: StyleEngine,
  name: CustomPropertyName,
  inherited: string,
): string | null {
  return resolveCustomProperty(
    engine,
    name,
    inherited,
    ValueStage.Specified,
  );
}

function resolveRegisteredCustomProperty(
  registration: CustomPropertyRegistration,
  cascaded: CascadedProperty,
  engine: StyleEngine,
) {
  if (!cascaded.declaration.custom) return null;

  return registration.definition.parse(cascaded.declaration.value.components)
    ?.resolve(ValueStage.Computed, engine.getPropertyContext(cascaded)) ?? null;
}

function resolveCustomProperty(
  engine: StyleEngine,
  name: CustomPropertyName,
  inherited: string,
  stage: ValueStage,
): string | null {
  const registration = engine.getCustomPropertyRegistration(name);
  const cascaded = engine.getCascadedProperty(name);

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
      engine: StyleEngine;
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
