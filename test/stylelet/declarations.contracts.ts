/* eslint-disable @typescript-eslint/unbound-method -- Reflect.apply supplies the declaration receiver explicitly. */

/** Exercise the projected declaration API in Browlet and native browsers. */
export function exerciseDeclarations(kind: keyof typeof declarationExpectations): unknown {
  const element = document.createElement('div');
  const style = element.style;
  switch (kind) {
    case 'names': {
      const names = ['--Tone', '--tone', '--x:other', '--x y', '--x\\y'];
      for (const name of names) style.setProperty(name, 'red');
      style.setProperty('--', 'reserved');
      return { names: [...style], values: names.map((name) => style.getPropertyValue(name)), reserved: style.getPropertyValue('--') };
    }
    case 'name-serialization': {
      style.setProperty('--x:other', 'red');
      style.setProperty('--x y', 'blue');
      style.setProperty('--x\\y', 'green');
      const text = style.cssText;
      style.cssText = text;
      return { text, names: [...style], values: [...style].map((name) => style.getPropertyValue(name)) };
    }
    case 'values': {
      const invalid = ['red;', 'red !important', 'red; color: blue', 'red}'];
      const results = invalid.map((value) => {
        style.cssText = '';
        style.setProperty('color', value);
        style.setProperty('--value', value);
        return style.length;
      });
      style.cssText = '--: reserved; --Empty: ; --Comment: /**/; --Text: A/**/B !important;';
      return { results, names: [...style], text: style.cssText, value: style.getPropertyValue('--Text'), priority: style.getPropertyPriority('--Text') };
    }
    case 'custom-spelling': {
      style.setProperty('--Text', 'A/**/B foo\\62 ar', 'important');
      const text = style.cssText;
      style.cssText = text;
      return { text, value: style.getPropertyValue('--Text'), priority: style.getPropertyPriority('--Text') };
    }
    case 'empty-custom-value': {
      style.cssText = '--Empty: ;';
      const value = style.getPropertyValue('--Empty');
      const text = style.cssText;
      style.setProperty('--Copy', value);
      return { value, missing: style.getPropertyValue('--Missing'), text, names: [...style] };
    }
    case 'mutations': {
      element.setAttribute('style', 'COLOR: red; opacity: .5;');
      style.setProperty('Color', 'red');
      const unchanged = element.getAttribute('style');
      style.setProperty('opacity', '.7', 'IMPORTANT');
      style.setProperty('color', 'blue', ' important ');
      const before = [style.cssText, style.getPropertyPriority('OPACITY'), style.item(1), style.item(9)];
      style.setProperty('COLOR', '');
      const removed = style.removeProperty('OPACITY');
      return { unchanged, before, removed, text: style.cssText, attribute: element.getAttribute('style'), names: [...style] };
    }
    case 'bindings': {
      Reflect.apply(style.setProperty, style, ['color', { toString: () => 'red' }, null]);
      Reflect.set(style, 'margin-top', '2px');
      const before = [style.color, style.marginTop, style[0], style[1], style[2] === undefined];
      Reflect.set(style, 'marginTop', null);
      Reflect.apply(style.setProperty, style, ['color', null, null]);
      return { before, names: [...style], parent: style.parentRule };
    }
    case 'empty-priority': {
      style.color = 'red';
      style.setProperty('COLOR', '', 'invalid');
      const empty = style.cssText;
      style.color = 'blue';
      Reflect.apply(style.setProperty, style, ['color', null, 'invalid']);
      return { empty, convertedNull: style.cssText };
    }
    case 'property-aliases': {
      style.backgroundColor = 'red';
      const fromCamel = [Reflect.get(style, 'background-color'), style.getPropertyValue('background-color'), style.item(0)];
      Reflect.set(style, 'background-color', 'blue');
      const fromDashed = [style.backgroundColor, style.getPropertyValue('background-color'), style.length];
      style.setProperty('background-color', 'green');
      const fromProperty = [style.backgroundColor, Reflect.get(style, 'background-color')];
      Reflect.set(style, 'backgroundColor', null);
      return { fromCamel, fromDashed, fromProperty, cleared: style.cssText };
    }
    case 'indexed-write': {
      style.color = 'red';
      return { accepted: Reflect.set(style, '0', 'wrong'), item: style[0], text: style.cssText };
    }
    case 'property-attributes': {
      const prototype = Object.getPrototypeOf(style) as object;
      return { ownColor: Object.hasOwn(style, 'color'), prototypeColor: Object.hasOwn(prototype, 'color') };
    }
    case 'readonly': {
      document.body.append(element);
      element.style.color = 'red';
      const computed = getComputedStyle(element);
      const attempts = [
        () => { computed.cssText = ''; },
        () => { computed.setProperty('unknown', '', 'invalid'); },
        () => { computed.removeProperty('unknown'); },
        () => { computed.color = 'blue'; },
      ];
      return {
        text: computed.cssText,
        errors: attempts.map((attempt) => {
          try { attempt(); return ''; }
          catch (error) { return (error as DOMException).name; }
        }),
      };
    }
  }
}

export const declarationExpectations = {
  names: { names: ['--Tone', '--tone', '--x:other', '--x y', '--x\\y'], values: ['red', 'red', 'red', 'red', 'red'], reserved: '' },
  'name-serialization': {
    text: '--x\\:other: red; --x\\ y: blue; --x\\\\y: green;',
    names: ['--x:other', '--x y', '--x\\y'], values: ['red', 'blue', 'green'],
  },
  values: {
    results: [0, 0, 0, 0], names: ['--Empty', '--Comment', '--Text'],
    text: '--Empty: ; --Comment: ; --Text: A/**/B !important;', value: 'A/**/B', priority: 'important',
  },
  'custom-spelling': { text: '--Text: A/**/B foo\\62 ar !important;', value: 'A/**/B foo\\62 ar', priority: 'important' },
  'empty-custom-value': { value: ' ', missing: '', text: '--Empty: ;', names: ['--Empty', '--Copy'] },
  mutations: {
    unchanged: 'COLOR: red; opacity: .5;', before: ['color: red; opacity: 0.7 !important;', 'important', 'opacity', ''],
    removed: '0.7', text: '', attribute: '', names: [],
  },
  bindings: { before: ['red', '2px', 'color', 'margin-top', true], names: [], parent: null },
  'property-aliases': {
    fromCamel: ['red', 'red', 'background-color'], fromDashed: ['blue', 'blue', 1],
    fromProperty: ['green', 'green'], cleared: '',
  },
  'empty-priority': { empty: '', convertedNull: '' },
  'indexed-write': { accepted: false, item: 'color', text: 'color: red;' },
  'property-attributes': { ownColor: false, prototypeColor: true },
  readonly: { text: '', errors: Array<string>(4).fill('NoModificationAllowedError') },
};

