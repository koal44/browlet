/** Exercise substitution, defaulting, and pending shorthand expansion through the author API. */
export function exerciseOrdinaryProperties(kind: keyof typeof ordinaryPropertyExpectations): unknown {
  const parent = document.createElement('main');
  const child = document.createElement('span');
  parent.append(child);
  document.body.append(parent);
  switch (kind) {
    case 'deferred-spelling': {
      return ['margin', 'margin-left', 'opacity'].map((name) => {
        child.style.cssText = '';
        child.style.setProperty(name, 'var( --gap ,  01.00px )', 'important');
        const before = [child.style.getPropertyValue(name), child.style.cssText];
        child.style.setProperty(name, 'var( --gap ,  001.0px )', 'important');
        const after = [child.style.getPropertyValue(name), child.getAttribute('style')];
        const text = child.style.cssText;
        child.style.cssText = text;
        return { before, after, copied: child.style.getPropertyValue(name) };
      });
    }
    case 'deferred-escapes-comments': {
      return ['margin', 'margin-left', 'opacity'].map((name) => {
        child.style.cssText = '';
        child.style.setProperty(name, String.raw`v\61 r(--gap, 01.00px/**/)`);
        return [child.style.getPropertyValue(name), child.style.cssText];
      });
    }
    case 'deferred-eof-block':
    case 'deferred-eof-string':
    case 'deferred-eof-url': {
      const input = {
        'deferred-eof-block': 'var(--gap, 1px',
        'deferred-eof-string': 'var(--gap, "a',
        'deferred-eof-url': 'var(--gap, url(a',
      }[kind];
      return ['margin', 'margin-left', 'opacity'].map((name) => {
        child.style.cssText = '';
        child.style.setProperty(name, input);
        const declared = [child.style.getPropertyValue(name), child.style.cssText];
        const computed = getComputedStyle(child).getPropertyValue(name);
        return { declared, computed, after: child.style.getPropertyValue(name) };
      });
    }
    case 'reparsing': {
      child.style.cssText = '--alpha: 150%; --gap: 2px; opacity: var(--alpha); margin-left: calc(var(--gap) * 3); color: var(--missing, red)';
      const computed = getComputedStyle(child);
      return [computed.opacity, computed.marginLeft, computed.color, child.style.opacity];
    }
    case 'invalid-winners': {
      parent.style.cssText = 'color: blue; opacity: .25';
      child.style.cssText = '--empty:; --bad: 1px; --n: 2; color: red; color: var(--empty, green); opacity: .5; opacity: var(--bad, .75); margin-left: 8px; margin-left: var(--n)px';
      const computed = getComputedStyle(child);
      return [computed.color, computed.opacity, computed.marginLeft];
    }
    case 'defaulting': {
      parent.style.cssText = 'color: blue; opacity: .25; margin-left: 4px';
      child.style.cssText = 'color: var(--missing); opacity: var(--missing, inherit); margin-left: var(--missing, unset); margin-top: initial';
      const computed = getComputedStyle(child);
      return [computed.color, computed.opacity, computed.marginLeft, computed.marginTop, computed.backgroundColor];
    }
    case 'inherited-computed': {
      parent.style.cssText = '--alpha: 25%; opacity: var(--alpha) !important';
      child.style.cssText = '--alpha: 75%; opacity: inherit';
      const computed = getComputedStyle(child);
      return [computed.opacity, computed.getPropertyPriority('opacity'), computed.getPropertyValue('--alpha')];
    }
    case 'pending-override': {
      child.style.cssText = '--space: 2px 4px; margin: var(--space); margin-left: 9px';
      return [getComputedStyle(child).margin, child.style.margin, child.style.marginTop];
    }
    case 'pending-invalid': {
      child.style.cssText = 'margin: 3px; margin: var(--missing); margin-left: 9px';
      return getComputedStyle(child).margin;
    }
    case 'pending-invalid-grammar': {
      child.style.cssText = '--space: 1px red; margin: 3px; margin: var(--space); margin-left: 9px';
      return getComputedStyle(child).margin;
    }
    case 'pending-empty': {
      child.style.cssText = '--space:; margin: 3px; margin: var(--space, 5px); margin-left: 9px';
      return getComputedStyle(child).margin;
    }
    case 'pending-inherit': {
      parent.style.cssText = 'margin: 1px 2px 3px 4px';
      child.style.cssText = 'margin: var(--missing, inherit); margin-left: 9px';
      return getComputedStyle(child).margin;
    }
    case 'pending-inherited-computed': {
      parent.style.cssText = '--space: 1px 2px; margin: var(--space)';
      child.style.cssText = '--space: 9px; margin: inherit';
      return getComputedStyle(child).margin;
    }
    case 'pending-distinct-occurrences': {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('span { margin: var(--sheet) }');
      document.adoptedStyleSheets = [sheet];
      child.style.cssText = '--sheet: 1px 2px; --inline: 3px 4px; margin: var(--inline)';
      child.style.removeProperty('margin-top');
      child.style.removeProperty('margin-bottom');
      return getComputedStyle(child).margin;
    }
    case 'pending-mutation': {
      child.style.cssText = '--a: 2px; --b: 4px; margin: var(--a)';
      const results = [getComputedStyle(child).margin];
      child.style.margin = 'var(--b)';
      results.push(getComputedStyle(child).margin);
      child.style.setProperty('--b', '6px');
      results.push(getComputedStyle(child).margin);
      child.style.setProperty('--b', '1px 2px 3px 4px 5px');
      results.push(getComputedStyle(child).margin);
      return results;
    }
    case 'pending-rule-edits': {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('main { --space: 1px 2px } span { margin: var(--space) !important }');
      document.adoptedStyleSheets = [sheet];
      const source = (sheet.cssRules[0] as CSSStyleRule).style;
      const rule = sheet.cssRules[1] as CSSStyleRule;
      const style = rule.style;
      const read = () => {
        const computed = getComputedStyle(child);
        return [style.margin, style.marginTop, style.getPropertyPriority('margin'),
          computed.margin, computed.getPropertyPriority('margin'), computed.cssText];
      };
      const results = [read()];
      source.setProperty('--space', '3px 4px');
      results.push(read());
      style.setProperty('margin-left', '9px', 'important');
      results.push(read());
      source.setProperty('--space', 'invalid');
      results.push(read());
      style.setProperty('margin', 'var(--space, 5px)', 'important');
      source.removeProperty('--space');
      results.push(read());
      const text = style.cssText;
      style.cssText = text;
      results.push(read());
      style.removeProperty('margin');
      results.push(read());
      return { results, same: rule.style === style, after: rule.cssText };
    }
    case 'pending-cascade': {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('span { --gap: 2px 4px; margin: var(--gap) !important; margin-top: 7px !important }');
      document.adoptedStyleSheets = [sheet];
      child.style.cssText = 'margin: 9px; margin-left: 11px !important';
      const computed = getComputedStyle(child);
      return [computed.margin, computed.getPropertyPriority('margin')];
    }
  }
}

export const ordinaryPropertyExpectations = {
  'deferred-spelling': ['margin', 'margin-left', 'opacity'].map((name) => ({
    before: ['var( --gap ,  01.00px )', `${name}: var( --gap ,  01.00px ) !important;`],
    after: ['var( --gap ,  001.0px )', `${name}: var( --gap ,  001.0px ) !important;`],
    copied: 'var( --gap ,  001.0px )',
  })),
  'deferred-escapes-comments': ['margin', 'margin-left', 'opacity'].map((name) =>
    [String.raw`v\61 r(--gap, 01.00px/**/)`, `${name}: ${String.raw`v\61 r(--gap, 01.00px/**/)`};`]),
  'deferred-eof-block': ['margin', 'margin-left', 'opacity'].map((name) => ({
    declared: ['var(--gap, 1px', `${name}: var(--gap, 1px;`],
    computed: name === 'opacity' ? '1' : '1px', after: 'var(--gap, 1px',
  })),
  'deferred-eof-string': ['margin', 'margin-left', 'opacity'].map((name) => ({
    declared: ['var(--gap, "a', `${name}: var(--gap, "a;`],
    computed: name === 'opacity' ? '1' : '0px', after: 'var(--gap, "a',
  })),
  'deferred-eof-url': ['margin', 'margin-left', 'opacity'].map((name) => ({
    declared: ['var(--gap, url(a', `${name}: var(--gap, url(a;`],
    computed: name === 'opacity' ? '1' : '0px', after: 'var(--gap, url(a',
  })),
  reparsing: ['1', '6px', 'rgb(255, 0, 0)', 'var(--alpha)'],
  'invalid-winners': ['rgb(0, 0, 255)', '1', '0px'],
  defaulting: ['rgb(0, 0, 255)', '0.25', '0px', '0px', 'rgba(0, 0, 0, 0)'],
  'inherited-computed': ['0.25', '', '75%'],
  'pending-override': ['2px 4px 2px 9px', '', ''],
  'pending-invalid': '0px 0px 0px 9px',
  'pending-invalid-grammar': '0px 0px 0px 9px',
  'pending-empty': '0px 0px 0px 9px',
  'pending-inherit': '1px 2px 3px 9px',
  'pending-inherited-computed': '1px 2px',
  'pending-distinct-occurrences': '1px 4px',
  'pending-mutation': ['2px', '4px', '6px', '0px'],
  'pending-rule-edits': {
    results: [
      ['var(--space)', '', 'important', '1px 2px', '', ''],
      ['var(--space)', '', 'important', '3px 4px', '', ''],
      ['', '', 'important', '3px 4px 3px 9px', '', ''],
      ['', '', 'important', '0px 0px 0px 9px', '', ''],
      ['var(--space, 5px)', '', 'important', '5px', '', ''],
      ['var(--space, 5px)', '', 'important', '5px', '', ''],
      ['', '', '', '0px', '', ''],
    ],
    same: true,
    after: 'span { }',
  },
  'pending-cascade': ['7px 4px 2px 11px', ''],
};
