import { describe, expect, it } from 'vitest';
import { parseAuthenticationChallenges } from '../../src/http/authentication';

describe('HTTP authentication challenges (RFC 9110 §11)', () => {
  it('parses the RFC example without splitting a quoted comma or escaped quote', () => {
    expect(parseAuthenticationChallenges([
      'Basic realm="simple", Newauth realm="apps", type=1, title="Login, to \\"apps\\""',
    ])).toEqual([
      { scheme: 'basic', token68: null, parameters: [['realm', 'simple']] },
      {
        scheme: 'newauth', token68: null, parameters: [
          ['realm', 'apps'], ['type', '1'], ['title', 'Login, to "apps"'],
        ],
      },
    ]);
  });

  it('combines repeated fields in order, including a continued parameter list', () => {
    expect(parseAuthenticationChallenges([
      'Unknown abc/+=, BASIC ReAlM="First"',
      'CHARSET = "uTf-8", Basic realm=Second',
    ])).toEqual([
      { scheme: 'unknown', token68: 'abc/+=', parameters: [] },
      { scheme: 'basic', token68: null, parameters: [['realm', 'First'], ['charset', 'uTf-8']] },
      { scheme: 'basic', token68: null, parameters: [['realm', 'Second']] },
    ]);
  });

  it.each(['abc', 'abc=', 'abc===', 'AZaz09-._~+/'])('preserves token68 %s', (token68) => {
    expect(parseAuthenticationChallenges([`Newauth ${token68}, Other`])).toEqual([
      { scheme: 'newauth', token68, parameters: [] },
      { scheme: 'other', token68: null, parameters: [] },
    ]);
  });

  it('distinguishes padding from an auth parameter and accepts unknown schemes', () => {
    expect(parseAuthenticationChallenges(['Newauth realm=, Other realm=value, Basic realm="b"'])).toEqual([
      { scheme: 'newauth', token68: 'realm=', parameters: [] },
      { scheme: 'other', token68: null, parameters: [['realm', 'value']] },
      { scheme: 'basic', token68: null, parameters: [['realm', 'b']] },
    ]);
  });

  it('ignores empty list members and OWS, including within a parameter list', () => {
    expect(parseAuthenticationChallenges([' ,\tBasic \t, realm="",, x = one, , Other \t, '])).toEqual([
      { scheme: 'basic', token68: null, parameters: [['realm', ''], ['x', 'one']] },
      { scheme: 'other', token68: null, parameters: [] },
    ]);
    expect(parseAuthenticationChallenges([])).toEqual([]);
    expect(parseAuthenticationChallenges(['', ',\t, '])).toEqual([]);
    expect(parseAuthenticationChallenges(['Basic \t'])).toEqual([
      { scheme: 'basic', token68: null, parameters: [] },
    ]);
  });

  it('does not interpret parameter names as authentication schemes', () => {
    expect(parseAuthenticationChallenges(['Newauth basic=foo, realm="private", Basic realm="public"']))
      .toEqual([
        { scheme: 'newauth', token68: null, parameters: [['basic', 'foo'], ['realm', 'private']] },
        { scheme: 'basic', token68: null, parameters: [['realm', 'public']] },
      ]);
  });

  it('retains repeated parameters for scheme validation instead of choosing a value', () => {
    expect(parseAuthenticationChallenges(['Basic realm="a", REALM="b"'])?.[0]?.parameters)
      .toEqual([['realm', 'a'], ['realm', 'b']]);
  });

  it('retains quoted byte values and removes only quoted-pair escapes', () => {
    expect(parseAuthenticationChallenges(['Basic realm="\t\x80\xff"'])?.[0]?.parameters)
      .toEqual([['realm', '\t\x80\xff']]);
    expect(parseAuthenticationChallenges([String.raw`Basic realm="a\\b\"c"`])?.[0]?.parameters)
      .toEqual([['realm', 'a\\b"c']]);
  });

  it.each([
    'Basic realm="unterminated', 'Basic realm="trailing\\', 'Basic realm="bad\rvalue"',
    'Basic realm="bad\nvalue"', 'Basic realm="bad\0value"', 'Basic realm="bad\x7fvalue"',
    'Basic realm="\u0100"', 'Basic realm="\\\r"', 'Basic realm="\\\x7f"',
    'Basic realm="x"garbage', 'Basic realm="x" Basic realm="y"', 'Basic realm=@',
    'Basic realm=, charset=', 'Basic realm="x"; charset="UTF-8"',
    'Basic\trealm="x"', 'Basic \trealm="x"', 'Basic \t abc==',
    'Basic\r\n realm="x"', 'Básic realm="x"', 'Basic abc=def=',
    'Negotiate abc==, realm="x"', 'Basic, realm="x"',
  ])('rejects malformed syntax %j', (field) => {
    expect(parseAuthenticationChallenges([field])).toBeNull();
  });
});
