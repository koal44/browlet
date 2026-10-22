/** Exercise custom declarations and their computed values through the same author API in every host. */
export function exerciseCustomProperties(kind: keyof typeof customPropertyExpectations): unknown {
  const parent = document.createElement('main');
  const child = document.createElement('span');
  parent.append(child);
  document.body.append(parent);
  switch (kind) {
    case 'name-identity': {
      parent.style.cssText = String.raw`--fo\f3: composed; --foo\301: combining; --Tone: UPPER; --tone: lower`;
      child.style.cssText = '--first: vAr(--foó); --second: VAR(--foo\u0301); --upper: var(--Tone); --lower: var(--tone)';
      const computed = getComputedStyle(child);
      return {
        names: [...parent.style],
        declared: [...parent.style].map((name) => parent.style.getPropertyValue(name)),
        computed: ['--first', '--second', '--upper', '--lower'].map((name) => computed.getPropertyValue(name)),
      };
    }
    case 'acceptance': {
      parent.style.cssText = '--: reserved; --Tone: UPPER; --tone: lower; --number: 01.00e+0EM; --tokens: [a] {b} foo(c); --bad: !nope; --end: yes';
      const names = ['--', '--Tone', '--tone', '--number', '--tokens', '--bad', '--end'];
      return {
        declared: names.map((name) => parent.style.getPropertyValue(name)),
        inherited: names.map((name) => getComputedStyle(child).getPropertyValue(name)),
      };
    }
    case 'defaulting': {
      parent.style.cssText = '--a: parent !important; --b: parent; --c: parent; --d: parent';
      child.style.cssText = '--a: child; --b: initial; --c: InHeRiT; --d: unset; --literal: initial extra';
      const computed = getComputedStyle(child);
      return {
        values: ['--a', '--b', '--c', '--d', '--literal'].map((name) => computed.getPropertyValue(name)),
        priority: computed.getPropertyPriority('--c'),
      };
    }
    case 'invalid-enumeration': {
      parent.style.setProperty('--a', 'parent');
      child.style.setProperty('--a', 'initial');
      return Array.from(getComputedStyle(child)).includes('--a');
    }
    case 'root-defaults': {
      document.documentElement.style.cssText = '--a: initial; --b: inherit; --c: unset';
      const computed = getComputedStyle(child);
      return ['--a', '--b', '--c', '--missing'].map((name) => computed.getPropertyValue(name));
    }
    case 'empty-computed-copy': {
      parent.style.cssText = '--empty:; --result: var(--empty)';
      const computed = getComputedStyle(child);
      const value = computed.getPropertyValue('--result');
      child.style.setProperty('--copy', value);
      return [value, child.style.getPropertyValue('--copy'), [...child.style].includes('--copy'),
        getComputedStyle(child).getPropertyValue('--copy')];
    }
    case 'cascade': {
      parent.id = 'custom-target';
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('main { --a: first; --b: sheet !important } #custom-target { --a: specific; --c: first } #custom-target { --c: later }');
      document.adoptedStyleSheets = [sheet];
      parent.style.cssText = '--b: inline; --d: inline !important';
      const computed = getComputedStyle(child);
      return {
        values: ['--a', '--b', '--c', '--d'].map((name) => computed.getPropertyValue(name)),
        priorities: ['--b', '--d'].map((name) => computed.getPropertyPriority(name)),
      };
    }
    case 'mutation': {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('main { --a: sheet }');
      document.adoptedStyleSheets = [sheet];
      const result = [getComputedStyle(child).getPropertyValue('--a')];
      parent.style.setProperty('--a', 'inline');
      result.push(getComputedStyle(child).getPropertyValue('--a'));
      parent.style.removeProperty('--a');
      (sheet.cssRules[0] as CSSStyleRule).style.setProperty('--a', 'edited');
      result.push(getComputedStyle(child).getPropertyValue('--a'));
      sheet.disabled = true;
      result.push(getComputedStyle(child).getPropertyValue('--a'));
      return result;
    }
    case 'retained-source': {
      parent.style.setProperty('--a', '01.00e+0EM/**/ReD url(relative.svg)');
      return [parent, child].map((element) => getComputedStyle(element).getPropertyValue('--a'));
    }
    case 'serialization-stages': {
      parent.style.cssText = '--n: 01.00e+0; --uuid: 12345678-12e3-8d9b-a456-426614174000; --result: [ var(--n) var(--uuid) ]';
      const specified = parent.style.getPropertyValue('--result');
      const attribute = parent.getAttribute('style');
      const computed = getComputedStyle(child).getPropertyValue('--result');
      const readsPreserveAttribute = attribute === parent.getAttribute('style');
      child.style.setProperty('--copy', computed);
      const copied = child.style.getPropertyValue('--copy');
      const text = child.style.cssText;
      child.style.cssText = text;
      const roundTrip = child.style.getPropertyValue('--copy');
      parent.style.setProperty('--n', '02.00e+0');
      return {
        specified, computed, copied, roundTrip,
        fresh: getComputedStyle(child).getPropertyValue('--result'),
        copyUnchanged: getComputedStyle(child).getPropertyValue('--copy'),
        declarationUnchanged: parent.style.getPropertyValue('--result') === specified,
        readsPreserveAttribute,
      };
    }
    case 'substitution': {
      parent.style.cssText = '--n: 01.00e+0; --unit: EM; --joined: var(--n)var(--unit); --fn: calc(var(--n) * 1px)';
      child.style.cssText = '--n: 20; --local: var(--n); --fallback: var(--missing, one, two)';
      const computed = getComputedStyle(child);
      return ['--joined', '--fn', '--local', '--fallback'].map((name) => computed.getPropertyValue(name));
    }
    case 'substitution-cycles': {
      parent.style.cssText = '--a: var(--b, inside); --b: var(--c); --c: var(--a); --safe: var(--b, outside); --self: var(--self, wrong)';
      const computed = getComputedStyle(parent);
      return ['--a', '--b', '--c', '--safe', '--self'].map((name) => computed.getPropertyValue(name));
    }
    case 'substitution-invalid-winner': {
      parent.style.cssText = '--a: parent';
      child.style.cssText = '--a: earlier; --a: var(--missing)';
      return getComputedStyle(child).getPropertyValue('--a');
    }
    case 'substitution-eof-block':
    case 'substitution-eof-string':
    case 'substitution-eof-url': {
      const input = kind === 'substitution-eof-block' ? 'f(var(--n)' :
        kind === 'substitution-eof-string' ? '"abc' : 'url(x';
      parent.style.cssText = '--n: red';
      parent.style.setProperty('--a', input);
      parent.style.setProperty('--b', 'var(--a) tail');
      return [parent.style.getPropertyValue('--a'), getComputedStyle(parent).getPropertyValue('--b')];
    }
    case 'substitution-mutation': {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('main { --a: first; --b: var(--a) } span { --c: var(--b) }');
      document.adoptedStyleSheets = [sheet];
      const result = [getComputedStyle(child).getPropertyValue('--c')];
      (sheet.cssRules[0] as CSSStyleRule).style.setProperty('--a', 'second');
      result.push(getComputedStyle(child).getPropertyValue('--c'));
      parent.style.setProperty('--a', 'var(--b)');
      result.push(getComputedStyle(child).getPropertyValue('--c'));
      parent.style.removeProperty('--a');
      result.push(getComputedStyle(child).getPropertyValue('--c'));
      return result;
    }
    case 'var-lazy-fallback': {
      parent.style.cssText = '--a: value; --b: var(--a, var(--b))';
      return getComputedStyle(parent).getPropertyValue('--b');
    }
    case 'var-dynamic-name': {
      parent.style.cssText = '--name: --a; --a: green; --b: var(var(--name))';
      return getComputedStyle(parent).getPropertyValue('--b');
    }
    case 'var-spread': {
      parent.style.cssText = '--args: --missing, green; --b: var(...var(--args))';
      return getComputedStyle(parent).getPropertyValue('--b');
    }
    case 'var-fallback-braces': {
      parent.style.cssText = '--b: var(--missing, {red, blue})';
      return getComputedStyle(parent).getPropertyValue('--b');
    }
    case 'var-name-validation': {
      parent.style.cssText = '--b: var(not-a-custom-name, green)';
      return getComputedStyle(parent).getPropertyValue('--b');
    }
    case 'readonly-result': {
      parent.style.setProperty('--a', 'before', 'important');
      const computed = getComputedStyle(child);
      let error = '';
      try { computed.setProperty('--a', 'after'); } catch (caught) { error = (caught as DOMException).name; }
      return [computed.getPropertyValue('--a'), computed.getPropertyPriority('--a'), computed.cssText, error];
    }
  }
}

export const customPropertyExpectations = {
  'name-identity': {
    names: ['--foó', '--foo\u0301', '--Tone', '--tone'],
    declared: ['composed', 'combining', 'UPPER', 'lower'],
    computed: ['composed', 'combining', 'UPPER', 'lower'],
  },
  acceptance: {
    declared: ['', 'UPPER', 'lower', '01.00e+0EM', '[a] {b} foo(c)', '', 'yes'],
    inherited: ['', 'UPPER', 'lower', '01.00e+0EM', '[a] {b} foo(c)', '', 'yes'],
  },
  defaulting: { values: ['child', '', 'parent', 'parent', 'initial extra'], priority: '' },
  'invalid-enumeration': false,
  'root-defaults': ['', '', '', ''],
  'empty-computed-copy': [' ', ' ', true, ' '],
  cascade: { values: ['specific', 'sheet', 'later', 'inline'], priorities: ['', ''] },
  mutation: ['sheet', 'inline', 'edited', ''],
  'retained-source': ['01.00e+0EM/**/ReD url(relative.svg)', '01.00e+0EM/**/ReD url(relative.svg)'],
  'serialization-stages': {
    specified: '[ var(--n) var(--uuid) ]',
    computed: '[ 01.00e+0 12345678-12e3-8d9b-a456-426614174000 ]',
    copied: '[ 01.00e+0 12345678-12e3-8d9b-a456-426614174000 ]',
    roundTrip: '[ 01.00e+0 12345678-12e3-8d9b-a456-426614174000 ]',
    fresh: '[ 02.00e+0 12345678-12e3-8d9b-a456-426614174000 ]',
    copyUnchanged: '[ 01.00e+0 12345678-12e3-8d9b-a456-426614174000 ]',
    declarationUnchanged: true,
    readsPreserveAttribute: true,
  },
  substitution: ['01.00e+0/**/EM', 'calc(01.00e+0 * 1px)', '20', 'one, two'],
  'substitution-cycles': ['', '', '', 'outside', ''],
  'substitution-invalid-winner': '',
  'substitution-eof-block': ['f(var(--n)', 'f(red tail'],
  'substitution-eof-string': ['"abc', '"abc tail'],
  'substitution-eof-url': ['url(x', 'url(x tail'],
  'substitution-mutation': ['first', 'second', '', 'second'],
  'var-lazy-fallback': 'value',
  'var-dynamic-name': 'green',
  'var-spread': 'green',
  'var-fallback-braces': 'red, blue',
  'var-name-validation': 'green',
  'readonly-result': ['before', '', '', 'NoModificationAllowedError'],
};
