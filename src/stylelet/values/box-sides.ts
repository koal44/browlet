/** Four physical sides in top, right, bottom, left order; T determines each side's value form. */
// PROVISIONAL: used for IntersectionObserver margins by HTML lazy loading.
// This tuple is not a CSS value grammar; review its home with the broader box-value work.
export type BoxSides<T> = [
  top: T,
  right: T,
  bottom: T,
  left: T,
];
