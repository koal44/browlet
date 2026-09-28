import { describe, expect, it } from 'vitest';

import { encodeBasicCredentials, parseAuthenticationChallenges, selectBasicChallenge } from '../../src/http/authentication';

describe('HTTP authentication challenges (RFC 9110 §11)', () => {
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

describe('Basic challenge selection (RFC 7617 §2)', () => {
  it.each([
    ['Basic realm="WallyWorld"', { realm: 'WallyWorld', charset: null }],
    ['Basic realm=""', { realm: '', charset: null }],
    ['BASIC REALM=CaseSensitive, ChArSeT=uTf-8', { realm: 'CaseSensitive', charset: 'UTF-8' }],
    ['Basic realm="foo", charset="UTF-8"', { realm: 'foo', charset: 'UTF-8' }],
    ['Basic realm="foo", extension="unknown, value"', { realm: 'foo', charset: null }],
    ['Basic realm="foo", charset="ISO-8859-1"', { realm: 'foo', charset: null }],
    ['Basic realm="foo", charset=""', { realm: 'foo', charset: null }],
  ])('selects %s', (field, expected) => {
    expect(selectBasicChallenge(parseAuthenticationChallenges([field])!)).toEqual(expected);
  });

  it('skips unrelated schemes and preserves the first supported challenge in field order', () => {
    const challenges = parseAuthenticationChallenges([
      'Digest realm="digest", qop="auth,auth-int", Newauth realm="other"',
      'Basic realm="first", Basic realm="second", charset=UTF-8',
    ])!;
    expect(selectBasicChallenge(challenges)).toEqual({ realm: 'first', charset: null });
    expect(selectBasicChallenge(parseAuthenticationChallenges(['Bearer abc==, Digest realm="x"'])!)).toBeNull();
    expect(selectBasicChallenge([])).toBeNull();
  });

  it.each([
    'Basic', 'Basic charset=UTF-8', 'Basic abc==', 'Basic realm=',
    'Basic realm="a", REALM="b"', 'Basic realm="a", realm="a"',
    'Basic realm="a", charset=UTF-8, CHARSET=UTF-8',
    'Basic realm="a", extension=one, EXTENSION=two',
  ])('rejects invalid Basic challenge %s without hiding the next challenge', (field) => {
    expect(selectBasicChallenge(parseAuthenticationChallenges([field])!)).toBeNull();
    expect(selectBasicChallenge(parseAuthenticationChallenges([field, 'Basic realm="valid"'])!))
      .toEqual({ realm: 'valid', charset: null });
  });

  it('treats realm labels as opaque and does not apply charset advice to them', () => {
    expect(selectBasicChallenge(parseAuthenticationChallenges(['Basic realm="\xe9", charset=UTF-8'])!))
      .toEqual({ realm: '\xe9', charset: 'UTF-8' });
  });
});

describe('Basic credential encoding (RFC 7617 §§2–2.1)', () => {
  it('encodes the RFC ASCII and UTF-8 examples', () => {
    expect(encodeBasicCredentials('Aladdin', 'open sesame')).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
    expect(encodeBasicCredentials('test', '123\u00a3')).toBe('Basic dGVzdDoxMjPCow==');
  });

  it('uses UTF-8 for non-ASCII credentials', () => {
    expect(encodeBasicCredentials('\xe9', '\xe9')).toBe('Basic w6k6w6k=');
  });

  it('retains case, spaces, password colons, and empty credentials', () => {
    expect(encodeBasicCredentials('', '')).toBe('Basic Og==');
    expect(encodeBasicCredentials('u', 'a:b')).toBe('Basic dTphOmI=');
    expect(encodeBasicCredentials(' User ', ' Pass ')).toBe('Basic IFVzZXIgOiBQYXNzIA==');
  });

  it('preserves the character composition of both credentials', () => {
    expect(encodeBasicCredentials('e\u0301', 'e\u0301')).toBe('Basic ZcyBOmXMgQ==');
    expect(encodeBasicCredentials('\xe9', '\xe9')).toBe('Basic w6k6w6k=');
  });

  it.each([
    ['\u03a3\u03c2\u03c3', '\u00df'], ['\u7528\u6237', '\ud83d\udd10'],
    ['\u0645\u0633\u062a\u062e\u062f\u0645', '\u05e1\u05d5\u05d3'],
    ['User', '\u00a0\uff21'],
  ])('supports international credentials without case, width, or space mapping (%s)', (username, password) => {
    const expected = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
    expect(encodeBasicCredentials(username, password)).toBe(expected);
  });

  it('rejects a colon in the username', () => {
    expect(encodeBasicCredentials('user:name', 'password')).toBeNull();
  });

  it('rejects every ASCII control in either credential', () => {
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      const control = String.fromCharCode(code);
      expect(encodeBasicCredentials(`user${control}`, 'password'), `username control ${code}`).toBeNull();
      expect(encodeBasicCredentials('user', `password${control}`), `password control ${code}`).toBeNull();
    }
  });

  it.each(['\ud800', '\udfff', 'x\ud800y'])('rejects an unpaired surrogate without replacing credentials (%j)', (value) => {
    expect(encodeBasicCredentials(value, 'password')).toBeNull();
    expect(encodeBasicCredentials('user', value)).toBeNull();
  });
});
