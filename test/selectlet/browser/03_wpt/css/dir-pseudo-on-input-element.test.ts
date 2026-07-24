import { runScenarios } from '../../../dispatch';

runScenarios('dir pseudo', 'normal', [
  {
    name: 'wpt css dir pseudo on input type tel',
    // status: 'only',
    markup: `<input id="x" type="tel">`,
    steps: [
      {
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.setAttribute('dir', 'foo'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.setAttribute('dir', 'rtl'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.setAttribute('dir', 'RTL'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.setAttribute('dir', 'ltr'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.setAttribute('dir', 'LTR'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.setAttribute('dir', 'auto'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            (document.getElementById('x') as HTMLInputElement).value = '\u05EA';
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.setAttribute('dir', 'AUTO'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => document.getElementById('x')!.removeAttribute('dir'));
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'wpt css dir pseudo on input type tel in rtl block',
    // status: 'only',
    markup: `
      <div id="rtl-parent" dir="rtl">
        <input id="x" type="tel">
      </div>
    `,
    steps: [
      {
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { (document.getElementById('x') as HTMLInputElement).type = 'text'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { (document.getElementById('x') as HTMLInputElement).type = 'tel'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'wpt input dir auto value-aware types use value direction',
    // status: 'only',
    markup: `
      <div id="value-aware-initial">
        <input id="hidden-initial" type="hidden">
        <input id="text-initial" type="text">
        <input id="search-initial" type="search">
        <input id="tel-initial" type="tel">
        <input id="url-initial" type="url">
        <input id="email-initial" type="email">
        <input id="password-initial" type="password">
        <input id="submit-initial" type="submit">
        <input id="reset-initial" type="reset">
        <input id="button-initial" type="button">
      </div>

      <div id="value-aware-invalid">
        <input id="hidden-invalid" type="hidden" dir="foo">
        <input id="text-invalid" type="text" dir="foo">
        <input id="search-invalid" type="search" dir="foo">
        <input id="tel-invalid" type="tel" dir="foo">
        <input id="url-invalid" type="url" dir="foo">
        <input id="email-invalid" type="email" dir="foo">
        <input id="password-invalid" type="password" dir="foo">
        <input id="submit-invalid" type="submit" dir="foo">
        <input id="reset-invalid" type="reset" dir="foo">
        <input id="button-invalid" type="button" dir="foo">
      </div>

      <div id="value-aware-rtl">
        <input id="hidden-rtl" type="hidden" dir="rtl">
        <input id="text-rtl" type="text" dir="rtl">
        <input id="search-rtl" type="search" dir="rtl">
        <input id="tel-rtl" type="tel" dir="rtl">
        <input id="url-rtl" type="url" dir="rtl">
        <input id="email-rtl" type="email" dir="rtl">
        <input id="password-rtl" type="password" dir="rtl">
        <input id="submit-rtl" type="submit" dir="rtl">
        <input id="reset-rtl" type="reset" dir="rtl">
        <input id="button-rtl" type="button" dir="rtl">
      </div>

      <div id="value-aware-RTL">
        <input id="hidden-RTL" type="hidden" dir="RTL">
        <input id="text-RTL" type="text" dir="RTL">
        <input id="search-RTL" type="search" dir="RTL">
        <input id="tel-RTL" type="tel" dir="RTL">
        <input id="url-RTL" type="url" dir="RTL">
        <input id="email-RTL" type="email" dir="RTL">
        <input id="password-RTL" type="password" dir="RTL">
        <input id="submit-RTL" type="submit" dir="RTL">
        <input id="reset-RTL" type="reset" dir="RTL">
        <input id="button-RTL" type="button" dir="RTL">
      </div>

      <div id="value-aware-ltr">
        <input id="hidden-ltr" type="hidden" dir="ltr">
        <input id="text-ltr" type="text" dir="ltr">
        <input id="search-ltr" type="search" dir="ltr">
        <input id="tel-ltr" type="tel" dir="ltr">
        <input id="url-ltr" type="url" dir="ltr">
        <input id="email-ltr" type="email" dir="ltr">
        <input id="password-ltr" type="password" dir="ltr">
        <input id="submit-ltr" type="submit" dir="ltr">
        <input id="reset-ltr" type="reset" dir="ltr">
        <input id="button-ltr" type="button" dir="ltr">
      </div>

      <div id="value-aware-LTR">
        <input id="hidden-LTR" type="hidden" dir="LTR">
        <input id="text-LTR" type="text" dir="LTR">
        <input id="search-LTR" type="search" dir="LTR">
        <input id="tel-LTR" type="tel" dir="LTR">
        <input id="url-LTR" type="url" dir="LTR">
        <input id="email-LTR" type="email" dir="LTR">
        <input id="password-LTR" type="password" dir="LTR">
        <input id="submit-LTR" type="submit" dir="LTR">
        <input id="reset-LTR" type="reset" dir="LTR">
        <input id="button-LTR" type="button" dir="LTR">
      </div>

      <div id="value-aware-auto-empty">
        <input id="hidden-auto-empty" type="hidden" dir="auto">
        <input id="text-auto-empty" type="text" dir="auto">
        <input id="search-auto-empty" type="search" dir="auto">
        <input id="tel-auto-empty" type="tel" dir="auto">
        <input id="url-auto-empty" type="url" dir="auto">
        <input id="email-auto-empty" type="email" dir="auto">
        <input id="password-auto-empty" type="password" dir="auto">
        <input id="submit-auto-empty" type="submit" dir="auto">
        <input id="reset-auto-empty" type="reset" dir="auto">
        <input id="button-auto-empty" type="button" dir="auto">
      </div>

      <div id="value-aware-auto-rtl">
        <input id="hidden-auto-rtl" type="hidden" dir="auto" value="א">
        <input id="text-auto-rtl" type="text" dir="auto" value="א">
        <input id="search-auto-rtl" type="search" dir="auto" value="א">
        <input id="tel-auto-rtl" type="tel" dir="auto" value="א">
        <input id="url-auto-rtl" type="url" dir="auto" value="א">
        <input id="email-auto-rtl" type="email" dir="auto" value="א">
        <input id="password-auto-rtl" type="password" dir="auto" value="א">
        <input id="submit-auto-rtl" type="submit" dir="auto" value="א">
        <input id="reset-auto-rtl" type="reset" dir="auto" value="א">
        <input id="button-auto-rtl" type="button" dir="auto" value="א">
      </div>

      <div id="value-aware-AUTO-rtl">
        <input id="hidden-AUTO-rtl" type="hidden" dir="AUTO" value="א">
        <input id="text-AUTO-rtl" type="text" dir="AUTO" value="א">
        <input id="search-AUTO-rtl" type="search" dir="AUTO" value="א">
        <input id="tel-AUTO-rtl" type="tel" dir="AUTO" value="א">
        <input id="url-AUTO-rtl" type="url" dir="AUTO" value="א">
        <input id="email-AUTO-rtl" type="email" dir="AUTO" value="א">
        <input id="password-AUTO-rtl" type="password" dir="AUTO" value="א">
        <input id="submit-AUTO-rtl" type="submit" dir="AUTO" value="א">
        <input id="reset-AUTO-rtl" type="reset" dir="AUTO" value="א">
        <input id="button-AUTO-rtl" type="button" dir="AUTO" value="א">
      </div>
    `,
    cases: [
      { select: '#value-aware-initial > :dir(ltr)', expect: { ids: ['hidden-initial', 'text-initial', 'search-initial', 'tel-initial', 'url-initial', 'email-initial', 'password-initial', 'submit-initial', 'reset-initial', 'button-initial'] } },
      { select: '#value-aware-initial > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-aware-invalid > :dir(ltr)', expect: { ids: ['hidden-invalid', 'text-invalid', 'search-invalid', 'tel-invalid', 'url-invalid', 'email-invalid', 'password-invalid', 'submit-invalid', 'reset-invalid', 'button-invalid'] } },
      { select: '#value-aware-invalid > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-aware-rtl > :dir(ltr)', expect: { ids: [] } },
      { select: '#value-aware-rtl > :dir(rtl)', expect: { ids: ['hidden-rtl', 'text-rtl', 'search-rtl', 'tel-rtl', 'url-rtl', 'email-rtl', 'password-rtl', 'submit-rtl', 'reset-rtl', 'button-rtl'] } },

      { select: '#value-aware-RTL > :dir(ltr)', expect: { ids: [] } },
      { select: '#value-aware-RTL > :dir(rtl)', expect: { ids: ['hidden-RTL', 'text-RTL', 'search-RTL', 'tel-RTL', 'url-RTL', 'email-RTL', 'password-RTL', 'submit-RTL', 'reset-RTL', 'button-RTL'] } },

      { select: '#value-aware-ltr > :dir(ltr)', expect: { ids: ['hidden-ltr', 'text-ltr', 'search-ltr', 'tel-ltr', 'url-ltr', 'email-ltr', 'password-ltr', 'submit-ltr', 'reset-ltr', 'button-ltr'] } },
      { select: '#value-aware-ltr > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-aware-LTR > :dir(ltr)', expect: { ids: ['hidden-LTR', 'text-LTR', 'search-LTR', 'tel-LTR', 'url-LTR', 'email-LTR', 'password-LTR', 'submit-LTR', 'reset-LTR', 'button-LTR'] } },
      { select: '#value-aware-LTR > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-aware-auto-empty > :dir(ltr)', expect: { ids: ['hidden-auto-empty', 'text-auto-empty', 'search-auto-empty', 'tel-auto-empty', 'url-auto-empty', 'email-auto-empty', 'password-auto-empty', 'submit-auto-empty', 'reset-auto-empty', 'button-auto-empty'] } },
      { select: '#value-aware-auto-empty > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-aware-auto-rtl > :dir(ltr)', expect: { ids: [] } },
      { select: '#value-aware-auto-rtl > :dir(rtl)', expect: { ids: ['hidden-auto-rtl', 'text-auto-rtl', 'search-auto-rtl', 'tel-auto-rtl', 'url-auto-rtl', 'email-auto-rtl', 'password-auto-rtl', 'submit-auto-rtl', 'reset-auto-rtl', 'button-auto-rtl'] } },

      { select: '#value-aware-AUTO-rtl > :dir(ltr)', expect: { ids: [] } },
      { select: '#value-aware-AUTO-rtl > :dir(rtl)', expect: { ids: ['hidden-AUTO-rtl', 'text-AUTO-rtl', 'search-AUTO-rtl', 'tel-AUTO-rtl', 'url-AUTO-rtl', 'email-AUTO-rtl', 'password-AUTO-rtl', 'submit-AUTO-rtl', 'reset-AUTO-rtl', 'button-AUTO-rtl'] } },
    ],
  },

  {
    name: 'wpt css dir pseudo input dynamic type affects dir auto value',
    // status: 'only',
    markup: `<input id="x" type="text" dir="auto" value="\u05EA">`,
    steps: [
      {
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { (document.getElementById('x') as HTMLInputElement).type = 'radio'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { (document.getElementById('x') as HTMLInputElement).type = 'text'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
    ],
  },

  {
    name: 'wpt input dir auto value-ignoring types ignore value direction',
    // status: 'only',
    markup: `
      <div id="value-ignoring-initial">
        <input id="date-initial" type="date">
        <input id="month-initial" type="month">
        <input id="week-initial" type="week">
        <input id="time-initial" type="time">
        <input id="datetime-local-initial" type="datetime-local">
        <input id="number-initial" type="number">
        <input id="range-initial" type="range">
        <input id="color-initial" type="color">
        <input id="checkbox-initial" type="checkbox">
        <input id="radio-initial" type="radio">
        <input id="image-initial" type="image">
      </div>

      <div id="value-ignoring-invalid">
        <input id="date-invalid" type="date" dir="foo">
        <input id="month-invalid" type="month" dir="foo">
        <input id="week-invalid" type="week" dir="foo">
        <input id="time-invalid" type="time" dir="foo">
        <input id="datetime-local-invalid" type="datetime-local" dir="foo">
        <input id="number-invalid" type="number" dir="foo">
        <input id="range-invalid" type="range" dir="foo">
        <input id="color-invalid" type="color" dir="foo">
        <input id="checkbox-invalid" type="checkbox" dir="foo">
        <input id="radio-invalid" type="radio" dir="foo">
        <input id="image-invalid" type="image" dir="foo">
      </div>

      <div id="value-ignoring-rtl">
        <input id="date-rtl" type="date" dir="rtl">
        <input id="month-rtl" type="month" dir="rtl">
        <input id="week-rtl" type="week" dir="rtl">
        <input id="time-rtl" type="time" dir="rtl">
        <input id="datetime-local-rtl" type="datetime-local" dir="rtl">
        <input id="number-rtl" type="number" dir="rtl">
        <input id="range-rtl" type="range" dir="rtl">
        <input id="color-rtl" type="color" dir="rtl">
        <input id="checkbox-rtl" type="checkbox" dir="rtl">
        <input id="radio-rtl" type="radio" dir="rtl">
        <input id="image-rtl" type="image" dir="rtl">
      </div>

      <div id="value-ignoring-RTL">
        <input id="date-RTL" type="date" dir="RTL">
        <input id="month-RTL" type="month" dir="RTL">
        <input id="week-RTL" type="week" dir="RTL">
        <input id="time-RTL" type="time" dir="RTL">
        <input id="datetime-local-RTL" type="datetime-local" dir="RTL">
        <input id="number-RTL" type="number" dir="RTL">
        <input id="range-RTL" type="range" dir="RTL">
        <input id="color-RTL" type="color" dir="RTL">
        <input id="checkbox-RTL" type="checkbox" dir="RTL">
        <input id="radio-RTL" type="radio" dir="RTL">
        <input id="image-RTL" type="image" dir="RTL">
      </div>

      <div id="value-ignoring-ltr">
        <input id="date-ltr" type="date" dir="ltr">
        <input id="month-ltr" type="month" dir="ltr">
        <input id="week-ltr" type="week" dir="ltr">
        <input id="time-ltr" type="time" dir="ltr">
        <input id="datetime-local-ltr" type="datetime-local" dir="ltr">
        <input id="number-ltr" type="number" dir="ltr">
        <input id="range-ltr" type="range" dir="ltr">
        <input id="color-ltr" type="color" dir="ltr">
        <input id="checkbox-ltr" type="checkbox" dir="ltr">
        <input id="radio-ltr" type="radio" dir="ltr">
        <input id="image-ltr" type="image" dir="ltr">
      </div>

      <div id="value-ignoring-LTR">
        <input id="date-LTR" type="date" dir="LTR">
        <input id="month-LTR" type="month" dir="LTR">
        <input id="week-LTR" type="week" dir="LTR">
        <input id="time-LTR" type="time" dir="LTR">
        <input id="datetime-local-LTR" type="datetime-local" dir="LTR">
        <input id="number-LTR" type="number" dir="LTR">
        <input id="range-LTR" type="range" dir="LTR">
        <input id="color-LTR" type="color" dir="LTR">
        <input id="checkbox-LTR" type="checkbox" dir="LTR">
        <input id="radio-LTR" type="radio" dir="LTR">
        <input id="image-LTR" type="image" dir="LTR">
      </div>

      <div id="value-ignoring-auto-empty">
        <input id="date-auto-empty" type="date" dir="auto">
        <input id="month-auto-empty" type="month" dir="auto">
        <input id="week-auto-empty" type="week" dir="auto">
        <input id="time-auto-empty" type="time" dir="auto">
        <input id="datetime-local-auto-empty" type="datetime-local" dir="auto">
        <input id="number-auto-empty" type="number" dir="auto">
        <input id="range-auto-empty" type="range" dir="auto">
        <input id="color-auto-empty" type="color" dir="auto">
        <input id="checkbox-auto-empty" type="checkbox" dir="auto">
        <input id="radio-auto-empty" type="radio" dir="auto">
        <input id="image-auto-empty" type="image" dir="auto">
      </div>

      <div id="value-ignoring-auto-rtl-value">
        <input id="date-auto-rtl-value" type="date" dir="auto" value="א">
        <input id="month-auto-rtl-value" type="month" dir="auto" value="א">
        <input id="week-auto-rtl-value" type="week" dir="auto" value="א">
        <input id="time-auto-rtl-value" type="time" dir="auto" value="א">
        <input id="datetime-local-auto-rtl-value" type="datetime-local" dir="auto" value="א">
        <input id="number-auto-rtl-value" type="number" dir="auto" value="א">
        <input id="range-auto-rtl-value" type="range" dir="auto" value="א">
        <input id="color-auto-rtl-value" type="color" dir="auto" value="א">
        <input id="checkbox-auto-rtl-value" type="checkbox" dir="auto" value="א">
        <input id="radio-auto-rtl-value" type="radio" dir="auto" value="א">
        <input id="image-auto-rtl-value" type="image" dir="auto" value="א">
      </div>

      <div id="value-ignoring-AUTO-rtl-value">
        <input id="date-AUTO-rtl-value" type="date" dir="AUTO" value="א">
        <input id="month-AUTO-rtl-value" type="month" dir="AUTO" value="א">
        <input id="week-AUTO-rtl-value" type="week" dir="AUTO" value="א">
        <input id="time-AUTO-rtl-value" type="time" dir="AUTO" value="א">
        <input id="datetime-local-AUTO-rtl-value" type="datetime-local" dir="AUTO" value="א">
        <input id="number-AUTO-rtl-value" type="number" dir="AUTO" value="א">
        <input id="range-AUTO-rtl-value" type="range" dir="AUTO" value="א">
        <input id="color-AUTO-rtl-value" type="color" dir="AUTO" value="א">
        <input id="checkbox-AUTO-rtl-value" type="checkbox" dir="AUTO" value="א">
        <input id="radio-AUTO-rtl-value" type="radio" dir="AUTO" value="א">
        <input id="image-AUTO-rtl-value" type="image" dir="AUTO" value="א">
      </div>

      <div id="value-ignoring-removed">
        <input id="date-removed" type="date" value="א">
        <input id="month-removed" type="month" value="א">
        <input id="week-removed" type="week" value="א">
        <input id="time-removed" type="time" value="א">
        <input id="datetime-local-removed" type="datetime-local" value="א">
        <input id="number-removed" type="number" value="א">
        <input id="range-removed" type="range" value="א">
        <input id="color-removed" type="color" value="א">
        <input id="checkbox-removed" type="checkbox" value="א">
        <input id="radio-removed" type="radio" value="א">
        <input id="image-removed" type="image" value="א">
      </div>

      <div id="value-ignoring-auto-in-rtl-parent" dir="rtl">
        <input id="date-auto-in-rtl-parent" type="date" dir="auto" value="א">
        <input id="month-auto-in-rtl-parent" type="month" dir="auto" value="א">
        <input id="week-auto-in-rtl-parent" type="week" dir="auto" value="א">
        <input id="time-auto-in-rtl-parent" type="time" dir="auto" value="א">
        <input id="datetime-local-auto-in-rtl-parent" type="datetime-local" dir="auto" value="א">
        <input id="number-auto-in-rtl-parent" type="number" dir="auto" value="א">
        <input id="range-auto-in-rtl-parent" type="range" dir="auto" value="א">
        <input id="color-auto-in-rtl-parent" type="color" dir="auto" value="א">
        <input id="checkbox-auto-in-rtl-parent" type="checkbox" dir="auto" value="א">
        <input id="radio-auto-in-rtl-parent" type="radio" dir="auto" value="א">
        <input id="image-auto-in-rtl-parent" type="image" dir="auto" value="א">
      </div>
    `,
    cases: [
      { select: '#value-ignoring-initial > :dir(ltr)', expect: { ids: ['date-initial', 'month-initial', 'week-initial', 'time-initial', 'datetime-local-initial', 'number-initial', 'range-initial', 'color-initial', 'checkbox-initial', 'radio-initial', 'image-initial'] } },
      { select: '#value-ignoring-initial > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-ignoring-invalid > :dir(ltr)', expect: { ids: ['date-invalid', 'month-invalid', 'week-invalid', 'time-invalid', 'datetime-local-invalid', 'number-invalid', 'range-invalid', 'color-invalid', 'checkbox-invalid', 'radio-invalid', 'image-invalid'] } },
      { select: '#value-ignoring-invalid > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-ignoring-rtl > :dir(ltr)', expect: { ids: [] } },
      { select: '#value-ignoring-rtl > :dir(rtl)', expect: { ids: ['date-rtl', 'month-rtl', 'week-rtl', 'time-rtl', 'datetime-local-rtl', 'number-rtl', 'range-rtl', 'color-rtl', 'checkbox-rtl', 'radio-rtl', 'image-rtl'] } },

      { select: '#value-ignoring-RTL > :dir(ltr)', expect: { ids: [] } },
      { select: '#value-ignoring-RTL > :dir(rtl)', expect: { ids: ['date-RTL', 'month-RTL', 'week-RTL', 'time-RTL', 'datetime-local-RTL', 'number-RTL', 'range-RTL', 'color-RTL', 'checkbox-RTL', 'radio-RTL', 'image-RTL'] } },

      { select: '#value-ignoring-ltr > :dir(ltr)', expect: { ids: ['date-ltr', 'month-ltr', 'week-ltr', 'time-ltr', 'datetime-local-ltr', 'number-ltr', 'range-ltr', 'color-ltr', 'checkbox-ltr', 'radio-ltr', 'image-ltr'] } },
      { select: '#value-ignoring-ltr > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-ignoring-LTR > :dir(ltr)', expect: { ids: ['date-LTR', 'month-LTR', 'week-LTR', 'time-LTR', 'datetime-local-LTR', 'number-LTR', 'range-LTR', 'color-LTR', 'checkbox-LTR', 'radio-LTR', 'image-LTR'] } },
      { select: '#value-ignoring-LTR > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-ignoring-auto-empty > :dir(ltr)', expect: { ids: ['date-auto-empty', 'month-auto-empty', 'week-auto-empty', 'time-auto-empty', 'datetime-local-auto-empty', 'number-auto-empty', 'range-auto-empty', 'color-auto-empty', 'checkbox-auto-empty', 'radio-auto-empty', 'image-auto-empty'] } },
      { select: '#value-ignoring-auto-empty > :dir(rtl)', expect: { ids: [] } },

      { select: '#value-ignoring-auto-rtl-value > :dir(ltr)', expect: { ids: ['date-auto-rtl-value', 'month-auto-rtl-value', 'week-auto-rtl-value', 'time-auto-rtl-value', 'datetime-local-auto-rtl-value', 'number-auto-rtl-value', 'range-auto-rtl-value', 'color-auto-rtl-value', 'checkbox-auto-rtl-value', 'radio-auto-rtl-value', 'image-auto-rtl-value'] }, browsers: ['chromium'] },
      { select: '#value-ignoring-auto-rtl-value > :dir(ltr)', expect: { ids: ['date-auto-rtl-value', 'time-auto-rtl-value', 'datetime-local-auto-rtl-value', 'number-auto-rtl-value', 'range-auto-rtl-value', 'color-auto-rtl-value', 'checkbox-auto-rtl-value', 'radio-auto-rtl-value', 'image-auto-rtl-value'] }, browsers: ['firefox'] },
      { select: '#value-ignoring-auto-rtl-value > :dir(ltr)', expect: { ids: ['number-auto-rtl-value', 'range-auto-rtl-value', 'checkbox-auto-rtl-value', 'radio-auto-rtl-value', 'image-auto-rtl-value'] }, browsers: ['webkit'] },
      { select: '#value-ignoring-auto-rtl-value > :dir(rtl)', expect: { ids: [] }, browsers: ['chromium'] },
      { select: '#value-ignoring-auto-rtl-value > :dir(rtl)', expect: { ids: ['month-auto-rtl-value', 'week-auto-rtl-value'] }, browsers: ['firefox'] },
      { select: '#value-ignoring-auto-rtl-value > :dir(rtl)', expect: { ids: ['date-auto-rtl-value', 'month-auto-rtl-value', 'week-auto-rtl-value', 'time-auto-rtl-value', 'datetime-local-auto-rtl-value', 'color-auto-rtl-value'] }, browsers: ['webkit'] },

      { select: '#value-ignoring-AUTO-rtl-value > :dir(ltr)', expect: { ids: ['date-AUTO-rtl-value', 'month-AUTO-rtl-value', 'week-AUTO-rtl-value', 'time-AUTO-rtl-value', 'datetime-local-AUTO-rtl-value', 'number-AUTO-rtl-value', 'range-AUTO-rtl-value', 'color-AUTO-rtl-value', 'checkbox-AUTO-rtl-value', 'radio-AUTO-rtl-value', 'image-AUTO-rtl-value'] }, browsers: ['chromium'] },
      { select: '#value-ignoring-AUTO-rtl-value > :dir(ltr)', expect: { ids: ['date-AUTO-rtl-value', 'time-AUTO-rtl-value', 'datetime-local-AUTO-rtl-value', 'number-AUTO-rtl-value', 'range-AUTO-rtl-value', 'color-AUTO-rtl-value', 'checkbox-AUTO-rtl-value', 'radio-AUTO-rtl-value', 'image-AUTO-rtl-value'] }, browsers: ['firefox'] },
      { select: '#value-ignoring-AUTO-rtl-value > :dir(ltr)', expect: { ids: ['number-AUTO-rtl-value', 'range-AUTO-rtl-value', 'checkbox-AUTO-rtl-value', 'radio-AUTO-rtl-value', 'image-AUTO-rtl-value'] }, browsers: ['webkit'] },
      { select: '#value-ignoring-AUTO-rtl-value > :dir(rtl)', expect: { ids: [] }, browsers: ['chromium'] },
      { select: '#value-ignoring-AUTO-rtl-value > :dir(rtl)', expect: { ids: ['month-AUTO-rtl-value', 'week-AUTO-rtl-value'] }, browsers: ['firefox'] },
      { select: '#value-ignoring-AUTO-rtl-value > :dir(rtl)', expect: { ids: ['date-AUTO-rtl-value', 'month-AUTO-rtl-value', 'week-AUTO-rtl-value', 'time-AUTO-rtl-value', 'datetime-local-AUTO-rtl-value', 'color-AUTO-rtl-value'] }, browsers: ['webkit'] },

      { select: '#value-ignoring-removed > :dir(ltr)', expect: { ids: ['date-removed', 'month-removed', 'week-removed', 'time-removed', 'datetime-local-removed', 'number-removed', 'range-removed', 'color-removed', 'checkbox-removed', 'radio-removed', 'image-removed'] }, browsers: ['chromium', 'firefox', 'webkit'] },
      { select: '#value-ignoring-removed > :dir(rtl)', expect: { ids: [] }, browsers: ['chromium', 'firefox', 'webkit'] },

      { select: '#value-ignoring-auto-in-rtl-parent > :dir(ltr)', expect: { ids: ['date-auto-in-rtl-parent', 'month-auto-in-rtl-parent', 'week-auto-in-rtl-parent', 'time-auto-in-rtl-parent', 'datetime-local-auto-in-rtl-parent', 'number-auto-in-rtl-parent', 'range-auto-in-rtl-parent', 'color-auto-in-rtl-parent', 'checkbox-auto-in-rtl-parent', 'radio-auto-in-rtl-parent', 'image-auto-in-rtl-parent'] }, browsers: ['chromium'] },
      { select: '#value-ignoring-auto-in-rtl-parent > :dir(ltr)', expect: { ids: ['date-auto-in-rtl-parent', 'time-auto-in-rtl-parent', 'datetime-local-auto-in-rtl-parent', 'number-auto-in-rtl-parent', 'range-auto-in-rtl-parent', 'color-auto-in-rtl-parent', 'checkbox-auto-in-rtl-parent', 'radio-auto-in-rtl-parent', 'image-auto-in-rtl-parent'] }, browsers: ['firefox'] },
      { select: '#value-ignoring-auto-in-rtl-parent > :dir(ltr)', expect: { ids: ['number-auto-in-rtl-parent', 'range-auto-in-rtl-parent', 'checkbox-auto-in-rtl-parent', 'radio-auto-in-rtl-parent', 'image-auto-in-rtl-parent'] }, browsers: ['webkit'] },
      { select: '#value-ignoring-auto-in-rtl-parent > :dir(rtl)', expect: { ids: [] }, browsers: ['chromium'] },
      { select: '#value-ignoring-auto-in-rtl-parent > :dir(rtl)', expect: { ids: ['month-auto-in-rtl-parent', 'week-auto-in-rtl-parent'] }, browsers: ['firefox'] },
      { select: '#value-ignoring-auto-in-rtl-parent > :dir(rtl)', expect: { ids: ['date-auto-in-rtl-parent', 'month-auto-in-rtl-parent', 'week-auto-in-rtl-parent', 'time-auto-in-rtl-parent', 'datetime-local-auto-in-rtl-parent', 'color-auto-in-rtl-parent'] }, browsers: ['webkit'] },
    ],
  },

]);
