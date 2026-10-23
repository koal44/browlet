import type { WholeValue } from '../values/index';
import { getShorthand, type BaseProperty, type PropertyName } from '../props/index';

// Type parameter: W = whole property value.

/** An element's computed property values, independent of authored declarations and DOM storage. */
export class ComputedStyle {
  #properties = new Map<string, ComputedProperty>();
  #serializedValues = new Map<string, string>();
  #names?: string[];

  get size(): number {
    return this.#properties.size;
  }

  /** Retain a computed whole value; replace through this method rather than mutating an entry or its value. */
  set<W extends WholeValue>(property: BaseProperty<W, PropertyName>, propValue: W): void {
    if (!this.#properties.has(property.name)) this.#names = undefined;
    this.#properties.set(property.name, { property, value: propValue });
    this.#serializedValues.delete(property.name);
  }

  /** Read a retained property and value by its normalized name. */
  get(name: string): ComputedProperty | undefined {
    return this.#properties.get(name);
  }

  /** Property name in collection order, or empty text outside the collection. */
  item(index: number): string {
    this.#names ??= [...this.#properties.keys()];
    return this.#names[index] ?? '';
  }

  keys(): MapIterator<string> {
    return this.#properties.keys();
  }

  /** Serialize the retained value or a complete shorthand without resolving anything. */
  serialize(name: string): string {
    const shorthand = getShorthand(name);
    if (shorthand !== undefined) {
      const propValues: WholeValue[] = [];
      for (const property of shorthand.longhands) {
        const entry = this.#properties.get(property.name);
        if (entry === undefined) return '';
        propValues.push(entry.value);
      }
      return shorthand.serialize(propValues);
    }

    const cached = this.#serializedValues.get(name);
    if (cached !== undefined) return cached;
    const entry = this.#properties.get(name);
    if (entry === undefined) return '';
    const text = entry.property.serialize(entry.value);
    this.#serializedValues.set(name, text);
    return text;
  }
}

/** A result retains its property behavior, but has no declaration importance or source order. */
type ComputedProperty = {
  property: BaseProperty<WholeValue, PropertyName>;
  value: WholeValue;
};
