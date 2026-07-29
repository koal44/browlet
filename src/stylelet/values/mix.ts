/*
 * CSS Values 5, "Normalizing Mix Percentages".
 *
 * Percentages are represented in percentage points, from 0 to 100.
 */

export function normalizeMixPercentages(
  percentages: readonly (number | undefined)[],
  forceNormalization = false,
): {
  percentages: number[];
  leftover: number;
} {
  let normalized = completeMixPercentages(percentages);
  const total = normalized.reduce(
    (sum, percentage) => sum + percentage,
    0,
  );

  if (
    total > 100 ||
    (total > 0 && forceNormalization)
  ) {
    const factor = 100 / total;

    normalized = normalized.map(
      (percentage) => percentage * factor,
    );
  }

  return {
    percentages: normalized,
    leftover: total < 100 ? 100 - total : 0,
  };
}

export function completeMixPercentages(
  percentages: readonly (number | undefined)[],
): number[] {
  const specifiedSum = Math.min(
    percentages.reduce<number>(
      (sum, percentage) => sum + (percentage ?? 0),
      0,
    ),
    100,
  );
  const omittedCount = percentages.filter(
    (percentage) => percentage === undefined,
  ).length;
  const omittedPercentage = omittedCount === 0
    ? 0
    : (100 - specifiedSum) / omittedCount;

  return percentages.map(
    (percentage) => percentage ?? omittedPercentage,
  );
}
