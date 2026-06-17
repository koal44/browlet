import { parseSelectorList } from '../../src/parser/parser';
import { expect, it, describe } from 'vitest';
import { describeComplex } from '../utils/util';
import { expandSelectorListForSeeding } from '../../src/planner/lift-seed';

function expanded(selector: string): string[] {
  const list = parseSelectorList(selector, {});
  return expandSelectorListForSeeding(list).map(describeComplex);
}

function unchanged(selector: string): void {
  expect(expanded(selector)).toEqual([selector]);
}

describe('planner :is/:where expansion', () => {
  it('describes attribute tests from debug metadata', () => {
    const list = parseSelectorList('[lang="tr"]', {});
    expect(describeComplex(list.arms[0])).toBe('[lang="tr"]');
  });

  it('describes is/where tests from debug metadata', () => {
    const list = parseSelectorList(':is(h1, h2)', {});
    expect(describeComplex(list.arms[0])).toBe(':is(h1, h2)');
  });

  it('expands seedless subject :is() into tag arms', () => {
    expect(expanded(':is(h1, h2, h3)')).toEqual(['h1', 'h2', 'h3']);
  });

  it('expands seedless subject :where() into tag arms', () => {
    expect(expanded(':where(h1, h2)')).toEqual(['h1', 'h2']);
  });

  it('expands seedless subject :is() into class arms', () => {
    expect(expanded(':is(.a, .b)')).toEqual(['.a', '.b']);
  });

  it('expands seedless subject :is() into id arms', () => {
    expect(expanded(':is(#a, #b)')).toEqual(['#a', '#b']);
  });

  it('expands a seedless subject attribute compound when all argument arms are seedable', () => {
    expect(expanded('[data-x]:is(#a, .b, h1)')).toEqual([
      '#a[data-x]',
      '.b[data-x]',
      'h1[data-x]',
    ]);
  });

  it('merges host subject tests into expanded subject compounds', () => {
    expect(expanded('[lang="tr"]:is(h1, h2)')).toEqual([
      'h1[lang="tr"]',
      'h2[lang="tr"]',
    ]);
  });

  it('preserves multiple host subject tests when expanding', () => {
    expect(expanded('[lang="tr"][data-x]:is(h1, h2)')).toEqual([
      'h1[lang="tr"][data-x]',
      'h2[lang="tr"][data-x]',
    ]);
  });

  it('preserves host subject classes when expanding from no seed to id seed', () => {
    expect(expanded('.foo:is(#a, #b)')).toEqual([
      '#a.foo',
      '#b.foo',
    ]);
  });

  it('preserves host subject tag when upgrading tag seed to class seed', () => {
    expect(expanded('div:is(.head, .subtoc)')).toEqual([
      'div.head',
      'div.subtoc',
    ]);
  });

  it('preserves host subject tag when upgrading tag seed to id seed', () => {
    expect(expanded('div:is(#a, #b)')).toEqual([
      'div#a',
      'div#b',
    ]);
  });

  it('expands tag seed to mixed id/class argument arms because every arm improves tag rank', () => {
    expect(expanded('div:is(#a, .b)')).toEqual([
      'div#a',
      'div.b',
    ]);
  });

  it('does not expand class seed to mixed id/class argument arms because not every arm improves class rank', () => {
    unchanged('.foo:is(#a, .b)');
  });

  it('does not expand tag seed to mixed id/tag argument arms because not every arm improves tag rank', () => {
    unchanged('div:is(#a, h1)');
  });

  it('does not expand id seed because no argument seed rank can improve id rank', () => {
    unchanged('#root:is(.a, h1, #x)');
  });

  it('does not expand when any argument arm is unseedable', () => {
    unchanged(':is(h1, [data-x])');
  });

  it('does not expand when all argument arms are unseedable', () => {
    unchanged(':is([data-x], [data-y])');
  });

  it('does not expand :where() when any argument arm is unseedable', () => {
    unchanged(':where(.a, [data-x])');
  });

  it('does not expand nested :is() when the argument subject seed is still hidden', () => {
    unchanged(':is(:is(h1, h2), h3)');
  });

  it('only considers the subject compound for expansion', () => {
    unchanged('section:is(h1, h2) > [data-x]');
  });

  it('does not expand a non-subject :is() even if the subject compound is seedless', () => {
    unchanged('section > :is(h1, h2) + [data-x]');
  });

  it('does not expand a non-subject :where() even if the subject compound is seedless', () => {
    unchanged('section > :where(h1, h2) + [data-x]');
  });

  it('preserves the host arm prefix when expanding the subject compound', () => {
    expect(expanded('main section [lang="tr"]:is(h1, h2)')).toEqual([
      'main section h1[lang="tr"]',
      'main section h2[lang="tr"]',
    ]);
  });

  it('lifts argument subject seeds while preserving host child combinator', () => {
    expect(expanded('section > [lang="tr"]:is(.a > h1, .b > h2)')).toEqual([
      'section > h1[lang="tr"]:xis(.a > *)',
      'section > h2[lang="tr"]:xis(.b > *)',
    ]);
  });

  it('lifts argument subject seeds while preserving host adjacent combinator', () => {
    expect(expanded('section + [lang="tr"]:is(.a > h1, .b > h2)')).toEqual([
      'section + h1[lang="tr"]:xis(.a > *)',
      'section + h2[lang="tr"]:xis(.b > *)',
    ]);
  });

  it('lifts argument subject seeds while preserving host sibling combinator', () => {
    expect(expanded('section ~ [lang="tr"]:is(.a > h1, .b > h2)')).toEqual([
      'section ~ h1[lang="tr"]:xis(.a > *)',
      'section ~ h2[lang="tr"]:xis(.b > *)',
    ]);
  });

  it('lifts subject seeds from complex descendant argument arms', () => {
    expect(expanded('section > [lang="tr"]:is(.a h1, .b h2)')).toEqual([
      'section > h1[lang="tr"]:xis(.a *)',
      'section > h2[lang="tr"]:xis(.b *)',
    ]);
  });

  it('lifts subject seeds from child-combinator argument arms', () => {
    expect(expanded('section > [lang="tr"]:is(.a > h1, .b > h2)')).toEqual([
      'section > h1[lang="tr"]:xis(.a > *)',
      'section > h2[lang="tr"]:xis(.b > *)',
    ]);
  });

  it('lifts subject seeds from adjacent and sibling argument arms', () => {
    expect(expanded('section > [data-x]:is(.a + h1, .b ~ h2)')).toEqual([
      'section > h1[data-x]:xis(.a + *)',
      'section > h2[data-x]:xis(.b ~ *)',
    ]);
  });

  it('expands complex argument arms when every argument subject is seedable', () => {
    expect(expanded('[data-x]:is(.a > h1, .b > .c, #root h2)')).toEqual([
      'h1[data-x]:xis(.a > *)',
      '.c[data-x]:xis(.b > *)',
      'h2[data-x]:xis(#root *)',
    ]);
  });

  it('does not expand complex argument arms if any argument subject is unseedable', () => {
    unchanged('[data-x]:is(.a > h1, .b > [data-y])');
  });

  it('does not partially expand when one argument arm is unseedable', () => {
    unchanged(':is(h1, [data-x], h2)');
  });

  it('expands only the selected improving :is/:where test and preserves other pseudo tests', () => {
    expect(expanded(':is([data-x], [data-y]):is(h1, h2)')).toEqual([
      'h1:is([data-x], [data-y])',
      'h2:is([data-x], [data-y])',
    ]);
  });

  it('skips a non-improving :is/:where and expands a later improving one', () => {
    expect(expanded('[data-z]:is([data-x], [data-y]):where(.a, .b)')).toEqual([
      '.a[data-z]:is([data-x], [data-y])',
      '.b[data-z]:is([data-x], [data-y])',
    ]);
  });

  it('does not expand when argument seed rank equals host tag rank', () => {
    unchanged('div:is(h1, h2)');
  });

  it('does not expand when argument seed rank is below host class rank', () => {
    unchanged('.foo:is(h1, h2)');
  });

  it('does not expand when weakest argument seed rank equals host class rank', () => {
    unchanged('.foo:is(#a, .b)');
  });

  it('expands when weakest argument seed rank strictly improves host class rank', () => {
    expect(expanded('.foo:is(#a, #b)')).toEqual([
      '#a.foo',
      '#b.foo',
    ]);
  });

  it('preserves selector-list arm order during expansion', () => {
    expect(expanded(':is(h3, h1, h2)')).toEqual([
      'h3',
      'h1',
      'h2',
    ]);
  });

  it('preserves non-expanded selector-list arms while expanding eligible arms', () => {
    expect(expanded('p, :is(h1, h2), [data-x]')).toEqual([
      'p',
      'h1',
      'h2',
      '[data-x]',
    ]);
  });

  it('does not mutate the original parsed selector while deriving seed-lifted arms', () => {
    const list = parseSelectorList(':is(h1, h2)', {});
    const before = describeComplex(list.arms[0]);

    const out = expandSelectorListForSeeding(list).map(describeComplex);

    expect(out).toEqual(['h1', 'h2']);
    expect(describeComplex(list.arms[0])).toBe(before);
  });

  it('preserves :where() as a remaining test when expanding a later :is()', () => {
    expect(expanded(':where([data-x], [data-y]):is(h1, h2)')).toEqual([
      'h1:where([data-x], [data-y])',
      'h2:where([data-x], [data-y])',
    ]);
  });

  it('preserves :is() as a remaining test when expanding a later :where()', () => {
    expect(expanded(':is([data-x], [data-y]):where(h1, h2)')).toEqual([
      'h1:is([data-x], [data-y])',
      'h2:is([data-x], [data-y])',
    ]);
  });

  it('keeps impossible same-rank tag intersections unexpanded under rank rules', () => {
    unchanged('h1:is(h2, h3)');
  });

  it('keeps impossible same-rank id intersections unexpanded under rank rules', () => {
    unchanged('#a:is(#b, #c)');
  });

  it('expands an attribute-only subject compound into complex id arms', () => {
    expect(expanded('[data-x]:is(.a #one, .b #two)')).toEqual([
      '#one[data-x]:xis(.a *)',
      '#two[data-x]:xis(.b *)',
    ]);
  });

  it('expands an attribute-only subject compound into complex class arms', () => {
    expect(expanded('[data-x]:is(.a .one, .b .two)')).toEqual([
      '.one[data-x]:xis(.a *)',
      '.two[data-x]:xis(.b *)',
    ]);
  });

  it('does not expand if one complex argument arm has an attribute-only subject', () => {
    unchanged('[data-x]:is(.a .one, .b [data-y])');
  });

  it('lifts the full subject seed bundle from complex argument arms', () => {
    expect(expanded('[data-x]:is(.a > h1.foo, .b > h2.bar)')).toEqual([
      'h1.foo[data-x]:xis(.a > *)',
      'h2.bar[data-x]:xis(.b > *)',
    ]);
  });

  it('preserves non-seed residual tests after lifting an argument subject seed', () => {
    expect(expanded('[data-x]:is(.a > h1[role="x"], .b > h2[role="y"])')).toEqual([
      'h1[data-x]:xis(.a > [role="x"])',
      'h2[data-x]:xis(.b > [role="y"])',
    ]);
  });

  it('merges lifted classes with existing host subject tag when rank improves', () => {
    expect(expanded('div[data-x]:is(.a > div.foo, .b > div.bar)')).toEqual([
      'div.foo[data-x]:xis(.a > *)',
      'div.bar[data-x]:xis(.b > *)',
    ]);
  });

  // it('does not expand when lifted tag conflicts with existing host subject tag', () => {
  //   unchanged('div:is(span.foo, span.bar)');
  // });

  it('rebuilds :where() residuals when lifting complex argument seeds', () => {
    expect(expanded('[data-x]:where(.a > h1, .b > h2)')).toEqual([
      'h1[data-x]:xwhere(.a > *)',
      'h2[data-x]:xwhere(.b > *)',
    ]);
  });

  it('lifts all subject classes from complex argument arms', () => {
    expect(expanded('[data-x]:is(.a > .foo.bar, .b > .baz.qux)')).toEqual([
      '.foo.bar[data-x]:xis(.a > *)',
      '.baz.qux[data-x]:xis(.b > *)',
    ]);
  });

  it('updates lifted arm costs after moving argument subject seeds onto the host subject', () => {
    const list = parseSelectorList('[data-x]:is(.a > h1.foo:hover, .b > h2.bar)', {});
    const original = list.arms[0];

    const expanded = expandSelectorListForSeeding(list);

    expect(expanded.map(describeComplex)).toEqual([
      'h1.foo[data-x]:xis(.a > :hover)',
      'h2.bar[data-x]:xis(.b > *)',
    ]);

    expect(expanded).toHaveLength(2);

    expect(original.cost).toBe(32);
    expect(expanded[0].cost).toBe(19);
    expect(expanded[1].cost).toBe(16);
  });

  it('turns statically incompatible lifted tags into always-false lifted arms', () => {
    expect(expanded('div:is(span.foo, span.bar)')).toEqual([
      '#__never__:xfalse',
      '#__never__:xfalse',
    ]);
  });

  it('returns a seedable always-false arm for incompatible lifted tags', () => {
    const list = parseSelectorList('div:is(span.foo)', {});
    const expanded = expandSelectorListForSeeding(list);

    expect(expanded).toHaveLength(1);

    const subject = expanded[0].parts.at(-1)!.compound;

    expect(subject.id?.raw).toBe('__never__');
    expect(subject.tests.some(
      (test) => test.debug?.kind === 'pseudo' && test.debug.name === 'xfalse',
    )).toBe(true);
  });

});
