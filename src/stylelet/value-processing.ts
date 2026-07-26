export type ValueStage =
  | 'declared'
  | 'cascaded'
  | 'specified'
  | 'computed'
  | 'used'
  | 'actual';

export type ValueStageContext = {
  /** Value-processing stage whose available information is being applied. */
  stage?: ValueStage;
};

export function isAtOrBeyondValueStage(
  stage: ValueStage,
  minimum: ValueStage,
): boolean {
  return VALUE_STAGE_ORDER[stage] >= VALUE_STAGE_ORDER[minimum];
}

const VALUE_STAGE_ORDER: Record<ValueStage, number> = {
  declared: 0,
  cascaded: 1,
  specified: 2,
  computed: 3,
  used: 4,
  actual: 5,
};
