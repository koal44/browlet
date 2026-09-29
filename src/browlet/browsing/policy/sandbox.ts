import { asciiLower } from '../../../infra/ascii';
import { asciiWhitespaceRunPattern } from '../../../infra/patterns';

/** Sandbox restrictions; an empty set imposes none. */
// https://html.spec.whatwg.org/multipage/browsers.html#sandboxing-flag-set
export class SandboxingFlagSet extends Set<SandboxingFlag> {
  /** Parse sandbox keywords, applying all restrictions when the directive is empty. */
  // https://html.spec.whatwg.org/multipage/browsers.html#parse-a-sandboxing-directive
  // Return the flag set instead of requiring the caller to allocate an output parameter.
  static parse(directive: string): SandboxingFlagSet {
    const tokens = new Set(asciiLower(directive).split(asciiWhitespaceRunPattern));
    const flags = new SandboxingFlagSet(['sandboxed-navigation', 'sandboxed-document-domain']);
    for (const [flag, exceptions] of sandboxExceptions) {
      if (!exceptions.some((token) => tokens.has(token))) flags.add(flag);
    }
    return flags;
  }
}

export type SandboxingFlag =
  | 'sandboxed-navigation'
  | 'sandboxed-auxiliary-navigation'
  | 'sandboxed-top-level-navigation-without-user-activation'
  | 'sandboxed-top-level-navigation-with-user-activation'
  | 'sandboxed-origin'
  | 'sandboxed-forms'
  | 'sandboxed-pointer-lock'
  | 'sandboxed-scripts'
  | 'sandboxed-automatic-features'
  | 'sandboxed-document-domain'
  | 'sandbox-propagates-to-auxiliary-browsing-contexts'
  | 'sandboxed-modals'
  | 'sandboxed-orientation-lock'
  | 'sandboxed-presentation'
  | 'sandboxed-downloads'
  | 'sandboxed-custom-protocols-navigation';

const sandboxExceptions: [SandboxingFlag, string[]][] = [
  ['sandboxed-auxiliary-navigation', ['allow-popups']],
  ['sandboxed-top-level-navigation-without-user-activation', ['allow-top-navigation']],
  ['sandboxed-top-level-navigation-with-user-activation', ['allow-top-navigation', 'allow-top-navigation-by-user-activation']],
  ['sandboxed-origin', ['allow-same-origin']],
  ['sandboxed-forms', ['allow-forms']],
  ['sandboxed-pointer-lock', ['allow-pointer-lock']],
  ['sandboxed-scripts', ['allow-scripts']],
  ['sandboxed-automatic-features', ['allow-scripts']],
  ['sandbox-propagates-to-auxiliary-browsing-contexts', ['allow-popups-to-escape-sandbox']],
  ['sandboxed-modals', ['allow-modals']],
  ['sandboxed-orientation-lock', ['allow-orientation-lock']],
  ['sandboxed-presentation', ['allow-presentation']],
  ['sandboxed-downloads', ['allow-downloads']],
  ['sandboxed-custom-protocols-navigation', ['allow-top-navigation-to-custom-protocols', 'allow-popups', 'allow-top-navigation']],
];
