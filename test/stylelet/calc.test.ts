import { runScenarios } from '../dispatch';
import type {
  BrowserName,
  CaseStatus,
} from '../browser/harness/scenarios';

type CalcSerializationCase = {
  prop: string;
  decl: string;
  expect: string | null;
  browsers?: BrowserName[];
  status?: CaseStatus;
};

const serializations: CalcSerializationCase[] = [
  { prop: 'width', decl: 'calc(1vh + 2em + 3% + 4px)', expect: 'calc(3% + 2em + 4px + 1vh)' },
  { prop: 'width', decl: 'calc(1vh - 7px)', expect: 'calc(-7px + 1vh)' },
  { prop: 'width', decl: 'calc(min(1px, 2%))', expect: 'min(1px, 2%)' },
  { prop: 'width', decl: 'calc(1px - min(2px, 3%))', expect: 'calc(1px - min(2px, 3%))', browsers: ['chromium', 'webkit'] },
  { prop: 'width', decl: 'calc(1px - min(2px, 3%))', expect: 'calc(1px + max(-2px, -3%))', browsers: ['firefox'] },
  { prop: 'width', decl: 'calc(1px / min(2, 3))', expect: 'calc(0.5px)' },
  { prop: 'rotate', decl: 'calc(1turn + 90deg)', expect: 'calc(450deg)' },
  { prop: 'transition-duration', decl: 'calc(1s + 500ms)', expect: 'calc(1.5s)' },

  // Comparison functions
  { prop: 'width', decl: 'min(10px, 20px)', expect: 'calc(10px)' },
  { prop: 'width', decl: 'max(10px, 20px)', expect: 'calc(20px)' },
  { prop: 'width', decl: 'clamp(5px, 10px, 20px)', expect: 'calc(10px)' },
  { prop: 'width', decl: 'clamp(none, 10px, 20px)', expect: 'calc(10px)' },

  // Stepped value functions
  { prop: 'width', decl: 'round(nearest, 5.5px, 2px)', expect: 'calc(6px)' },
  { prop: 'width', decl: 'round(up, 5.5px, 2px)', expect: 'calc(6px)' },
  { prop: 'width', decl: 'mod(5px, 2px)', expect: 'calc(1px)' },
  { prop: 'width', decl: 'rem(5px, 2px)', expect: 'calc(1px)' },

  // Trigonometric functions
  { prop: 'width', decl: 'calc(100px * sin(30deg))', expect: 'calc(50px)' },
  { prop: 'width', decl: 'calc(100px * cos(60deg))', expect: 'calc(50px)' },
  { prop: 'width', decl: 'calc(100px * tan(45deg))', expect: 'calc(100px)' },
  { prop: 'rotate', decl: 'asin(0.5)', expect: 'calc(30deg)' },
  { prop: 'rotate', decl: 'acos(0.5)', expect: 'calc(60deg)' },
  { prop: 'rotate', decl: 'atan(1)', expect: 'calc(45deg)' },
  { prop: 'rotate', decl: 'atan2(1, 1)', expect: 'calc(45deg)' },

  // Exponential functions
  { prop: 'width', decl: 'calc(1px * pow(2, 3))', expect: 'calc(8px)' },
  { prop: 'width', decl: 'calc(1px * sqrt(9))', expect: 'calc(3px)' },
  { prop: 'width', decl: 'hypot(3px, 4px)', expect: 'calc(5px)' },
  { prop: 'width', decl: 'calc(1px * log(8, 2))', expect: 'calc(3px)' },
  { prop: 'width', decl: 'calc(1px * exp(1))', expect: 'calc(2.71828px)', browsers: ['chromium', 'firefox'] },
  { prop: 'width', decl: 'calc(1px * exp(1))', expect: 'calc(2.718282px)', browsers: ['webkit'] },

  // Sign-related functions
  { prop: 'width', decl: 'abs(-10px)', expect: 'calc(10px)' },
  { prop: 'width', decl: 'calc(10px * sign(-1))', expect: 'calc(-10px)' },
];

const sheetId = 'calc-serialization';

runScenarios('CSS calc serialization', 'normal', [
  {
    name: 'serializes specified calculations',
    // status: 'only',
    engines: ['native'],
    markup: `
      <style id="${sheetId}">
        ${serializations.map(({ prop, decl }, index) => (
          `#calc-${index} { ${prop}: ${decl}; }`
        )).join('\n')}
      </style>
    `,
    cases: serializations.map(({
      prop, expect, browsers, status,
    }, rule) => ({
      cssom: { target: 'style.property', rule, name: prop },
      ref: { by: 'id', id: sheetId },
      browsers,
      status,
      expect: {
        cssom: expect === null ? null : { value: expect },
      },
    })),
  },
]);
