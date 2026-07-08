export const LOGICAL_COMBINATION_PSEUDO_CLASSES = [
  'is',
  'where',
  'not',
] as const;

export const USER_ACTION_PSEUDO_CLASSES = [
  'hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
] as const;

export const DEFAULT_VALID_TAIL_PSEUDO_CLASSES = [
  ...LOGICAL_COMBINATION_PSEUDO_CLASSES,
  ...USER_ACTION_PSEUDO_CLASSES,
] as const;
