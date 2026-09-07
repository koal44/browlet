import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

describe('Origin interface', () => {
  it('constructs unique opaque origins', () => {
    const browlet = new Browlet({ route: () => '' });
    const Origin = getOriginConstructor(browlet.window);
    const first = new Origin();
    const second = new Origin();

    expect(first).toBeInstanceOf(Origin);
    expect(first.opaque).toBe(true);
    expect(first.isSameOrigin(first)).toBe(true);
    expect(first.isSameOrigin(second)).toBe(false);
  });

  it('creates origins from strings and URL platform objects', () => {
    const browlet = new Browlet({ route: () => '' });
    const Origin = getOriginConstructor(browlet.window);
    const URL = Reflect.get(browlet.window, 'URL') as typeof globalThis.URL;
    const fromString = Origin.from('https://www.example.com/path');
    const fromURL = Origin.from(new URL('https://www.example.com/elsewhere'));
    const fromOrigin = Origin.from(fromString);
    const sameSite = Origin.from('https://shop.example.com/');

    expect(fromString.opaque).toBe(false);
    expect(fromString.isSameOrigin(fromURL)).toBe(true);
    expect(fromString.isSameOrigin(fromOrigin)).toBe(true);
    expect(fromString.isSameSite(sameSite)).toBe(true);
    expect(() => Origin.from({})).toThrow(TypeError);
  });

  it('projects origins returned by static operations into their realm', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const FirstOrigin = getOriginConstructor(first.window);
    const SecondOrigin = getOriginConstructor(second.window);

    const origin = SecondOrigin.from('https://www.example.com/');

    expect(origin).toBeInstanceOf(SecondOrigin);
    expect(origin).not.toBeInstanceOf(FirstOrigin);
  });
});

type OriginObject = {
  readonly opaque: boolean;
  isSameOrigin(other: OriginObject): boolean;
  isSameSite(other: OriginObject): boolean;
};

type OriginConstructor = {
  new(): OriginObject;
  from(value: unknown): OriginObject;
};

function getOriginConstructor(window: object): OriginConstructor {
  return Reflect.get(window, 'Origin') as OriginConstructor;
}
