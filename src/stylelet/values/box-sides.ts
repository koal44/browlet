/** Four physical sides in top, right, bottom, left order; T determines each side's value form. */
// PROVISIONAL: introduced for HTML lazy loading; review this representation with broader CSS box-value work.
export type BoxSides<T> = [
  top: T,
  right: T,
  bottom: T,
  left: T,
];
