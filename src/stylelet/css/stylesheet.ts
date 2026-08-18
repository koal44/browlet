import {
  parseSyntaxStylesheet,
  type ParserInput, type SyntaxBlockContents, type SyntaxQualifiedRule,
  type SyntaxRule, type SyntaxStyleSheet,
} from '../syntax/parser';
import {
  parseNestedSelectorList, parseSelectorList, type SelectorList,
} from '../syntax/selector';
import {
  interpretPropertyDeclaration, type PropertyDeclaration, type PropertyRule,
} from './property';

export type InterpretedStyleSheet = {
  rules: InterpretedRule[];
  location?: URL;
  baseUrl?: URL;
  originalText?: string;
};

export type StyleSheetOptions = {
  location?: URL;
  baseUrl?: URL;
};

export type InterpretedRule =
  | StyleRule
  | PropertyRule;

export type StyleRule = {
  type: 'style-rule';
  selectors: SelectorList;
  block: StyleBlock;
};

export type StyleBlock = Array<PropertyDeclaration | StyleRule>;

export function parseStylesheet(
  input: ParserInput,
  options: StyleSheetOptions = {},
): InterpretedStyleSheet {
  return interpretStylesheet(
    parseSyntaxStylesheet(input, options.location),
    options,
  );
}

// CSS Syntax 3, 8.1. Parse a CSS stylesheet
export function interpretStylesheet(
  sheet: SyntaxStyleSheet,
  options: StyleSheetOptions = {},
): InterpretedStyleSheet {
  const rules: InterpretedRule[] = [];
  const location = options.location ?? sheet.location;

  for (const rule of sheet.rules) {
    const interpreted = interpretStylesheetRule(rule);
    if (interpreted !== null) rules.push(interpreted);
  }

  return {
    rules,
    ...(location === undefined ? {} : { location }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(sheet.originalText === undefined
      ? {}
      : { originalText: sheet.originalText }),
  };
}

function interpretStylesheetRule(rule: SyntaxRule): InterpretedRule | null {
  switch (rule.type) {
    case 'qualified-rule': return interpretStyleRule(rule);
    case 'statement-at-rule':
    case 'block-at-rule': return null;
  }
}

function interpretStyleBlockRule(
  rule: SyntaxRule,
  parentSelectors: SelectorList,
): StyleRule | null {
  switch (rule.type) {
    case 'qualified-rule': {
      const selectors = parseNestedSelectorList(
        rule.prelude,
        parentSelectors,
      );
      if (selectors === null) return null;

      return {
        type: 'style-rule',
        selectors,
        block: interpretStyleBlock(rule.block, selectors),
      };
    }

    case 'statement-at-rule':
    case 'block-at-rule':
      // No at-rules have interpreted representations yet. Section 8.1 requires
      // unrecognized at-rules to be discarded.
      return null;
  }
}

// CSS Syntax 3, 8.2. Style rules
function interpretStyleRule(rule: SyntaxQualifiedRule): StyleRule | null {
  const selectors = parseSelectorList(rule.prelude);
  if (selectors === null) return null;

  return {
    type: 'style-rule',
    selectors,
    block: interpretStyleBlock(rule.block, selectors),
  };
}

function interpretStyleBlock(
  block: SyntaxBlockContents,
  parentSelectors: SelectorList,
): StyleBlock {
  const result: StyleBlock = [];

  for (const item of block) {
    if (Array.isArray(item)) {
      for (const declaration of item) {
        const interpreted = interpretPropertyDeclaration(declaration);
        if (interpreted !== null) result.push(interpreted);
      }
      continue;
    }

    const rule = interpretStyleBlockRule(item, parentSelectors);
    if (rule !== null) result.push(rule);
  }

  return result;
}
