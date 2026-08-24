export class HTMLCollectionImpl<T extends Element = Element>
  extends Array<T>
  implements HTMLCollectionOf<T>
{
  item(index: number): T | null {
    return this[index] ?? null;
  }

  namedItem(name: string): T | null {
    return this.find((element) =>
      element.getAttribute('id') === name ||
      element.getAttribute('name') === name
    ) ?? null;
  }
}
