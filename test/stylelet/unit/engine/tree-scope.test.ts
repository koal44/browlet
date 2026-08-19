import { describe, expect, it } from 'vitest';

import { Domlet } from '../../../../src/domlet/domlet';
import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import { CascadeEngine } from '../../../../src/stylelet/engine/cascade-engine';
import { TreeScope } from '../../../../src/stylelet/engine/tree-scope';
import { Snapshot } from '../../../../src/stylelet/snapshot';

describe('tree scope', () => {
  it('orders header stylesheets before tree-ordered stylesheets', () => {
    const { document, scope } = createTreeScope();
    const firstOwner = document.createElement('i');
    const secondOwner = document.createElement('i');
    document.appendChild(firstOwner);
    document.appendChild(secondOwner);
    const first = createStyleSheet(scope, { ownerNode: firstOwner });
    const second = createStyleSheet(scope, { ownerNode: secondOwner });
    const firstHeader = createStyleSheet(scope);
    const secondHeader = createStyleSheet(scope);

    scope.addTreeStyleSheet(second);
    scope.addHeaderStyleSheet(firstHeader);
    scope.addTreeStyleSheet(first);
    scope.addHeaderStyleSheet(secondHeader);

    expect([...scope.styleSheets]).toEqual([
      firstHeader,
      secondHeader,
      first,
      second,
    ]);

    scope.removeStyleSheet(firstHeader);
    const thirdHeader = createStyleSheet(scope);
    scope.addHeaderStyleSheet(thirdHeader);

    expect([...scope.styleSheets]).toEqual([
      secondHeader,
      thirdHeader,
      first,
      second,
    ]);
  });

  it('selects the first enabled non-alternate titled set', () => {
    const { scope } = createTreeScope();
    const disabledAlpha = createStyleSheet(scope, {
      disabled: true,
      title: 'alpha',
    });
    const alternateBeta = createStyleSheet(scope, {
      alternate: true,
      title: 'beta',
    });
    const preferredBeta = createStyleSheet(scope, { title: 'beta' });
    const alpha = createStyleSheet(scope, { title: 'alpha' });
    const caseVariant = createStyleSheet(scope, { title: 'Beta' });
    const persistent = createStyleSheet(scope);

    scope.addTreeStyleSheet(disabledAlpha);
    scope.addTreeStyleSheet(alternateBeta);
    expect(alternateBeta.disabled).toBe(true);

    scope.addTreeStyleSheet(preferredBeta);
    scope.addTreeStyleSheet(alpha);
    scope.addTreeStyleSheet(caseVariant);
    scope.addTreeStyleSheet(persistent);

    expect(disabledAlpha.disabled).toBe(true);
    expect(alternateBeta.disabled).toBe(false);
    expect(preferredBeta.disabled).toBe(false);
    expect(alpha.disabled).toBe(true);
    expect(caseVariant.disabled).toBe(true);
    expect(persistent.disabled).toBe(false);
  });

  it('distinguishes an explicit selection from the preferred set', () => {
    const { scope } = createTreeScope();
    const alpha = createStyleSheet(scope, { title: 'alpha' });
    const beta = createStyleSheet(scope, { title: 'beta' });
    const persistent = createStyleSheet(scope);
    scope.addTreeStyleSheet(alpha);
    scope.addTreeStyleSheet(beta);
    scope.addTreeStyleSheet(persistent);

    scope.__changePreferredStyleSheetSetName('beta');
    expect([alpha.disabled, beta.disabled, persistent.disabled])
      .toEqual([true, false, false]);

    scope.__selectStyleSheetSet('alpha');
    scope.__changePreferredStyleSheetSetName('beta');
    expect([alpha.disabled, beta.disabled, persistent.disabled])
      .toEqual([false, true, false]);

    scope.__selectStyleSheetSet('');
    scope.__changePreferredStyleSheetSetName('alpha');
    expect([alpha.disabled, beta.disabled, persistent.disabled])
      .toEqual([true, true, false]);
  });

  it('preserves the preferred set name when its last sheet is removed', () => {
    const { scope } = createTreeScope();
    const firstAlpha = createStyleSheet(scope, { title: 'alpha' });
    const firstBeta = createStyleSheet(scope, { title: 'beta' });
    scope.addTreeStyleSheet(firstAlpha);
    scope.addTreeStyleSheet(firstBeta);

    scope.removeStyleSheet(firstAlpha);

    const secondBeta = createStyleSheet(scope, { title: 'beta' });
    const secondAlpha = createStyleSheet(scope, { title: 'alpha' });
    scope.addTreeStyleSheet(secondBeta);
    scope.addTreeStyleSheet(secondAlpha);

    expect(firstBeta.disabled).toBe(true);
    expect(secondBeta.disabled).toBe(true);
    expect(secondAlpha.disabled).toBe(false);
  });
});

function createTreeScope(): {
  document: Document;
  scope: TreeScope;
} {
  const document = createDomletDocument('');
  const snapshot = new Snapshot(document);
  const cascade = new CascadeEngine({ snapshot });
  return { document, scope: new TreeScope(document, cascade) };
}

function createStyleSheet(
  scope: TreeScope,
  {
    alternate = false,
    disabled = false,
    ownerNode = null,
    title = '',
  }: StyleSheetOptions = {},
): CSSStyleSheetImpl {
  const styleSheet = CSSStyleSheetImpl.__create(
    scope.cascade.snapshot,
    {
      location: null,
      parentStyleSheet: null,
      ownerNode,
      ownerRule: null,
      media: '',
      title,
      alternate,
      originClean: true,
    },
  );
  styleSheet.disabled = disabled;
  return styleSheet;
}

type StyleSheetOptions = {
  alternate?: boolean;
  disabled?: boolean;
  ownerNode?: Element | null;
  title?: string;
};

function createDomletDocument(source: string): Document {
  return new Domlet().parse(source);
}
