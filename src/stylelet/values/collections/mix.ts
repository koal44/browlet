/** Shared percentage weights for CSS mix notations, independent of the values being mixed. */
// https://drafts.csswg.org/css-values-5/#mix-percentage-normalization
export class MixPercentages {
  /** Percentage points, with undefined for omitted weights; calculations leave this array unchanged. */
  percentages: (number | undefined)[];

  constructor(percentages: (number | undefined)[]) {
    this.percentages = percentages;
  }

  /** Fill omitted weights from the remainder, without scaling specified percentages. */
  complete(): number[] {
    let specifiedSum = 0;
    let omittedCount = 0;
    for (const percentage of this.percentages) {
      if (percentage === undefined) omittedCount++;
      else specifiedSum += percentage;
    }

    const omittedPercentage = omittedCount === 0 ? 0 : (100 - Math.min(specifiedSum, 100)) / omittedCount;
    return this.percentages.map((percentage) => percentage ?? omittedPercentage);
  }

  /** Complete and scale the weights, retaining any deficit for the notation's none value. */
  // Values remain with the caller; only their weights participate in this shared algorithm.
  normalize(forceNormalization = false): { percentages: number[]; leftover: number; } {
    const percentages = this.complete();
    const total = percentages.reduce((sum, percentage) => sum + percentage, 0);

    if (total > 100 || (total > 0 && forceNormalization)) {
      const factor = 100 / total;
      for (let index = 0; index < percentages.length; index++) {
        percentages[index] = percentages[index]! * factor;
      }
    }

    return { percentages, leftover: total < 100 ? 100 - total : 0 };
  }
}
