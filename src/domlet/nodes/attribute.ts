import { AttrStub } from '../stubs/interfaces';

export class AttrImpl
  extends AttrStub
  implements Attr
{
  readonly #localName: string;
  #value: string;
  readonly #namespaceURI: string | null;
  readonly #prefix: string | null;

  constructor(
    localName: string,
    value: string,
    namespaceURI: string | null = null,
    prefix: string | null = null,
  ) {
    super();
    this.#localName = localName;
    this.#value = value;
    this.#namespaceURI = namespaceURI;
    this.#prefix = prefix;
  }

  get localName(): string {
    return this.#localName;
  }

  get value(): string {
    return this.#value;
  }

  set value(value: string) {
    this.#value = value;
  }

  get namespaceURI(): string | null {
    return this.#namespaceURI;
  }

  get prefix(): string | null {
    return this.#prefix;
  }

  get name(): string {
    return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
  }
}
