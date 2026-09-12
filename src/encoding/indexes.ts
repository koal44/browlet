import { Buffer } from 'node:buffer';

/** Encoding Standard §5 — An index, expanded only when a codec needs it. */
export class EncodingIndex {
  readonly #packed: string;
  readonly #length: number;
  readonly #width: 2 | 4;
  #values?: Uint16Array | Uint32Array;
  #pointers?: Uint16Array | Uint32Array;

  constructor(packed: string, length: number, width: 2 | 4) {
    this.#packed = packed;
    this.#length = length;
    this.#width = width;
  }

  /** Zero denotes an unmapped pointer; mapped index entries are never U+0000. */
  get values(): Uint16Array | Uint32Array {
    return this.#values ??= this.#unpack();
  }

  /** §5 — Index code point: a missing pointer maps to null. */
  codePoint(pointer: number): number | null {
    return this.values[pointer] || null;
  }

  /** §5 — Index pointer: use the first occurrence of a code point. */
  pointer(codePoint: number): number | null {
    const pointers = this.#pointers ??= this.createPointers();
    const pointer = pointers[codePoint];
    return pointer ? pointer - 1 : null;
  }

  /** Store pointer + 1 so pointer zero remains distinct from a missing entry. */
  protected createPointers(excludeStart = -1, excludeEnd = -1): Uint16Array | Uint32Array {
    const values = this.values;
    let maximum = 0;
    for (const point of values) if (point > maximum) maximum = point;
    // Stored pointers are offset by one; 0xffff entries still fit in 16 bits.
    const pointers = values.length <= 0xffff
      ? new Uint16Array(maximum + 1) : new Uint32Array(maximum + 1);
    for (let pointer = 0; pointer < values.length; pointer++) {
      if (pointer >= excludeStart && pointer <= excludeEnd) continue;
      const point = values[pointer]!;
      if (point !== 0 && pointers[point] === 0) pointers[point] = pointer + 1;
    }
    return pointers;
  }

  #unpack(): Uint16Array | Uint32Array {
    const bytes = Buffer.from(this.#packed, 'base64');
    const values = this.#width === 2 ? new Uint16Array(this.#length) : new Uint32Array(this.#length);
    let offset = 0;
    let position = 0;
    let previous = 0;
    const read = (): number => {
      let value = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = bytes[offset++]!;
        value |= (byte & 127) << shift;
        shift += 7;
      } while (byte & 128);
      return value;
    };
    const signed = (value: number): number => value & 1 ? -(value + 1) / 2 : value / 2;

    // Trusted generated data: 0 = zero run, 1 = ascending run, >= 2 = delta.
    while (offset < bytes.length) {
      const tag = read();
      if (tag === 0) {
        position += read();
      } else if (tag === 1) {
        const count = read();
        previous += signed(read());
        for (let i = 0; i < count; i++) values[position++] = previous++;
        previous--;
      } else {
        values[position++] = previous += signed(tag - 2);
      }
    }
    return values;
  }
}

/** §5 — Big5's encoder excludes its initial region and prefers six last pointers. */
export class Big5Index extends EncodingIndex {
  protected override createPointers(): Uint16Array | Uint32Array {
    const pointers = super.createPointers(0, (0xa1 - 0x81) * 157 - 1);
    for (const point of [0x2550, 0x255e, 0x2561, 0x256a, 0x5341, 0x5345]) {
      pointers[point] = this.values.lastIndexOf(point) + 1;
    }
    return pointers;
  }
}

/** §5 — JIS0208 has a separate reverse index for Shift_JIS's excluded region. */
export class JIS0208Index extends EncodingIndex {
  #shiftJISPointers?: Uint16Array | Uint32Array;

  shiftJISPointer(codePoint: number): number | null {
    const pointers = this.#shiftJISPointers ??= this.createPointers(8272, 8835);
    const pointer = pointers[codePoint];
    return pointer ? pointer - 1 : null;
  }
}

/** §5 — GB18030 ranges retain ordered pointer/code-point pairs, not a dense index. */
export class GB18030Ranges extends EncodingIndex {
  override codePoint(pointer: number): number | null {
    if (pointer > 39419 && pointer < 189000 || pointer > 1237575) return null;
    if (pointer === 7457) return 0xe7c7;
    const offset = this.#range(pointer, 0);
    return this.values[offset + 1]! + pointer - this.values[offset]!;
  }

  override pointer(codePoint: number): number {
    if (codePoint === 0xe7c7) return 7457;
    const offset = this.#range(codePoint, 1);
    return this.values[offset]! + codePoint - this.values[offset + 1]!;
  }

  /** Find the last range start less than or equal to the requested value. */
  #range(value: number, column: 0 | 1): number {
    const values = this.values;
    let low = 0;
    let high = values.length / 2;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (values[middle * 2 + column]! <= value) low = middle;
      else high = middle;
    }
    return low * 2;
  }
}
