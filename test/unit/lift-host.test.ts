import { type ComplexSelector, parseSelectorList } from '../../src/parser/parser';
import { expect, it, describe } from 'vitest';
import { describeComplex } from '../utils/util';
import { liftHostSelectorList } from '../../src/planner/lift-host';

function expanded(selector: string): string[] {
  const list = parseSelectorList(selector, {});
  return liftHostSelectorList(list).arms.map(describeComplex);
}

function unchanged(selector: string): void {
  expect(expanded(selector)).toEqual([selector]);
}

function expectExpandedWithParsedCosts(selector: string, expected: string[]): void {
  const arms = expandedArms(selector);

  expect(arms.map(describeComplex)).toEqual(expected);
  expect(arms.map((arm) => arm.cost)).toEqual(expected.map(costOfSingleArm));
}

function expandedArms(selector: string): ComplexSelector[] {
  const list = parseSelectorList(selector, {});
  return liftHostSelectorList(list).arms;
}

function costOfSingleArm(selector: string): number {
  const list = parseSelectorList(selector, {});
  expect(list.arms).toHaveLength(1);
  return list.arms[0].cost;
}

describe('planner :is/:where host expansion', () => {
  it('does not expand a selector with no :is/:where', () => {
    unchanged('section > article *');
  });

  it('does not expand ordinary :is() without host', () => {
    unchanged(':is(h1, h2) *');
  });

  it('does not expand ordinary :where() without host', () => {
    unchanged(':where(.a, .b) *');
  });

  it('does not expand direct host outside :is/:where', () => {
    unchanged(':host(.foo) *');
  });

  it('does not expand a selector-list arm merely because another arm has direct host', () => {
    expect(expanded('p, :host(.foo) *')).toEqual([
      'p',
      ':host(.foo) *',
    ]);
  });

  it('expands standalone :is() containing a host arm', () => {
    expect(expanded(':is(:host(.foo)) *')).toEqual([
      ':host(.foo) *',
    ]);
  });

  it('expands standalone :where() containing a host arm', () => {
    expect(expanded(':where(:host(.foo)) *')).toEqual([
      ':host(.foo) *',
    ]);
  });

  it('expands plain :host inside :is()', () => {
    expect(expanded(':is(:host) *')).toEqual([
      ':host *',
    ]);
  });

  it('preserves argument arm order when expanding :is() with host first', () => {
    expect(expanded(':is(:host(.foo), #article) *')).toEqual([
      ':host(.foo) *',
      '#article *',
    ]);
  });

  it('preserves argument arm order when expanding :is() with host second', () => {
    expect(expanded(':is(#article, :host(.foo)) *')).toEqual([
      '#article *',
      ':host(.foo) *',
    ]);
  });

  it('preserves argument arm order when expanding :where() with mixed arms', () => {
    expect(expanded(':where(#article, :host(.foo), #top) *')).toEqual([
      '#article *',
      ':host(.foo) *',
      '#top *',
    ]);
  });

  it('preserves non-expanded selector-list arms around an expanded host arm', () => {
    expect(expanded('p, :is(:host(.foo), #article) *, [data-x]')).toEqual([
      'p',
      ':host(.foo) *',
      '#article *',
      '[data-x]',
    ]);
  });

  it('expands non-subject :is() containing host', () => {
    expect(expanded('* :is(:host(.foo), #article) *')).toEqual([
      '* :host(.foo) *',
      '* #article *',
    ]);
  });

  it('expands non-subject :where() containing host', () => {
    expect(expanded('* :where(:host(.foo), #article) *')).toEqual([
      '* :host(.foo) *',
      '* #article *',
    ]);
  });

  it('preserves the prefix before a non-subject expanded :is()', () => {
    expect(expanded('section > :is(:host(.foo), #article) *')).toEqual([
      'section > :host(.foo) *',
      'section > #article *',
    ]);
  });

  it('preserves the suffix after an expanded :is()', () => {
    expect(expanded(':is(:host(.foo), #article) > .leaf')).toEqual([
      ':host(.foo) > .leaf',
      '#article > .leaf',
    ]);
  });

  it('preserves adjacent combinator suffix after an expanded :is()', () => {
    expect(expanded(':is(:host(.foo), #article) + .leaf')).toEqual([
      ':host(.foo) + .leaf',
      '#article + .leaf',
    ]);
  });

  it('preserves sibling combinator suffix after an expanded :is()', () => {
    expect(expanded(':is(:host(.foo), #article) ~ .leaf')).toEqual([
      ':host(.foo) ~ .leaf',
      '#article ~ .leaf',
    ]);
  });

  it('expands host inside nested :is()', () => {
    expect(expanded(':is(:is(:host(.foo))) *')).toEqual([
      ':host(.foo) *',
    ]);
  });

  it('expands host inside nested :where()', () => {
    expect(expanded(':where(:where(:host(.foo))) *')).toEqual([
      ':host(.foo) *',
    ]);
  });

  it('expands host through mixed nested :is/:where', () => {
    expect(expanded(':is(:where(:host(.foo))) *')).toEqual([
      ':host(.foo) *',
    ]);
  });

  it('preserves nested non-host alternatives while expanding host alternatives', () => {
    expect(expanded(':is(:where(:host(.foo), #article), #top) *')).toEqual([
      ':host(.foo) *',
      '#article *',
      '#top *',
    ]);
  });

  it('expands multiple host-containing :is() tests one pass at a time', () => {
    expect(expanded(':is(:host(.foo), #article) :is(:host(.bar), #inside)')).toEqual([
      ':host(.foo) :host(.bar)',
      ':host(.foo) #inside',
      '#article :host(.bar)',
      '#article #inside',
    ]);
  });

  it('expands complex argument arm with host boundary subject', () => {
    expect(expanded(':is(:host(.foo) > #article) #inside')).toEqual([
      ':host(.foo) > #article #inside',
    ]);
  });

  it('expands complex argument arms and preserves argument order', () => {
    expect(expanded(':is(:host(.foo) > #article, #top) *')).toEqual([
      ':host(.foo) > #article *',
      '#top *',
    ]);
  });

  it('expands complex host argument arm inside a prefixed selector', () => {
    expect(expanded('section :is(:host(.foo) > #article, #top) *')).toEqual([
      'section :host(.foo) > #article *',
      'section #top *',
    ]);
  });

  it('expands complex host argument arm before a child-combinator suffix', () => {
    expect(expanded(':is(:host(.foo) > #article, #top) > .leaf')).toEqual([
      ':host(.foo) > #article > .leaf',
      '#top > .leaf',
    ]);
  });

  it('expands host buried in a later complex argument subject', () => {
    expect(expanded(':is(.a > :host(.foo), #article) *')).toEqual([
      '.a > :host(.foo) *',
      '#article *',
    ]);
  });

  it('does not treat a host-containing :is() as a single host relation when another arm is normal', () => {
    expect(expanded('* :is(:host(.foo), #article) *')).toEqual([
      '* :host(.foo) *',
      '* #article *',
    ]);
  });

  it('preserves direct mixed host compounds for the chain layer to poison', () => {
    expect(expanded(':is(:host(.foo).bar, #article) *')).toEqual([
      '.bar:host(.foo) *',
      '#article *',
    ]);
  });

  it('merges surrounding class context into expanded simple arms', () => {
    expect(expanded('.box:is(:host(.foo), #article) *')).toEqual([
      '.box:host(.foo) *',
      '#article.box *',
    ]);
  });

  it('merges surrounding attribute tests into expanded simple arms', () => {
    expect(expanded('[data-x]:is(:host(.foo), #article) *')).toEqual([
      ':host(.foo)[data-x] *',
      '#article[data-x] *',
    ]);
  });

  it('merges surrounding tag context into expanded simple arms', () => {
    expect(expanded('div:is(:host(.foo), article) *')).toEqual([
      'div:host(.foo) *',
      '#__never__:xfalse *',
    ]);
  });

  it('turns incompatible tag intersections into never arms when expanding', () => {
    expect(expanded('div:is(:host(.foo), span) *')).toEqual([
      'div:host(.foo) *',
      '#__never__:xfalse *',
    ]);
  });

  it('does not expand :not() merely because it contains host', () => {
    unchanged(':not(:host(.foo)) *');
  });

  it('does not expand :has() merely because it contains host', () => {
    unchanged(':has(:host(.foo))');
  });

  it('does not expand :host() arguments merely because they contain :is()', () => {
    unchanged(':host(:is(.foo, .bar)) *');
  });

  it('does not mutate the original parsed selector while expanding host-containing :is()', () => {
    const list = parseSelectorList(':is(:host(.foo), #article) *', {});
    const before = describeComplex(list.arms[0]);

    const lifted = liftHostSelectorList(list);

    expect(lifted).not.toBe(list);
    expect(lifted.arms).not.toBe(list.arms);

    expect(lifted.arms.map(describeComplex)).toEqual([
      ':host(.foo) *',
      '#article *',
    ]);

    expect(describeComplex(list.arms[0])).toBe(before);
  });

  it('preserves selector-list arm order with multiple expanded arms', () => {
    expect(expanded('p, :is(:host(.foo), #article) *, :where(:host(.bar), #top) *')).toEqual([
      'p',
      ':host(.foo) *',
      '#article *',
      ':host(.bar) *',
      '#top *',
    ]);
  });

  it('merges outer compound classes onto the subject of a complex argument arm', () => {
    expect(expanded('.bar:is(:host(.foo) > #article) *')).toEqual([
      ':host(.foo) > #article.bar *',
    ]);
  });

  it('merges outer compound classes onto each expanded argument subject', () => {
    expect(expanded('.bar:is(:host(.foo) > #article, #top) *')).toEqual([
      ':host(.foo) > #article.bar *',
      '#top.bar *',
    ]);
  });

  it('merges outer attribute tests onto the subject of a complex argument arm', () => {
    expect(expanded('[data-x]:is(:host(.foo) > #article) *')).toEqual([
      ':host(.foo) > #article[data-x] *',
    ]);
  });

  it('updates lifted arm costs after expanding simple host-containing :is() arms', () => {
    expectExpandedWithParsedCosts(':is(:host(.foo), #article) *', [
      ':host(.foo) *',
      '#article *',
    ]);
  });

  it('updates lifted arm costs after expanding host-containing :where() arms', () => {
    expectExpandedWithParsedCosts(':where(:host(.foo), #article, #top) > .leaf', [
      ':host(.foo) > .leaf',
      '#article > .leaf',
      '#top > .leaf',
    ]);
  });

  it('updates lifted arm costs after merging outer class context onto expanded subjects', () => {
    expectExpandedWithParsedCosts('.bar:is(:host(.foo) > #article, #top) *', [
      ':host(.foo) > #article.bar *',
      '#top.bar *',
    ]);
  });

  it('updates lifted arm costs after merging outer attribute context onto a complex argument subject', () => {
    expectExpandedWithParsedCosts('[data-x]:is(:host(.foo) > #article) *', [
      ':host(.foo) > #article[data-x] *',
    ]);
  });

  it('updates lifted arm costs after fixed-point nested host expansion', () => {
    expectExpandedWithParsedCosts(':is(:where(:host(.foo), #article), #top) *', [
      ':host(.foo) *',
      '#article *',
      '#top *',
    ]);
  });

  it('does not mutate the original parsed selector while updating expanded arm costs', () => {
    const list = parseSelectorList('.bar:is(:host(.foo) > #article, #top) *', {});
    const before = describeComplex(list.arms[0]);
    const originalCost = list.arms[0].cost;

    const lifted = liftHostSelectorList(list);
    const arms = lifted.arms;

    expect(lifted).not.toBe(list);
    expect(arms).not.toBe(list.arms);

    expect(arms.map(describeComplex)).toEqual([
      ':host(.foo) > #article.bar *',
      '#top.bar *',
    ]);

    expect(arms.map((arm) => arm.cost)).toEqual([
      costOfSingleArm(':host(.foo) > #article.bar *'),
      costOfSingleArm('#top.bar *'),
    ]);

    expect(lifted.cost).toBe(arms[0].cost + arms[1].cost);

    expect(describeComplex(list.arms[0])).toBe(before);
    expect(list.arms[0].cost).toBe(originalCost);
  });
});

