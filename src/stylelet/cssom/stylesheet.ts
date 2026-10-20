import type { DOMElement, DOMProcessingInstruction } from '../../infra/index';
import { TypeError } from '../../infra/exceptions';

import type { StyleletEnvironment, StyleletURL } from '../environment';

import { MediaListImpl } from './media-list';
import type { CSSStyleSheetImpl } from './css-stylesheet';
import type { CSSOMString } from './string';

/*
 * [Exposed=Window]
 * interface StyleSheet {
 *   readonly attribute CSSOMString type;
 *   readonly attribute USVString? href;
 *   readonly attribute (Element or ProcessingInstruction)? ownerNode;
 *   readonly attribute CSSStyleSheet? parentStyleSheet;
 *   readonly attribute DOMString? title;
 *   [SameObject, PutForwards=mediaText] readonly attribute MediaList media;
 *   attribute boolean disabled;
 * };
 */
export abstract class StyleSheetImpl {
  /** Parsed location retained for internal URL resolution; href exposes its string. */
  location: StyleletURL | null = null;

  protected env: StyleletEnvironment;
  #type: CSSOMString;
  #ownerNode: DOMElement | DOMProcessingInstruction | null;
  #parentStyleSheet: CSSStyleSheetImpl | null;
  #title: string;
  #media: MediaListImpl;
  #disabled: boolean;

  protected constructor(env: StyleletEnvironment) {
    if (new.target === StyleSheetImpl) {
      throw new TypeError('Illegal constructor');
    }

    this.env = env;
    this.#type = 'text/css';
    this.#ownerNode = null;
    this.#parentStyleSheet = null;
    this.#title = '';
    this.#media = new MediaListImpl('', env);
    this.#disabled = false;
  }

  get type(): CSSOMString {
    return this.#type;
  }

  get href(): string | null {
    return this.location?.href ?? null;
  }

  get ownerNode(): DOMElement | DOMProcessingInstruction | null {
    return this.#ownerNode;
  }

  get parentStyleSheet(): CSSStyleSheetImpl | null {
    return this.#parentStyleSheet;
  }

  get title(): string | null {
    return this.#title === '' ? null : this.#title;
  }

  get media(): MediaListImpl {
    return this.#media;
  }

  set media(mediaText: string) {
    this.setMedia(mediaText);
  }

  get disabled(): boolean {
    return this.#disabled;
  }

  set disabled(value: boolean) {
    this.#disabled = value;
  }

  protected setOwnerNode(
    ownerNode: DOMElement | DOMProcessingInstruction | null,
  ): void {
    this.#ownerNode = ownerNode;
  }

  protected setParentStyleSheet(
    parentStyleSheet: CSSStyleSheetImpl | null,
  ): void {
    this.#parentStyleSheet = parentStyleSheet;
  }

  protected setTitle(title: string): void {
    this.#title = title;
  }

  protected setDisabled(disabled: boolean): void {
    this.#disabled = disabled;
  }

  protected setMedia(media: CSSOMString | MediaListImpl): void {
    this.#media.mediaText = typeof media === 'string'
      ? media
      : media.mediaText;
  }
}
