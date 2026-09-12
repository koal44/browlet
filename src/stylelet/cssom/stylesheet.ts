import { MediaListImpl } from './media-list';
import type { CSSStyleSheetImpl } from './css-stylesheet';
import type { CSSOMString } from './string';
import type { RuntimeCaps } from '../stylelet';

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
  readonly #type: CSSOMString;
  #location: string | null;
  #ownerNode: Element | ProcessingInstruction | null;
  #parentStyleSheet: CSSStyleSheetImpl | null;
  #title: string;
  readonly #media: MediaListImpl;
  #disabled: boolean;
  protected readonly runtime: RuntimeCaps;

  protected constructor(runtime: RuntimeCaps) {
    if (new.target === StyleSheetImpl) {
      throw new TypeError('Illegal constructor');
    }

    this.runtime = runtime;
    this.#type = 'text/css';
    this.#location = null;
    this.#ownerNode = null;
    this.#parentStyleSheet = null;
    this.#title = '';
    this.#media = new MediaListImpl('', runtime);
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

  protected setLocation(location: string | null): void {
    this.#location = location;
  }

  protected setOwnerNode(
    ownerNode: Element | ProcessingInstruction | null,
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

  protected setMedia(media: CSSOMString | MediaList): void {
    this.#media.mediaText = typeof media === 'string'
      ? media
      : media.mediaText;
  }
}
