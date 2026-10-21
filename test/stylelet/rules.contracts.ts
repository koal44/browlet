/** Exercise rule operations through the same platform API in Browlet and native browsers. */
export function exerciseRules(kind: 'style' | 'mutation' | 'namespace' | 'detached' | 'namespace-error-order' | 'declaration-order' | 'important-order') {
  const sheet = new CSSStyleSheet();
  const run = {
    errorName(steps: () => unknown) {
      try { steps(); return null; }
      catch (error) { return (error as Error).name; }
    },
  };

  if (kind === 'declaration-order') {
    sheet.replaceSync('.a { color: red; opacity: .5; color: blue } .c { color: red; opacity: .5; color: red }');
    return [...sheet.cssRules].map((rule) => (rule as CSSStyleRule).style.cssText);
  }

  if (kind === 'important-order') {
    sheet.replaceSync('.a { color: red !important; opacity: .5; color: blue }');
    return (sheet.cssRules[0] as CSSStyleRule).style.cssText;
  }

  if (kind === 'detached') {
    sheet.replaceSync('.parent {}');
    const rule = sheet.cssRules[0] as CSSStyleRule;
    sheet.deleteRule(0);
    const error = run.errorName(() => rule.insertRule('.child {}'));
    return { error, selector: (rule.cssRules[0] as CSSStyleRule | undefined)?.selectorText ?? null };
  }

  if (kind === 'namespace-error-order') {
    sheet.replaceSync('.ordinary {}');
    return run.errorName(() => sheet.insertRule('@namespace x "urn:x";', 1));
  }

  if (kind === 'style') {
    sheet.replaceSync('.empty {} .one { color: red } .parent { color: blue; > .child { opacity: .2 } opacity: .7 }');
    const parent = sheet.cssRules[2] as CSSStyleRule;
    const child = parent.cssRules[0] as CSSStyleRule;
    const before = [...sheet.cssRules].map((rule) => rule.cssText);
    const style = parent.style;
    parent.selectorText = '#changed, .other';
    parent.selectorText = '.invalid,';
    parent.cssText = '.ignored {}';
    child.selectorText = '> span';
    return {
      before,
      selectors: [parent.selectorText, child.selectorText],
      identity: parent.style === style && parent.cssRules[0] === child,
      parents: child.parentRule === parent && child.parentStyleSheet === sheet,
      text: parent.cssText,
    };
  }

  if (kind === 'mutation') {
    sheet.replaceSync('.parent {}');
    const parent = sheet.cssRules[0] as CSSStyleRule;
    const list = parent.cssRules;
    const indices = [parent.insertRule('> .child { > span { color: red } }'), parent.insertRule('opacity: .5', 1)];
    const child = list[0] as CSSStyleRule;
    const grandchild = child.cssRules[0]!;
    const text = parent.cssText;
    const errors = [
      run.errorName(() => parent.insertRule('invalid', 99)),
      run.errorName(() => parent.insertRule('invalid', 0)),
      run.errorName(() => parent.deleteRule(99)),
      run.errorName(() => parent.insertRule('@namespace svg "urn:svg";', 0)),
      run.errorName(() => parent.insertRule('@import "x.css";', 0)),
    ];
    parent.deleteRule(0);
    const detached = [child.parentRule === null, child.parentStyleSheet === null, grandchild.parentRule === child, grandchild.parentStyleSheet === null];
    const removed = list[0]!;
    parent.deleteRule(0);
    return {
      indices, text, errors, detached,
      declarationDetached: removed.parentRule === null && removed.parentStyleSheet === null,
      live: parent.cssRules === list && list.length === 0 && list.item(0) === null && list[0] === undefined,
    };
  }

  sheet.replaceSync('@namespace svg "urn:svg"; svg|a { > svg|b {} }');
  const namespace = sheet.cssRules[0] as CSSNamespaceRule;
  const rule = sheet.cssRules[1] as CSSStyleRule;
  rule.selectorText = 'svg|c';
  rule.selectorText = 'missing|c';
  const errors = [
    run.errorName(() => sheet.insertRule('@namespace x "urn:x";', 0)),
    run.errorName(() => sheet.deleteRule(0)),
    run.errorName(() => sheet.insertRule('svg|d {}', 0)),
  ];
  const text = [...sheet.cssRules].map((item) => item.cssText);
  sheet.deleteRule(1);
  sheet.deleteRule(0);
  sheet.insertRule('@namespace x url("relative");');
  return {
    namespace: [namespace.namespaceURI, namespace.prefix, namespace.type, namespace.cssText],
    selectors: [rule.selectorText, (rule.cssRules[0] as CSSStyleRule).selectorText],
    errors, text,
    detached: namespace.parentStyleSheet === null,
    replaced: sheet.cssRules[0]!.cssText,
  };
}

export const ruleExpectations = {
  style: {
    before: ['.empty { }', '.one { color: red; }', '.parent {\n  color: blue;\n  & > .child { opacity: 0.2; }\n  opacity: 0.7;\n}'],
    selectors: ['#changed, .other', '& > span'], identity: true, parents: true,
    text: '#changed, .other {\n  color: blue;\n  & > span { opacity: 0.2; }\n  opacity: 0.7;\n}',
  },
  mutation: {
    indices: [0, 1],
    text: '.parent {\n  & > .child {\n  & > span { color: red; }\n}\n  opacity: 0.5;\n}',
    errors: ['IndexSizeError', 'SyntaxError', 'IndexSizeError', 'HierarchyRequestError', 'HierarchyRequestError'],
    detached: [true, true, true, true], declarationDetached: true, live: true,
  },
  namespace: {
    namespace: ['urn:svg', 'svg', 10, '@namespace svg url("urn:svg");'],
    selectors: ['svg|c', '& > svg|b'],
    errors: ['InvalidStateError', 'InvalidStateError', 'HierarchyRequestError'],
    text: ['@namespace svg url("urn:svg");', 'svg|c {\n  & > svg|b { }\n}'],
    detached: true, replaced: '@namespace x url("relative");',
  },
  detached: { error: null, selector: '& .child' },
  'namespace-error-order': 'HierarchyRequestError',
  'declaration-order': ['opacity: 0.5; color: blue;', 'opacity: 0.5; color: red;'],
  'important-order': 'color: red !important; opacity: 0.5;',
};
