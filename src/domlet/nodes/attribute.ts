export class Attribute {
  constructor(
    readonly localName: string,
    public value: string,
    readonly namespaceURI: string | null = null,
    readonly prefix: string | null = null,
  ) {}

  get name(): string {
    return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
  }
}
