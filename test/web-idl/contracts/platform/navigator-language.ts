import type { Navigator, WorkerNavigator } from '../../../../src/browlet/platform';

declare const navigator: Navigator;
declare const workerNavigator: WorkerNavigator;

const language: string = navigator.language;
const languages: readonly string[] = navigator.languages;
const workerLanguage: string = workerNavigator.language;
const workerLanguages: readonly string[] = workerNavigator.languages;
void [language, languages, workerLanguage, workerLanguages];

// @ts-expect-error Navigator language is readonly.
navigator.language = 'fr';
// @ts-expect-error Navigator languages is a frozen array.
navigator.languages.push('fr');
// @ts-expect-error WorkerNavigator languages is readonly.
workerNavigator.languages = ['fr'];
// @ts-expect-error WorkerNavigator languages is a frozen array.
workerNavigator.languages[0] = 'fr';
