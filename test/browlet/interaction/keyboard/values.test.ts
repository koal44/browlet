import { describe, expect, it } from 'vitest';

import {
  isKeyboardCode, isNamedKey, selectKey, type KeyboardKeyInput,
} from '../../../../src/browlet/interaction/keyboard/values';

describe('KeyboardEvent key Values: selection from native input', () => {
  it.each(['Backspace', 'Tab', 'Enter', 'Escape', 'Delete', 'Dead', 'HangulMode'] as const)(
    'prefers the appropriate named key %s over generated or glyph-only text', (namedKey) => {
      expect(selectKey({ namedKey, text: 'a', hasNonGlyphModifiers: true, glyphText: 'A' })).toBe(namedKey);
    },
  );

  it('prefers generated text even when non-glyph modifiers are held', () => {
    expect(selectKey({ namedKey: null, text: '@', hasNonGlyphModifiers: true, glyphText: 'q' })).toBe('@');
    expect(selectKey({ namedKey: null, text: 'q', hasNonGlyphModifiers: false, glyphText: 'Q' })).toBe('q');
  });

  it.each(['q', 'Q', '5', '%', '\u20ac'])(
    'uses the layout-provided glyph-only text %s when other modifiers prevent text generation', (glyphText) => {
      expect(selectKey({ namedKey: null, text: null, hasNonGlyphModifiers: true, glyphText })).toBe(glyphText);
    },
  );

  it('does not use the glyph-only fallback without a non-glyph modifier', () => {
    expect(selectKey({ namedKey: null, text: null, hasNonGlyphModifiers: false, glyphText: 'q' })).toBe('Unidentified');
  });

  it.each([false, true])('uses Unidentified when no name or usable text is available (modifiers=%s)', (hasNonGlyphModifiers) => {
    expect(selectKey({ namedKey: null, text: null, hasNonGlyphModifiers, glyphText: null })).toBe('Unidentified');
  });

  it.each([
    ['e\u0301', '\u00e9'],
    ['d\u0323\u0307', '\u1e0d\u0307'],
    ['\u1e0b\u0323', '\u1e0d\u0307'],
  ])('normalizes generated and glyph-only text %s to NFC', (text, expected) => {
    expect(selectKey({ namedKey: null, text, hasNonGlyphModifiers: false, glyphText: null })).toBe(expected);
    expect(selectKey({ namedKey: null, text: null, hasNonGlyphModifiers: true, glyphText: text })).toBe(expected);
  });

  it('preserves classified non-control whitespace, combining-only text, format characters, and supplementary text', () => {
    const texts = ['', ' ', '\u00a0', '\u2009', '\u3000', '\u0301', '\u200c', '\u{1f642}'];
    expect(texts.map((text) => selectKey({ namedKey: null, text, hasNonGlyphModifiers: false, glyphText: null })))
      .toEqual(texts);
    expect(selectKey({ namedKey: null, text: null, hasNonGlyphModifiers: true, glyphText: '' })).toBe('');
  });

  it('uses each notification\'s facts without caching the press or changing its input', () => {
    const input: KeyboardKeyInput = { namedKey: null, text: 'Q', hasNonGlyphModifiers: false, glyphText: null };
    const before = { ...input };
    expect(selectKey(input)).toBe('Q');
    expect(input).toEqual(before);
    input.text = 'q'; // Shift was released before the letter's keyup.
    expect(selectKey(input)).toBe('q');
    input.text = '5'; // The same physical key now has a different layout meaning.
    expect(selectKey(input)).toBe('5');
  });
});

describe('KeyboardEvent key/code vocabularies', () => {
  it('recognizes specified required and optional named keys across the table families', () => {
    const keys = ['Unidentified', 'AltGraph', 'FnLock', 'Hyper', 'Enter', 'ArrowLeft', 'EraseEof',
      'ContextMenu', 'Hibernate', 'Dead', 'HangulMode', 'ZenkakuHankaku', 'F12', 'Soft4', 'MediaPlayPause',
      'Key11', 'AudioVolumeUp', 'SpeechInputToggle', 'LaunchApplication1', 'BrowserBack', 'CameraFocus',
      'TVInputHDMI4', 'ColorF0Red', 'ZoomToggle'];
    for (const key of keys) {
      expect(isNamedKey(key), key).toBe(true);
      if (!isNamedKey(key)) throw new Error('Expected a specified named key');
      expect(selectKey({ namedKey: key, text: null, hasNonGlyphModifiers: false, glyphText: null })).toBe(key);
    }
  });

  it('accepts additional positive numbered function and soft keys without capping them at the explicit tables', () => {
    for (const key of ['F13', 'F24', 'F99', 'F12345678901234567890', 'Soft5', 'Soft8', 'Soft99']) {
      expect(isNamedKey(key), key).toBe(true);
    }
    for (const code of ['F13', 'F24', 'F99', 'F12345678901234567890']) {
      expect(isKeyboardCode(code), code).toBe(true);
    }
    expect(isKeyboardCode('Soft8')).toBe(false);
  });

  it('rejects malformed numbered names, case changes, and extra characters', () => {
    for (const value of ['F', 'F0', 'F01', 'F-1', 'F+1', 'F1.5', 'F1e2', 'f24', ' F24', 'F24 ', 'F24\n',
      'Soft', 'Soft0', 'Soft01', 'Soft-1', 'Soft1.5', 'soft8', 'Soft8\n']) {
      expect(isNamedKey(value), value).toBe(false);
      expect(isKeyboardCode(value), value).toBe(false);
    }
  });

  it('does not mistake text, physical codes, legacy aliases, or object member names for named keys', () => {
    for (const key of ['', 'q', 'Q', ' ', 'KeyQ', 'ShiftLeft', 'OS', 'Spacebar', 'Esc', 'Left',
      'VolumeUp', 'enter', 'Enter\n', 'toString', '__proto__']) {
      expect(isNamedKey(key), key).toBe(false);
    }
  });

  it('recognizes physical codes independently of key meaning and location', () => {
    for (const code of ['Backquote', 'KeyQ', 'Digit1', 'IntlRo', 'IntlYen', 'ShiftLeft', 'ShiftRight',
      'Space', 'Lang1', 'Lang5', 'Help', 'ArrowUp', 'Numpad1', 'NumpadEnter', 'NumpadMemorySubtract',
      'F12', 'FnLock', 'LaunchApp1', 'AudioVolumeUp', 'Turbo', 'Suspend', 'Props', 'Hiragana', 'Unidentified']) {
      expect(isKeyboardCode(code), code).toBe(true);
    }
    for (const code of ['', 'q', 'Q', '1', 'Shift', 'AltGraph', 'Dead', 'Soft1', 'LaunchApplication1',
      'VolumeUp', 'Spacebar', 'keyQ', 'KeyQ\n', 'toString', '__proto__']) {
      expect(isKeyboardCode(code), code).toBe(false);
    }
  });
});
