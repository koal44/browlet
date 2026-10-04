import type { CSSStyleSheetImpl } from './css-stylesheet';

/** Common state and contract for CSS rule implementations. */
export abstract class CSSRuleImpl {
  STYLE_RULE = 1 as const;
  CHARSET_RULE = 2 as const;
  IMPORT_RULE = 3 as const;
  MEDIA_RULE = 4 as const;
  FONT_FACE_RULE = 5 as const;
  PAGE_RULE = 6 as const;
  KEYFRAMES_RULE = 7 as const;
  KEYFRAME_RULE = 8 as const;
  MARGIN_RULE = 9 as const;
  NAMESPACE_RULE = 10 as const;
  COUNTER_STYLE_RULE = 11 as const;
  SUPPORTS_RULE = 12 as const;
  FONT_FEATURE_VALUES_RULE = 14 as const;

  // TODO: Maintain these associations when rules are inserted, moved, or removed.
  parentRule: CSSRuleImpl | null = null;
  parentStyleSheet: CSSStyleSheetImpl | null = null;

  abstract type: number;
  abstract get cssText(): string;
  abstract set cssText(value: string);
}
