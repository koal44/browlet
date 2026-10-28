import { asciiLower, InternalError, isAsciiWhitespace } from '../../../infra/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../web-idl/core/index';
import { aboutBlankURL, areSameSite, copyURL, type URLRecord } from '../../../url/index';
import type { ReferrerPolicy } from '../../../fetch/index';

import { parseInteger } from '../../html/microsyntaxes/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment';

import type { WindowProxyHandle } from './window-proxy';

// TODO: Rehouse these opening algorithms with their owners as navigation is completed.
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#window-open-steps
export function openWindow(
  url: string, target: string, features: string, entryEnv: BrowletEnvironment,
): WindowProxyHandle | null {
  if (entryEnv.responsibleEventLoop.terminationNestingLevel !== 0) return null;
  const sourceDocument = entryEnv.realm.getAssociatedDocument();
  if (sourceDocument === null) throw new InternalError('Window opening requires an entry Document');
  let urlRecord = url === '' ? null : sourceDocument.encodingParseURL(url);
  if (url !== '' && urlRecord === null) {
    throw new DOMExceptionImpl('Invalid window URL', DOMExceptionNames.syntax);
  }
  if (target === '') target = '_blank';
  const tokenizedFeatures = tokenizeWindowFeatures(features);
  const noreferrer = isWindowFeatureSet(tokenizedFeatures, 'noreferrer', false);
  let noopener = getNoopenerForWindowOpen(sourceDocument, tokenizedFeatures, urlRecord);
  tokenizedFeatures.delete('noopener');
  tokenizedFeatures.delete('noreferrer');
  let referrerPolicy: ReferrerPolicy = '';
  if (noreferrer) {
    noopener = true;
    referrerPolicy = 'no-referrer';
  }

  const sourceNavigable = sourceDocument.getNodeNavigable();
  if (sourceNavigable === null) throw new InternalError('Window opening requires an entry navigable');
  const [targetNavigable, windowType] = sourceNavigable.chooseNavigable(target, noopener);
  if (targetNavigable === null) return null;

  if (windowType === 'new-and-unrestricted' || windowType === 'new-with-no-opener') {
    const browsingContext = targetNavigable.activeBrowsingContext;
    if (browsingContext === null) throw new InternalError('A new target needs an active browsing context');
    browsingContext.isPopup = isPopupWindowRequested(tokenizedFeatures);
    browsingContext.setUpFeatures(tokenizedFeatures);
    urlRecord ??= copyURL(aboutBlankURL);
    if (
      urlRecord.scheme === 'about' && urlRecord.path === 'blank' &&
      urlRecord.username === '' && urlRecord.password === '' && urlRecord.host === null
    ) {
      const document = targetNavigable.activeDocument;
      if (document === null) throw new InternalError('A new target needs an active Document');
      document.updateURLAndHistory(urlRecord);
    } else {
      targetNavigable.navigate(urlRecord, sourceDocument, { exceptionsEnabled: true, referrerPolicy });
    }
  } else {
    if (urlRecord !== null) {
      targetNavigable.navigate(urlRecord, sourceDocument, { exceptionsEnabled: true, referrerPolicy });
    }
    if (!noopener) {
      const browsingContext = targetNavigable.activeBrowsingContext;
      if (browsingContext === null) throw new InternalError('An existing target needs an active browsing context');
      browsingContext.openerBrowsingContext = sourceDocument.browsingContext;
    }
  }

  if (windowType === 'new-with-no-opener') return null;
  const targetKeyword = asciiLower(target);
  if (noopener && targetKeyword !== '_self' && targetKeyword !== '_parent' && targetKeyword !== '_top') return null;
  return targetNavigable.activeWindowProxy;
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#get-noopener-for-window-open
function getNoopenerForWindowOpen(
  sourceDocument: DocumentImpl,
  tokenizedFeatures: ReadonlyMap<string, string>,
  url: URLRecord | null,
): boolean {
  if (url !== null && url.blobURLEntry !== null) {
    const topLevelOrigin = sourceDocument.env.topLevelOrigin;
    if (topLevelOrigin === null) throw new InternalError('Window opening requires a top-level origin');
    if (!areSameSite(url.blobURLEntry.env.origin, topLevelOrigin)) return true;
  }
  return isWindowFeatureSet(tokenizedFeatures, 'noopener', false);
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#popup-window-is-requested
function isPopupWindowRequested(tokenizedFeatures: ReadonlyMap<string, string>): boolean {
  if (tokenizedFeatures.size === 0) return false;
  const popup = tokenizedFeatures.get('popup');
  if (popup !== undefined) return parseBooleanFeature(popup);
  const location = isWindowFeatureSet(tokenizedFeatures, 'location', false);
  const toolbar = isWindowFeatureSet(tokenizedFeatures, 'toolbar', false);
  if (!location && !toolbar) return true;
  if (!isWindowFeatureSet(tokenizedFeatures, 'menubar', false)) return true;
  if (!isWindowFeatureSet(tokenizedFeatures, 'resizable', true)) return true;
  if (!isWindowFeatureSet(tokenizedFeatures, 'scrollbars', false)) return true;
  return !isWindowFeatureSet(tokenizedFeatures, 'status', false);
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-window-open-features-tokenize
function tokenizeWindowFeatures(features: string): Map<string, string> {
  const tokenizedFeatures = new Map<string, string>();
  let position = 0;
  while (position < features.length) {
    while (isFeatureSeparator(features.charCodeAt(position))) position++;
    const nameStart = position;
    while (position < features.length && !isFeatureSeparator(features.charCodeAt(position))) position++;
    const name = normalizeWindowFeatureName(asciiLower(features.slice(nameStart, position)));
    let value = '';

    while (position < features.length && features[position] !== '=') {
      if (features[position] === ',' || !isFeatureSeparator(features.charCodeAt(position))) break;
      position++;
    }
    if (isFeatureSeparator(features.charCodeAt(position))) {
      while (isFeatureSeparator(features.charCodeAt(position)) && features[position] !== ',') position++;
      const valueStart = position;
      while (position < features.length && !isFeatureSeparator(features.charCodeAt(position))) position++;
      value = asciiLower(features.slice(valueStart, position));
    }
    if (name !== '') tokenizedFeatures.set(name, value);
  }
  return tokenizedFeatures;
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#window-feature-is-set
function isWindowFeatureSet(
  tokenizedFeatures: ReadonlyMap<string, string>, featureName: string, defaultValue: boolean,
): boolean {
  const value = tokenizedFeatures.get(featureName);
  return value === undefined ? defaultValue : parseBooleanFeature(value);
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#normalizing-the-feature-name
function normalizeWindowFeatureName(name: string): string {
  switch (name) {
    case 'screenx': return 'left';
    case 'screeny': return 'top';
    case 'innerwidth': return 'width';
    case 'innerheight': return 'height';
    default: return name;
  }
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-window-open-features-parse-boolean
function parseBooleanFeature(value: string): boolean {
  if (value === '' || value === 'yes' || value === 'true') return true;
  return (parseInteger(value) ?? 0n) !== 0n;
}

function isFeatureSeparator(code: number): boolean {
  return isAsciiWhitespace(code) || code === 61 || code === 44;
}
