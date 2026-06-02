import { runScenarios } from '../../../../../dispatch';

runScenarios('dir pseudo', 'normal', [
  {
    name: 'wpt input dir auto value-aware types use value direction',
    // status: 'only',
    markup: `
      <input id="hidden" type="hidden" dir="auto" value="א">
      <input id="text" type="text" dir="auto" value="א">
      <input id="search" type="search" dir="auto" value="א">
      <input id="tel" type="tel" dir="auto" value="א">
      <input id="url" type="url" dir="auto" value="א">
      <input id="email" type="email" dir="auto" value="א">
      <input id="password" type="password" dir="auto" value="א">
      <input id="submit" type="submit" dir="auto" value="א">
      <input id="reset" type="reset" dir="auto" value="א">
      <input id="button" type="button" dir="auto" value="א">
    `,
    cases: [
      { match: ':dir(rtl)', ref: { by: 'id', id: 'hidden' }, expect: { ids: ['hidden'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'text' }, expect: { ids: ['text'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'search' }, expect: { ids: ['search'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'tel' }, expect: { ids: ['tel'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'url' }, expect: { ids: ['url'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'email' }, expect: { ids: ['email'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'password' }, expect: { ids: ['password'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'submit' }, expect: { ids: ['submit'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'reset' }, expect: { ids: ['reset'] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'button' }, expect: { ids: ['button'] } },

      { match: ':dir(ltr)', ref: { by: 'id', id: 'hidden' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'text' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'search' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'tel' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'url' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'email' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'password' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'submit' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'reset' }, expect: { ids: [] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'button' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'wpt input dir auto value-ignoring types ignore value direction',
    // status: 'only',
    markup: `
      <input id="date" type="date" dir="auto" value="א">
      <input id="month" type="month" dir="auto" value="א">
      <input id="week" type="week" dir="auto" value="א">
      <input id="time" type="time" dir="auto" value="א">
      <input id="datetime-local" type="datetime-local" dir="auto" value="א">
      <input id="number" type="number" dir="auto" value="א">
      <input id="range" type="range" dir="auto" value="א">
      <input id="color" type="color" dir="auto" value="א">
      <input id="checkbox" type="checkbox" dir="auto" value="א">
      <input id="radio" type="radio" dir="auto" value="א">
      <input id="image" type="image" dir="auto" value="א">
    `,
    cases: [
      { match: ':dir(ltr)', ref: { by: 'id', id: 'date' }, expect: { ids: ['date'] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'date' }, expect: { ids: [] }, browsers: ['webkit'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'month' }, expect: { ids: ['month'] }, browsers: ['chromium'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'month' }, expect: { ids: [] }, browsers: ['firefox', 'webkit'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'week' }, expect: { ids: ['week'] }, browsers: ['chromium'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'week' }, expect: { ids: [] }, browsers: ['firefox', 'webkit'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'time' }, expect: { ids: ['time'] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'time' }, expect: { ids: [] }, browsers: ['webkit'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'datetime-local' }, expect: { ids: ['datetime-local'] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'datetime-local' }, expect: { ids: [] }, browsers: ['webkit'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'number' }, expect: { ids: ['number'] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'range' }, expect: { ids: ['range'] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'color' }, expect: { ids: ['color'] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'color' }, expect: { ids: [] }, browsers: ['webkit'] },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'checkbox' }, expect: { ids: ['checkbox'] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'radio' }, expect: { ids: ['radio'] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'image' }, expect: { ids: ['image'] } },

      { match: ':dir(rtl)', ref: { by: 'id', id: 'date' }, expect: { ids: [] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'date' }, expect: { ids: ['date'] }, browsers: ['webkit'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'month' }, expect: { ids: [] }, browsers: ['chromium'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'month' }, expect: { ids: ['month'] }, browsers: ['firefox', 'webkit'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'week' }, expect: { ids: [] }, browsers: ['chromium'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'week' }, expect: { ids: ['week'] }, browsers: ['firefox', 'webkit'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'time' }, expect: { ids: [] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'time' }, expect: { ids: ['time'] }, browsers: ['webkit'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'datetime-local' }, expect: { ids: [] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'datetime-local' }, expect: { ids: ['datetime-local'] }, browsers: ['webkit'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'number' }, expect: { ids: [] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'range' }, expect: { ids: [] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'color' }, expect: { ids: [] }, browsers: ['chromium', 'firefox'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'color' }, expect: { ids: ['color'] }, browsers: ['webkit'] },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'checkbox' }, expect: { ids: [] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'radio' }, expect: { ids: [] } },
      { match: ':dir(rtl)', ref: { by: 'id', id: 'image' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'wpt textarea dir auto uses value direction',
    // status: 'only',
    markup: `<textarea id="ta" dir="auto">ignored text node</textarea>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        (document.getElementById('ta') as HTMLTextAreaElement).value = 'א';
      });
    },
    cases: [
      { match: ':dir(rtl)', ref: { by: 'id', id: 'ta' }, expect: { ids: ['ta'] } },
      { match: ':dir(ltr)', ref: { by: 'id', id: 'ta' }, expect: { ids: [] } },
    ],
  },
]);
