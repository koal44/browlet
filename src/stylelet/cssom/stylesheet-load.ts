import { parseURL, urlsEqual, type URLRecord } from '../../url/index';

import type { StyleletEnvironment } from '../environment';
import { CSSImportRuleImpl, type CSSRuleImpl } from './rules/index';

import type { CSSStyleSheetImpl } from './css-stylesheet';

/** One finite import load; the caller owns document blocking and events. */
// https://html.spec.whatwg.org/multipage/infrastructure.html#critical-subresources
// SPEC_GAP(stylesheet-import-loading): Track recursive completion here; the host supplies fetching and HTML lifecycle work.
export class StyleSheetLoad {
  #sheet: CSSStyleSheetImpl;
  #fetch: FetchImportedStyleSheet;
  #complete: (success: boolean) => void;
  #started: ((load: StyleSheetLoad) => void) | undefined;
  #env: StyleletEnvironment;
  #pending = new Map<CSSImportRuleImpl, PendingImport>();
  #visiting = 0;
  #finished = false;
  #success = true;

  constructor(
    sheet: CSSStyleSheetImpl, fetchImport: FetchImportedStyleSheet, complete: (success: boolean) => void,
    started: ((load: StyleSheetLoad) => void) | undefined, env: StyleletEnvironment,
  ) {
    this.#sheet = sheet;
    this.#fetch = fetchImport;
    this.#complete = complete;
    this.#started = started;
    this.#env = env;
  }

  /** Start a parsed sheet's imports; a supplied fetcher may complete synchronously. */
  static start(
    sheet: CSSStyleSheetImpl, fetchImport: FetchImportedStyleSheet,
    complete: (success: boolean) => void, started: ((load: StyleSheetLoad) => void) | undefined, env: StyleletEnvironment,
  ): StyleSheetLoad {
    sheet.importLoad?.cancel();
    const load = new StyleSheetLoad(sheet, fetchImport, complete, started, env);
    sheet.importLoad = load;
    load.#update([...sheet.ruleList], [], true);
    return load;
  }

  /** Join an active attempt, or start a fresh attempt for imports inserted after completion. */
  updateImports(added: CSSRuleImpl[], removed: CSSRuleImpl[]): void {
    if (!this.#finished) {
      this.#update(added, removed);
    } else if (added.some((rule) => rule instanceof CSSImportRuleImpl)) {
      const load = new StyleSheetLoad(this.#sheet, this.#fetch, this.#complete, this.#started, this.#env);
      this.#sheet.importLoad = load;
      load.#update(added, [], true);
    }
  }

  /** Disconnect this attempt if still current, cancel pending requests, and ignore late responses. */
  cancel(): void {
    if (this.#sheet.importLoad === this) this.#sheet.importLoad = undefined;
    if (this.#finished) return;
    this.#finished = true;
    for (const rule of this.#pending.keys()) this.#withdraw(rule);
  }

  #update(added: CSSRuleImpl[], removed: CSSRuleImpl[], started = false): void {
    this.#visiting++;
    try {
      if (started) this.#started?.(this);
      if (removed.length !== 0) {
        for (const rule of this.#pending.keys()) {
          for (let ancestor: CSSRuleImpl | null = rule; ancestor !== null; ancestor = ancestor.parentStyleSheet?.ownerRule ?? null) {
            if (removed.includes(ancestor)) {
              this.#withdraw(rule);
              break;
            }
          }
        }
      }
      for (const rule of added) {
        if (this.#finished) break;
        if (rule instanceof CSSImportRuleImpl) this.#visit(rule);
      }
    } catch (error) {
      this.cancel();
      throw error;
    } finally {
      this.#visiting--;
    }
    this.#finish();
  }

  #visit(rule: CSSImportRuleImpl): void {
    const sheet = rule.parentStyleSheet;
    if (sheet?.getImportLoad() !== this || this.#pending.has(rule)) return;
    if (rule.styleSheet !== null) {
      this.#update([...rule.styleSheet.ruleList], []);
      return;
    }
    const url = parseURL(rule.href, sheet.baseURL ?? sheet.location, 'UTF-8', this.#env.userAgent).url;
    if (url === null) {
      this.#success = false;
      return;
    }
    // SPEC_GAP(stylesheet-import-cycles): Like browser loaders, ignore imports of an ancestor URL, excluding fragments.
    if (hasAncestorURL(sheet, url)) return;

    const pending: PendingImport = { cancelled: false };
    this.#pending.set(rule, pending);
    pending.cancel = this.#fetch(url, rule, (imported, success) => {
      if (!this.#pending.delete(rule)) return;
      // SPEC_CLASH(stylesheet-import-descendant-failure): Like Gecko, report descendant failures; Blink/WebKit can report success.
      if (!success) this.#success = false;
      if (imported !== null) {
        imported.associateWithImport(rule);
        this.#update([...imported.ruleList], []);
      }
      this.#finish();
    });
    // A supplied fetcher can synchronously trigger removal before returning its cancellation step.
    if (pending.cancelled) pending.cancel();
  }

  #withdraw(rule: CSSImportRuleImpl): void {
    const pending = this.#pending.get(rule)!;
    this.#pending.delete(rule);
    pending.cancelled = true;
    pending.cancel?.();
  }

  #finish(): void {
    // A synchronous response must not finish before the remaining imports have been visited.
    if (this.#finished || this.#visiting !== 0 || this.#pending.size !== 0) return;
    this.#finished = true;
    this.#complete(this.#success);
  }
}

/**
 * Fetch and parse one resource, report its sheet and success once, and return its cancellation step.
 * The rule retains URL modifiers and its parent sheet; url is resolved for cycle detection.
 * A non-null sheet must be fresh and unassociated; a failed load may still supply an empty sheet.
 * Its origin-clean flag describes its response; association also applies the parent's flag.
 */
export type FetchImportedStyleSheet = (
  url: URLRecord, rule: CSSImportRuleImpl, complete: (sheet: CSSStyleSheetImpl | null, success: boolean) => void,
) => () => void;

type PendingImport = { cancel?: () => void; cancelled: boolean; };

function hasAncestorURL(sheet: CSSStyleSheetImpl | null, url: URLRecord): boolean {
  for (; sheet !== null; sheet = sheet.parentStyleSheet) {
    if (sheet.location !== null && urlsEqual(sheet.location, url, true) ||
      sheet.baseURL !== undefined && urlsEqual(sheet.baseURL, url, true)) return true;
  }
  return false;
}
