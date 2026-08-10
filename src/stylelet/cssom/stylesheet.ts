import { MediaListImpl } from './media-list';
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
export abstract class StyleSheetImpl implements StyleSheet {
  readonly #type: CSSOMString;
  #location: string | null;
  #ownerNode: Element | ProcessingInstruction | null;
  #parentStyleSheet: CSSStyleSheet | null;
  #title: string;
  readonly #media: MediaListImpl;
  #disabled: boolean;

  protected constructor() {
    if (new.target === StyleSheetImpl) {
      throw new TypeError('Illegal constructor');
    }

    this.#type = 'text/css';
    this.#location = null;
    this.#ownerNode = null;
    this.#parentStyleSheet = null;
    this.#title = '';
    this.#media = new MediaListImpl();
    this.#disabled = false;
  }

  get type(): CSSOMString {
    return this.#type;
  }

  get href(): string | null {
    return this.#location;
  }

  get ownerNode(): Element | ProcessingInstruction | null {
    return this.#ownerNode;
  }

  get parentStyleSheet(): CSSStyleSheet | null {
    return this.#parentStyleSheet;
  }

  get title(): string | null {
    return this.#title === '' ? null : this.#title;
  }

  get media(): MediaList {
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

  protected setLocation(location: string | null): void {
    this.#location = location;
  }

  protected setOwnerNode(
    ownerNode: Element | ProcessingInstruction | null,
  ): void {
    this.#ownerNode = ownerNode;
  }

  protected setParentStyleSheet(
    parentStyleSheet: CSSStyleSheet | null,
  ): void {
    this.#parentStyleSheet = parentStyleSheet;
  }

  protected setTitle(title: string): void {
    this.#title = title;
  }

  protected setDisabled(disabled: boolean): void {
    this.#disabled = disabled;
  }

  protected setMedia(media: CSSOMString | MediaList): void {
    this.#media.mediaText = typeof media === 'string'
      ? media
      : media.mediaText;
  }
}
