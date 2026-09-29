import { describe, expect, it } from 'vitest';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/sandbox';

describe('HTML sandbox directives', () => {
  it('starts with every restriction for an empty or unrecognized token list', () => {
    const empty = SandboxingFlagSet.parse('');
    expect(empty.size).toBe(16);
    expect(SandboxingFlagSet.parse('unknown')).toEqual(empty);
    expect(empty.has('sandboxed-origin')).toBe(true);
    expect(empty.has('sandboxed-scripts')).toBe(true);
  });

  it('recognizes ASCII whitespace and case-insensitive keywords without relaxing other flags', () => {
    const flags = SandboxingFlagSet.parse('\tALLOW-SCRIPTS\nallow-same-origin\fALLOW-SCRIPTS\r');
    expect(flags.has('sandboxed-origin')).toBe(false);
    expect(flags.has('sandboxed-scripts')).toBe(false);
    expect(flags.has('sandboxed-automatic-features')).toBe(false);
    expect(flags.has('sandboxed-forms')).toBe(true);
    expect(SandboxingFlagSet.parse('allow-scripts\u00A0allow-same-origin')).toEqual(SandboxingFlagSet.parse(''));
  });

  it.each([
    ['allow-popups', 'sandboxed-auxiliary-navigation'],
    ['allow-forms', 'sandboxed-forms'],
    ['allow-pointer-lock', 'sandboxed-pointer-lock'],
    ['allow-popups-to-escape-sandbox', 'sandbox-propagates-to-auxiliary-browsing-contexts'],
    ['allow-modals', 'sandboxed-modals'],
    ['allow-orientation-lock', 'sandboxed-orientation-lock'],
    ['allow-presentation', 'sandboxed-presentation'],
    ['allow-downloads', 'sandboxed-downloads'],
  ] as const)('applies %s', (token, flag) => {
    expect(SandboxingFlagSet.parse(token).has(flag)).toBe(false);
  });

  it('distinguishes activation-limited navigation from unrestricted navigation', () => {
    const limited = SandboxingFlagSet.parse('allow-top-navigation-by-user-activation');
    expect(limited.has('sandboxed-top-level-navigation-with-user-activation')).toBe(false);
    expect(limited.has('sandboxed-top-level-navigation-without-user-activation')).toBe(true);
    expect(limited.has('sandboxed-custom-protocols-navigation')).toBe(true);
    const unrestricted = SandboxingFlagSet.parse('allow-top-navigation');
    expect(unrestricted.has('sandboxed-top-level-navigation-with-user-activation')).toBe(false);
    expect(unrestricted.has('sandboxed-top-level-navigation-without-user-activation')).toBe(false);
    expect(unrestricted.has('sandboxed-custom-protocols-navigation')).toBe(false);
  });

  it.each(['allow-top-navigation-to-custom-protocols', 'allow-popups'])(
    'permits custom protocols through %s without enabling all top-level navigation', (token) => {
      const flags = SandboxingFlagSet.parse(token);
      expect(flags.has('sandboxed-custom-protocols-navigation')).toBe(false);
      expect(flags.has('sandboxed-top-level-navigation-without-user-activation')).toBe(true);
    },
  );

  it('retains the unconditional flags even when every exception is supplied', () => {
    const flags = SandboxingFlagSet.parse([
      'allow-popups', 'allow-top-navigation', 'allow-same-origin', 'allow-forms', 'allow-pointer-lock',
      'allow-scripts', 'allow-popups-to-escape-sandbox', 'allow-modals', 'allow-orientation-lock',
      'allow-presentation', 'allow-downloads',
    ].join(' '));
    expect([...flags]).toEqual(['sandboxed-navigation', 'sandboxed-document-domain']);
  });
});
