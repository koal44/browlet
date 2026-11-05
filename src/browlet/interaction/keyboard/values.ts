/** Select a produced key value from adapter-classified input; constructor strings bypass this algorithm. */
// https://w3c.github.io/uievents-key/#selecting-key-attribute-values
// The explicit record supplies the native event facts that the specification leaves implicit.
export function selectKey(input: KeyboardKeyInput): string {
  if (input.namedKey !== null) return input.namedKey;
  if (input.text !== null) return input.text.normalize('NFC');
  if (input.hasNonGlyphModifiers && input.glyphText !== null) {
    return input.glyphText.normalize('NFC');
  }
  return 'Unidentified';
}

/** Recognize a specified named key, including additional numbered function and soft keys. */
// https://w3c.github.io/uievents-key/#named-key-attribute-values
export function isNamedKey(key: string): key is NamedKey {
  return namedKeys.has(key) || numberedNamedKey.test(key);
}

/** Recognize a specified physical-key code; this does not infer a code from key text or location. */
// https://w3c.github.io/uievents-code/#code-value-tables
export function isKeyboardCode(code: string): code is KeyboardCode {
  return keyboardCodes.has(code) || numberedFunctionCode.test(code);
}

/** Native-layout facts for one notification, recomputed for releases as well as presses. */
export interface KeyboardKeyInput {
  /** Appropriate specified key name, or null when the key has no named meaning. */
  namedKey: NamedKey | null;
  /** Generated key-string text before NFC normalization, or null when none was generated. */
  text: string | null;
  /** Whether any active modifier is outside Shift, CapsLock, and AltGraph. */
  hasNonGlyphModifiers: boolean;
  /** Key-string text with only glyph modifiers applied, or null when unavailable. */
  glyphText: string | null;
}

// TODO(native/automation keyboard adapter, UIEvents-Key §2.1): classify generated text
// before supplying text/glyphText. A key string has zero or one non-control base
// character followed by combining characters (Mc or nonzero canonical combining class).
// Supply null for a control character or unavailable text; selectKey supplies NFC.
// Real layout overrides and the glyph-only translation require native input facts,
// not ASCII arithmetic, key caps, or reversing a KeyboardEvent.code.
// Dead-key/IME interpretation supplies named values such as Dead/Process as appropriate;
// it does not synthesize composition state or document edits here.

export type NamedKey = typeof namedKeyValues[number] | `F${bigint}` | `Soft${bigint}`;
export type KeyboardCode = typeof keyboardCodeValues[number] | `F${bigint}`;

// The numbered families extend their explicit tables with positive base-10 indices.
// https://w3c.github.io/uievents-key/#keys-function
// https://w3c.github.io/uievents-code/#key-function-section
const numberedNamedKey = /^(?:F|Soft)[1-9][0-9]*$/;
const numberedFunctionCode = /^F[1-9][0-9]*$/;

// https://w3c.github.io/uievents-key/#named-key-attribute-values
// Required and optional names, in specification table order; repeated entries appear once.
// Source: w3c/uievents-key 140cae88d6039b3fb1a51787978678115111c433.
const namedKeyValues = [
  // general
  'Unidentified',
  // modifier
  'Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'FnLock', 'Meta', 'NumLock', 'ScrollLock', 'Shift', 'Symbol',
  'SymbolLock',
  // modifier legacy
  'Hyper', 'Super',
  // whitespace
  'Enter', 'Tab',
  // navigation
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp',
  // editing
  'Backspace', 'Clear', 'Copy', 'CrSel', 'Cut', 'Delete', 'EraseEof', 'ExSel', 'Insert', 'Paste', 'Redo', 'Undo',
  // ui
  'Accept', 'Again', 'Attn', 'Cancel', 'ContextMenu', 'Escape', 'Execute', 'Find', 'Help', 'Pause', 'Play', 'Props',
  'Select', 'ZoomIn', 'ZoomOut',
  // device
  'BrightnessDown', 'BrightnessUp', 'Eject', 'LogOff', 'Power', 'PowerOff', 'PrintScreen', 'Hibernate', 'Standby',
  'WakeUp',
  // composition
  'AllCandidates', 'Alphanumeric', 'CodeInput', 'Compose', 'Convert', 'Dead', 'FinalMode', 'GroupFirst',
  'GroupLast', 'GroupNext', 'GroupPrevious', 'ModeChange', 'NextCandidate', 'NonConvert', 'PreviousCandidate',
  'Process', 'SingleCandidate',
  // ime korean
  'HangulMode', 'HanjaMode', 'JunjaMode',
  // ime japanese
  'Eisu', 'Hankaku', 'Hiragana', 'HiraganaKatakana', 'KanaMode', 'KanjiMode', 'Katakana', 'Romaji', 'Zenkaku',
  'ZenkakuHankaku',
  // function
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Soft1', 'Soft2', 'Soft3', 'Soft4',
  // multimedia
  'ChannelDown', 'ChannelUp', 'Close', 'MailForward', 'MailReply', 'MailSend', 'MediaClose', 'MediaFastForward',
  'MediaPause', 'MediaPlay', 'MediaPlayPause', 'MediaRecord', 'MediaRewind', 'MediaStop', 'MediaTrackNext',
  'MediaTrackPrevious', 'New', 'Open', 'Print', 'Save', 'SpellCheck',
  // multimedia numpad
  'Key11', 'Key12',
  // audio
  'AudioBalanceLeft', 'AudioBalanceRight', 'AudioBassBoostDown', 'AudioBassBoostToggle', 'AudioBassBoostUp',
  'AudioFaderFront', 'AudioFaderRear', 'AudioSurroundModeNext', 'AudioTrebleDown', 'AudioTrebleUp',
  'AudioVolumeDown', 'AudioVolumeUp', 'AudioVolumeMute', 'MicrophoneToggle', 'MicrophoneVolumeDown',
  'MicrophoneVolumeUp', 'MicrophoneVolumeMute',
  // speech
  'SpeechCorrectionList', 'SpeechInputToggle',
  // apps
  'LaunchApplication1', 'LaunchApplication2', 'LaunchCalendar', 'LaunchContacts', 'LaunchMail', 'LaunchMediaPlayer',
  'LaunchMusicPlayer', 'LaunchPhone', 'LaunchScreenSaver', 'LaunchSpreadsheet', 'LaunchWebBrowser', 'LaunchWebCam',
  'LaunchWordProcessor',
  // browser
  'BrowserBack', 'BrowserFavorites', 'BrowserForward', 'BrowserHome', 'BrowserRefresh', 'BrowserSearch',
  'BrowserStop',
  // mobile phone
  'AppSwitch', 'Call', 'Camera', 'CameraFocus', 'EndCall', 'GoBack', 'GoHome', 'HeadsetHook', 'LastNumberRedial',
  'Notification', 'MannerMode', 'VoiceDial',
  // tv
  'TV', 'TV3DMode', 'TVAntennaCable', 'TVAudioDescription', 'TVAudioDescriptionMixDown', 'TVAudioDescriptionMixUp',
  'TVContentsMenu', 'TVDataService', 'TVInput', 'TVInputComponent1', 'TVInputComponent2', 'TVInputComposite1',
  'TVInputComposite2', 'TVInputHDMI1', 'TVInputHDMI2', 'TVInputHDMI3', 'TVInputHDMI4', 'TVInputVGA1',
  'TVMediaContext', 'TVNetwork', 'TVNumberEntry', 'TVPower', 'TVRadioService', 'TVSatellite', 'TVSatelliteBS',
  'TVSatelliteCS', 'TVSatelliteToggle', 'TVTerrestrialAnalog', 'TVTerrestrialDigital', 'TVTimer',
  // media controller
  'AVRInput', 'AVRPower', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'ColorF4Grey',
  'ColorF5Brown', 'ClosedCaptionToggle', 'Dimmer', 'DisplaySwap', 'DVR', 'Exit', 'FavoriteClear0', 'FavoriteClear1',
  'FavoriteClear2', 'FavoriteClear3', 'FavoriteRecall0', 'FavoriteRecall1', 'FavoriteRecall2', 'FavoriteRecall3',
  'FavoriteStore0', 'FavoriteStore1', 'FavoriteStore2', 'FavoriteStore3', 'Guide', 'GuideNextDay',
  'GuidePreviousDay', 'Info', 'InstantReplay', 'Link', 'ListProgram', 'LiveContent', 'Lock', 'MediaApps',
  'MediaAudioTrack', 'MediaLast', 'MediaSkipBackward', 'MediaSkipForward', 'MediaStepBackward', 'MediaStepForward',
  'MediaTopMenu', 'NavigateIn', 'NavigateNext', 'NavigateOut', 'NavigatePrevious', 'NextFavoriteChannel',
  'NextUserProfile', 'OnDemand', 'Pairing', 'PinPDown', 'PinPMove', 'PinPToggle', 'PinPUp', 'PlaySpeedDown',
  'PlaySpeedReset', 'PlaySpeedUp', 'RandomToggle', 'RcLowBattery', 'RecordSpeedNext', 'RfBypass',
  'ScanChannelsToggle', 'ScreenModeNext', 'Settings', 'SplitScreenToggle', 'STBInput', 'STBPower', 'Subtitle',
  'Teletext', 'VideoModeNext', 'Wink', 'ZoomToggle',
] as const;

// https://w3c.github.io/uievents-code/#code-value-tables
// Required and optional codes, in specification table order.
// Source: w3c/uievents-code b201684d1de0af90bc403814bbdee6aa96647130.
const keyboardCodeValues = [
  // alphanumeric writing system
  'Backquote', 'Backslash', 'BracketLeft', 'BracketRight', 'Comma', 'Digit0', 'Digit1', 'Digit2', 'Digit3',
  'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Equal', 'IntlBackslash', 'IntlRo', 'IntlYen', 'KeyA',
  'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO',
  'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT', 'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ', 'Minus', 'Period',
  'Quote', 'Semicolon', 'Slash',
  // alphanumeric functional 1
  'AltLeft', 'AltRight', 'Backspace', 'CapsLock', 'ContextMenu', 'ControlLeft', 'ControlRight', 'Enter', 'MetaLeft',
  'MetaRight', 'ShiftLeft', 'ShiftRight', 'Space', 'Tab',
  // alphanumeric functional 2
  'Convert', 'KanaMode', 'Lang1', 'Lang2', 'Lang3', 'Lang4', 'Lang5', 'NonConvert',
  // controlpad
  'Delete', 'End', 'Help', 'Home', 'Insert', 'PageDown', 'PageUp',
  // arrowpad
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
  // numpad
  'NumLock', 'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8',
  'Numpad9', 'NumpadAdd', 'NumpadBackspace', 'NumpadClear', 'NumpadClearEntry', 'NumpadComma', 'NumpadDecimal',
  'NumpadDivide', 'NumpadEnter', 'NumpadEqual', 'NumpadHash', 'NumpadMemoryAdd', 'NumpadMemoryClear',
  'NumpadMemoryRecall', 'NumpadMemoryStore', 'NumpadMemorySubtract', 'NumpadMultiply', 'NumpadParenLeft',
  'NumpadParenRight', 'NumpadStar', 'NumpadSubtract',
  // function
  'Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Fn', 'FnLock',
  'PrintScreen', 'ScrollLock', 'Pause',
  // media
  'BrowserBack', 'BrowserFavorites', 'BrowserForward', 'BrowserHome', 'BrowserRefresh', 'BrowserSearch',
  'BrowserStop', 'Eject', 'LaunchApp1', 'LaunchApp2', 'LaunchMail', 'MediaPlayPause', 'MediaSelect', 'MediaStop',
  'MediaTrackNext', 'MediaTrackPrevious', 'Power', 'Sleep', 'AudioVolumeDown', 'AudioVolumeMute', 'AudioVolumeUp',
  'WakeUp',
  // legacy modifier
  'Hyper', 'Super', 'Turbo',
  // legacy process
  'Abort', 'Resume', 'Suspend',
  // legacy editing
  'Again', 'Copy', 'Cut', 'Find', 'Open', 'Paste', 'Props', 'Select', 'Undo',
  // international
  'Hiragana', 'Katakana',
  // special
  'Unidentified',
] as const;

const namedKeys = new Set<string>(namedKeyValues);
const keyboardCodes = new Set<string>(keyboardCodeValues);
