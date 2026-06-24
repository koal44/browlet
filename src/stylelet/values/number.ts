export type NumberToken = {
  raw: string;
  value: number;
};

export function serializeNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}
