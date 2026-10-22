/** Exercise margin through the same author API in Browlet and native browsers. */
export function exerciseMargin(kind: keyof typeof marginExpectations): unknown {
  const element = document.createElement('div');
  const style = element.style;
  switch (kind) {
    case 'expansion':
      return ['1px', '1px 2%', '1px auto -3px', '1px 2px 3px 4px', '0 AUTO', ' 1px/**/2px '].map((input) => {
        style.margin = input;
        return [style.margin, style.marginTop, style.marginRight, style.marginBottom, style.marginLeft];
      });
    case 'shortening':
      return ['1px 1px 1px 1px', '1px 2px 1px 2px', '1px 2px 3px 2px', '1in 96px 2em 10%', 'calc(1px + 2px) auto'].map((input) => {
        style.margin = input;
        const text = style.cssText;
        style.cssText = text;
        return [text, style.margin];
      });
    case 'css-wide': {
      const keywords = ['initial', 'inherit', 'unset', 'revert', 'revert-layer'].map((keyword) => {
        style.setProperty('margin', keyword, 'important');
        return [style.margin, style.marginLeft, style.getPropertyPriority('margin-top'), style.cssText];
      });
      style.setProperty('margin-left', '1px', 'important');
      const mixed = [style.margin, style.getPropertyPriority('margin'), style.cssText];
      style.setProperty('margin', 'initial');
      style.marginLeft = 'inherit';
      return { keywords, mixed, mixedKeywords: style.margin };
    }
    case 'invalid': {
      style.setProperty('margin', '2px', 'important');
      const unchanged = ['1px 2px 3px 4px 5px', '1px, 2px', '1', '1unknown', 'initial 1px', '1px auto initial', '1px;', '1px !important', '{1px}'].map((input) => {
        style.margin = input;
        return style.cssText;
      });
      style.cssText = 'color: red; margin: 1px 2px 3px 4px 5px; opacity: .5';
      return { unchanged, parsed: style.cssText };
    }
    case 'unchanged-assignment': {
      element.setAttribute('style', 'margin: 1px 1px; color: red');
      style.margin = '1px';
      return element.getAttribute('style');
    }
    case 'mutation': {
      style.cssText = 'margin: 1px 1px; color: red';
      style.setProperty('MARGIN', '2px 4px', 'IMPORTANT');
      const names = [...style];
      const before = [style.cssText, element.getAttribute('style'), style.getPropertyPriority('margin')];
      style.marginLeft = '5px';
      const mixed = [style.margin, style.getPropertyPriority('margin'), style.cssText];
      const removed = style.removeProperty('margin');
      return { names, before, mixed, removed, after: style.cssText };
    }
    case 'rule': {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.card { margin: 1px 2px; margin-left: 3px !important; color: red }');
      const rule = sheet.cssRules[0] as CSSStyleRule;
      const declaration = rule.style;
      const before = [declaration.margin, declaration.marginLeft, declaration.getPropertyPriority('margin-left')];
      declaration.setProperty('margin', '4px', 'important');
      const text = rule.cssText;
      declaration.removeProperty('margin');
      return { before, text, after: rule.cssText, same: rule.style === declaration };
    }
    case 'removal-return': {
      style.setProperty('margin', '4px', 'important');
      return style.removeProperty('margin');
    }
    case 'deferred-longhands': {
      for (const side of ['top', 'right', 'bottom', 'left']) style.setProperty(`margin-${side}`, 'var(--space)');
      return [style.margin, style.marginTop, style.cssText];
    }
    case 'pending-shorthand': {
      style.setProperty('margin', 'var(--first)', 'important');
      const first = [style.margin, style.marginTop, style.cssText];
      style.setProperty('margin', 'var(--second)', 'important');
      const second = [style.margin, style.marginLeft, style.getPropertyPriority('margin'), element.getAttribute('style')];
      style.setProperty('margin-left', '4px', 'important');
      const partial = [style.margin, style.marginLeft, style.cssText];
      style.removeProperty('margin-top');
      return { first, second, partial, removed: style.cssText };
    }
    case 'pending-priority': {
      style.cssText = 'margin: var(--first) !important; margin-left: 4px; margin: var(--second)';
      const priority = [style.margin, style.cssText];
      style.margin = 'var(--third)';
      const replaced = style.cssText;
      return { priority, replaced };
    }
    case 'pending-invalid-name': {
      style.margin = 'var(--fourth)';
      style.margin = 'var(ordinary-name)';
      return style.cssText;
    }
  }
}

export const marginExpectations = {
  expansion: [
    ['1px', '1px', '1px', '1px', '1px'],
    ['1px 2%', '1px', '2%', '1px', '2%'],
    ['1px auto -3px', '1px', 'auto', '-3px', 'auto'],
    ['1px 2px 3px 4px', '1px', '2px', '3px', '4px'],
    ['0px auto', '0px', 'auto', '0px', 'auto'],
    ['1px 2px', '1px', '2px', '1px', '2px'],
  ],
  shortening: [
    ['margin: 1px;', '1px'],
    ['margin: 1px 2px;', '1px 2px'],
    ['margin: 1px 2px 3px;', '1px 2px 3px'],
    ['margin: 1in 96px 2em 10%;', '1in 96px 2em 10%'],
    ['margin: calc(3px) auto;', 'calc(3px) auto'],
  ],
  'css-wide': {
    keywords: [
      ['initial', 'initial', 'important', 'margin: initial !important;'],
      ['inherit', 'inherit', 'important', 'margin: inherit !important;'],
      ['unset', 'unset', 'important', 'margin: unset !important;'],
      ['revert', 'revert', 'important', 'margin: revert !important;'],
      ['revert-layer', 'revert-layer', 'important', 'margin: revert-layer !important;'],
    ],
    mixed: ['', 'important', 'margin-top: revert-layer !important; margin-right: revert-layer !important; margin-bottom: revert-layer !important; margin-left: 1px !important;'],
    mixedKeywords: '',
  },
  invalid: {
    unchanged: Array(9).fill('margin: 2px !important;'),
    parsed: 'color: red; opacity: 0.5;',
  },
  'unchanged-assignment': 'margin: 1px 1px; color: red',
  mutation: {
    names: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'color'],
    before: ['margin: 2px 4px !important; color: red;', 'margin: 2px 4px !important; color: red;', 'important'],
    mixed: ['', '', 'margin-top: 2px !important; margin-right: 4px !important; margin-bottom: 2px !important; margin-left: 5px; color: red;'],
    removed: '',
    after: 'color: red;',
  },
  rule: {
    before: ['', '3px', 'important'],
    text: '.card { margin: 4px !important; color: red; }',
    after: '.card { color: red; }',
    same: true,
  },
  'removal-return': '4px',
  'deferred-longhands': ['', 'var(--space)', 'margin-top: var(--space); margin-right: var(--space); margin-bottom: var(--space); margin-left: var(--space);'],
  'pending-shorthand': {
    first: ['var(--first)', '', 'margin: var(--first) !important;'],
    second: ['var(--second)', '', 'important', 'margin: var(--second) !important;'],
    partial: ['', '4px', 'margin-top:  !important; margin-right:  !important; margin-bottom:  !important; margin-left: 4px !important;'],
    removed: 'margin-right:  !important; margin-bottom:  !important; margin-left: 4px !important;',
  },
  'pending-priority': {
    priority: ['var(--first)', 'margin: var(--first) !important;'],
    replaced: 'margin: var(--third);',
  },
  // Current Values 5 defers name validation until computation, including in shorthands.
  'pending-invalid-name': 'margin: var(ordinary-name);',
};
