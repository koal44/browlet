import { AttrStub } from '../stubs/interfaces';

export class AttrImpl
  extends AttrStub
  implements Attr
{
  constructor(
    readonly localName: string,
    public value: string,
    readonly namespaceURI: string | null = null,
    readonly prefix: string | null = null,
  ) {
    super();
  }

  get name(): string {
    return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
  }
}
