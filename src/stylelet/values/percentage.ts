import { serializeNumber } from './number';

export type PercentageValue = {
  type: 'percentage';
  value: number;
};

export function serializePercentage(value: PercentageValue): string {
  return `${serializeNumber(value.value)}%`;
}
