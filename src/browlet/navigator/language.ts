import { InternalError } from '../../infra/index';
import { defineInterfaceMixin, frozenArray, idlType, roAttr } from '../../web-idl/core/index';

import { EventTargetImpl } from '../dom/events/index';
import type { BrowletEnvironment } from '../environment/index';

/** Language preferences published to one Window or worker at its task boundary. */
// https://html.spec.whatwg.org/multipage/system-state.html#language-preferences
export class NavigatorLanguageMixin {
  /** Relevant settings of the including Navigator or WorkerNavigator. */
  env: BrowletEnvironment;
  /** Stable published list; initial emulation is selected after global construction. */
  #languages: readonly string[] | null = null;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-language
  get language(): string { return this.languages[0]!; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-languages
  get languages(): readonly string[] {
    if (this.#languages === null) {
      const userAgent = this.env.userAgent;
      const emulatedLanguage = userAgent.webDriverBiDiEmulatedLanguage(this.env);
      // SPEC_CLASH(navigator-languages-identity): Follow HTML's stable identity; WebKit and Chromium locale emulation return fresh arrays.
      this.#languages = emulatedLanguage === null ? [...userAgent.preferredLanguages] : [emulatedLanguage];
    }
    return this.#languages;
  }

  /**
   * Queue already-selected, valid BCP 47 tags before the producer updates its
   * preference or emulation source. Even an unread Navigator retains its old
   * values until the task starts. An emulation update also replaces an equal list.
   */
  queueLanguageChange(tags: readonly [string, ...string[]], emulationUpdated = false): void {
    // Establish the old value while the producer's previous settings still apply.
    void this.languages;
    const languages = [...tags];
    const global = this.env.globalImplementation;
    if (!EventTargetImpl.is(global)) throw new InternalError('Navigator language changes require a Window or worker event target');
    this.env.queueTask('dom-manipulation', () => {
      const previous = this.languages;
      if (!emulationUpdated && previous.length === languages.length &&
        previous.every((language, index) => language === languages[index])) return;
      this.#languages = languages;
      global.fireEvent('languagechange');
    });
  }
}

export const navigatorLanguageIDL = defineInterfaceMixin({
  name: 'NavigatorLanguage',
  members: [
    roAttr('language', idlType.DOMString),
    roAttr('languages', frozenArray(idlType.DOMString)),
  ],
});
