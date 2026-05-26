import { runScenarios } from '../harness/scenarios';

runScenarios('pseudo-form', 'normal', [
  {
    name: 'input state enabled includes option and optgroup',
    // status: 'only',
    markup: `
      <select id="select">
        <optgroup id="group">
          <option id="option">x</option>
        </optgroup>
      </select>
    `,
    cases: [
      { select: '#select:enabled', expect: { ids: ['select'] } },
      { select: '#group:enabled', expect: { ids: ['group'] } },
      { select: '#option:enabled', expect: { ids: ['option'] } },
    ],
  },

  {
    name: 'input state enabled respects disabled fieldset',
    // status: 'only',
    markup: `
      <fieldset id="fs" disabled>
        <input id="inside">
        <button id="button">x</button>
      </fieldset>
      <input id="outside">
    `,
    cases: [
      { select: '#inside:enabled', expect: { ids: [] } },
      { select: '#button:enabled', expect: { ids: [] } },
      { select: '#outside:enabled', expect: { ids: ['outside'] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
      { select: '#button:disabled', expect: { ids: ['button'] } },
    ],
  },

  {
    name: 'input state disabled fieldset first legend exception',
    // status: 'only',
    markup: `
      <fieldset id="fs" disabled>
        <legend id="legend">
          <input id="legendInput">
        </legend>
        <input id="inside">
      </fieldset>
    `,
    cases: [
      { select: '#legendInput:enabled', expect: { ids: ['legendInput'] } },
      { select: '#legendInput:disabled', expect: { ids: [] } },
      { select: '#inside:enabled', expect: { ids: [] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'input state disabled fieldset only first legend excepted',
    // status: 'only',
    markup: `
      <fieldset disabled>
        <legend id="first"><input id="firstInput"></legend>
        <legend id="second"><input id="secondInput"></legend>
        <input id="inside">
      </fieldset>
    `,
    cases: [
      { select: '#firstInput:enabled', expect: { ids: ['firstInput'] } },
      { select: '#firstInput:disabled', expect: { ids: [] } },
      { select: '#secondInput:enabled', expect: { ids: [] } },
      { select: '#secondInput:disabled', expect: { ids: ['secondInput'] } },
      { select: '#inside:enabled', expect: { ids: [] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'input state disabled fieldset legend exception is scoped',
    // status: 'only',
    markup: `
      <fieldset id="outer" disabled>
        <fieldset id="inner">
          <legend id="innerLegend">
            <input id="innerLegendInput">
          </legend>
        </fieldset>
        <legend id="outerLegend">
          <input id="outerLegendInput">
        </legend>
      </fieldset>
    `,
    cases: [
      // Inner fieldset legend does not exempt from outer disabled fieldset.
      { select: '#innerLegendInput:disabled', expect: { ids: ['innerLegendInput'] } },
      { select: '#innerLegendInput:enabled', expect: { ids: [] } },
      { select: '#outerLegendInput:disabled', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state disabled fieldset only first direct legend is excepted',
    // status: 'only',
    markup: `
      <fieldset id="outer" disabled>
        <legend id="firstLegend">
          <input id="firstLegendInput">
        </legend>
        <legend id="secondLegend">
          <input id="secondLegendInput">
        </legend>
      </fieldset>
    `,
    cases: [
      { select: '#firstLegendInput:disabled', expect: { ids: [] } },
      { select: '#secondLegendInput:disabled', expect: { ids: ['secondLegendInput'] } },
    ],
  },

  {
    name: 'input state disabled fieldset first legend exception still applies',
    // status: 'only',
    markup: `
      <fieldset id="outer" disabled>
        <legend id="outerLegend">
          <input id="outerLegendInput">
        </legend>
        <input id="inside">
      </fieldset>
    `,
    cases: [
      { select: '#outerLegendInput:disabled', expect: { ids: [] } },
      { select: '#inside:disabled', expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'input state read-write respects disabled fieldset',
    // status: 'only',
    markup: `
      <fieldset disabled>
        <input id="inside" value="x">
        <textarea id="text"></textarea>
      </fieldset>
      <input id="outside" value="x">
    `,
    cases: [
      { select: '#inside:read-only', expect: { ids: ['inside'] } },
      { select: '#inside:read-write', expect: { ids: [] } },
      { select: '#text:read-only', expect: { ids: ['text'] } },
      { select: '#text:read-write', expect: { ids: [] } },
      { select: '#outside:read-only', expect: { ids: [] } },
      { select: '#outside:read-write', expect: { ids: ['outside'] } },
    ],
  },

  {
    name: 'input state read-only read-write input types',
    // status: 'only',
    markup: `
      <input id="text" type="text">
      <input id="email" type="email">
      <input id="checkbox" type="checkbox">
      <input id="range" type="range">
      <input id="file" type="file">
      <input id="button" type="button">
    `,
    cases: [
      { select: '#text:read-write', expect: { ids: ['text'] } },
      { select: '#email:read-write', expect: { ids: ['email'] } },

      { select: '#checkbox:read-only', expect: { ids: ['checkbox'] } },
      { select: '#range:read-only', expect: { ids: ['range'] } },
      { select: '#file:read-only', expect: { ids: ['file'] } },
      { select: '#button:read-only', expect: { ids: ['button'] } },
    ],
  },

  {
    name: 'input state read-write follows contenteditable inheritance',
    // status: 'only',
    markup: `
      <div id="outer" contenteditable>
        <p id="inner"></p>
      </div>
      <div id="plain"></div>
    `,
    cases: [
      { select: '#outer:read-write', expect: { ids: ['outer'] } },
      { select: '#inner:read-write', expect: { ids: ['inner'] } },
      { select: '#plain:read-only', expect: { ids: ['plain'] } },
    ],
  },

  {
    name: 'input state read-only respects contenteditable false',
    // status: 'only',
    markup: `
      <div id="outer" contenteditable>
        <p id="editable"></p>
        <p id="notEditable" contenteditable="false"></p>
      </div>
    `,
    cases: [
      { select: '#editable:read-write', expect: { ids: ['editable'] } },
      { select: '#notEditable:read-only', expect: { ids: ['notEditable'] } },
      { select: '#notEditable:read-write', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state read-only read-write readonly controls',
    // status: 'only',
    markup: `
      <input id="input" readonly>
      <textarea id="textarea" readonly></textarea>
      <input id="normal">
    `,
    cases: [
      { select: '#input:read-only', expect: { ids: ['input'] } },
      { select: '#input:read-write', expect: { ids: [] } },
      { select: '#textarea:read-only', expect: { ids: ['textarea'] } },
      { select: '#textarea:read-write', expect: { ids: [] } },
      { select: '#normal:read-write', expect: { ids: ['normal'] } },
    ],
  },

  {
    name: 'input state disabled option follows disabled optgroup',
    // status: 'only',
    markup: `
      <select id="select">
        <optgroup id="group" disabled>
          <option id="option">x</option>
        </optgroup>
      </select>`,
    cases: [
      { select: '#group:disabled', expect: { ids: ['group'] } },
      { select: '#option:disabled', expect: { ids: ['option'] } },
      { select: '#option:enabled', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state placeholder-shown matches focused empty input',
    // status: 'only',
    markup: `<input id="x" placeholder="name"><input id="other">`,
    setupPage: async (page) => {
      await page.locator('#x').focus();
    },
    cases: [
      { select: '#x:focus', expect: { ids: ['x'] } },
      { select: '#x:placeholder-shown', expect: { ids: ['x'] } },
    ],
  },

  {
    name: 'input state placeholder-shown does not match non-empty values',
    // status: 'only',
    markup: `
      <input id="empty" placeholder="name">
      <input id="filled" placeholder="name" value="Eric">
      <textarea id="textEmpty" placeholder="text"></textarea>
      <textarea id="textFilled" placeholder="text">hello</textarea>
    `,
    cases: [
      { select: '#empty:placeholder-shown', expect: { ids: ['empty'] } },
      { select: '#filled:placeholder-shown', expect: { ids: [] } },
      { select: '#textEmpty:placeholder-shown', expect: { ids: ['textEmpty'] } },
      { select: '#textFilled:placeholder-shown', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state placeholder-shown empty placeholder attribute',
    // status: 'only',
    markup: `<input id="x" placeholder="">`,
    cases: [
      { select: '#x:placeholder-shown', expect: { ids: ['x'] }, browsers: ['chromium', 'firefox'] },
      { select: '#x:placeholder-shown', expect: { ids: [] }, browsers: ['webkit'], status: 'fail' }, // webkit does not consider empty placeholder to be "shown"
    ],
  },

  {
    name: 'input state default matches first submit button element',
    // status: 'only',
    markup: `
      <form id="form">
        <button id="first">first</button>
        <button id="second" type="submit">second</button>
        <input id="input" type="submit">
      </form>
    `,
    cases: [
      { select: '#first:default', expect: { ids: ['first'] } },
      { select: '#second:default', expect: { ids: [] } },
      { select: '#input:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default ignores non-submit buttons',
    // status: 'only',
    markup: `
      <form id="form">
        <button id="plainButton" type="button">button</button>
        <input id="submit" type="submit">
      </form>
    `,
    cases: [
      { select: '#plainButton:default', expect: { ids: [] } },
      { select: '#submit:default', expect: { ids: ['submit'] } },
    ],
  },

  {
    name: 'input state default includes image submit controls',
    // status: 'only',
    markup: `
      <form id="form">
        <input id="image" type="image" alt="go">
        <input id="submit" type="submit">
      </form>
    `,
    cases: [
      { select: '#image:default', expect: { ids: ['image'] } },
      { select: '#submit:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default submit precedes image submit',
    // status: 'only',
    markup: `
      <form id="form">
        <input id="submit" type="submit">
        <input id="image" type="image" alt="go">
      </form>
    `,
    cases: [
      { select: '#submit:default', expect: { ids: ['submit'] } },
      { select: '#image:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default matches default checked controls',
    // status: 'only',
    markup: `
      <input id="checkedBox" type="checkbox" checked>
      <input id="uncheckedBox" type="checkbox">
      <input id="checkedRadio" type="radio" name="r" checked>
      <input id="uncheckedRadio" type="radio" name="r">
    `,
    cases: [
      { select: '#checkedBox:default', expect: { ids: ['checkedBox'] } },
      { select: '#uncheckedBox:default', expect: { ids: [] } },
      { select: '#checkedRadio:default', expect: { ids: ['checkedRadio'] } },
      { select: '#uncheckedRadio:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default uses option default selectedness',
    // status: 'only',
    markup: `
      <select id="selectedSelect">
        <option id="first">first</option>
        <option id="selected" selected>selected</option>
      </select>
      <select id="autoSelect">
        <option id="autoFirst">auto first</option>
        <option id="autoSecond">auto second</option>
      </select>
    `,
    cases: [
      { select: '#first:default', expect: { ids: [] } },
      { select: '#selected:default', expect: { ids: ['selected'] } },
      { select: '#autoFirst:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default includes form-associated submit outside form',
    // status: 'only',
    markup: `
      <input id="outside" type="submit" form="form">
      <form id="form">
        <input id="inside" type="submit">
      </form>
    `,
    cases: [
      { select: '#outside:default', expect: { ids: ['outside'] } },
      { select: '#inside:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input state default includes outside image submit',
    // status: 'only',
    markup: `
      <input id="outsideImage" type="image" form="form" alt="go">
      <form id="form">
        <input id="insideSubmit" type="submit">
      </form>
    `,
    cases: [
      { select: '#outsideImage:default', expect: { ids: ['outsideImage'] } },
      { select: '#insideSubmit:default', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value checked matches checked controls and selected options',
    // status: 'only',
    markup: `
      <input id="checkedBox" type="checkbox" checked>
      <input id="uncheckedBox" type="checkbox">
      <input id="checkedRadio" type="radio" name="r" checked>
      <input id="uncheckedRadio" type="radio" name="r">
      <select>
        <option id="unselected">a</option>
        <option id="selected" selected>b</option>
      </select>
    `,
    cases: [
      { select: '#checkedBox:checked', expect: { ids: ['checkedBox'] } },
      { select: '#uncheckedBox:checked', expect: { ids: [] } },
      { select: '#checkedRadio:checked', expect: { ids: ['checkedRadio'] } },
      { select: '#uncheckedRadio:checked', expect: { ids: [] } },
      { select: '#selected:checked', expect: { ids: ['selected'] } },
      { select: '#unselected:checked', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value checked follows current option selectedness',
    // status: 'only',
    markup: `
      <select>
        <option id="first" selected>first</option>
        <option id="second">second</option>
      </select>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const first = document.getElementById('first') as HTMLOptionElement;
        const second = document.getElementById('second') as HTMLOptionElement;
        first.selected = false;
        second.selected = true;
      });
    },
    cases: [
      { select: '#first:checked', expect: { ids: [] } },
      { select: '#second:checked', expect: { ids: ['second'] } },
    ],
  },

  {
    name: 'input value checked excludes non-checkable input types',
    // status: 'only',
    markup: `
      <input id="text" type="text">
      <input id="button" type="button">
      <input id="hidden" type="hidden">
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        for (const id of ['text', 'button', 'hidden']) {
          (document.getElementById(id) as HTMLInputElement).checked = true;
        }
      });
    },
    cases: [
      { select: '#text:checked', expect: { ids: [] } },
      { select: '#button:checked', expect: { ids: [] } },
      { select: '#hidden:checked', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value checked matches auto-selected first option',
    // status: 'only',
    markup: `
      <select>
        <option id="first">first</option>
        <option id="second">second</option>
      </select>
    `,
    cases: [
      { select: '#first:checked', expect: { ids: ['first'] } },
      { select: '#second:checked', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate matches progress and checkbox states',
    // status: 'only',
    markup: `
      <progress id="progressNoValue"></progress>
      <progress id="progressValue" value="0.5"></progress>
      <input id="box" type="checkbox">
      <input id="plainBox" type="checkbox">
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        (document.getElementById('box') as HTMLInputElement).indeterminate = true;
      });
    },
    cases: [
      { select: '#progressNoValue:indeterminate', expect: { ids: ['progressNoValue'] } },
      { select: '#progressValue:indeterminate', expect: { ids: [] } },
      { select: '#box:indeterminate', expect: { ids: ['box'] } },
      { select: '#plainBox:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate radio group outside form',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="r">
      <input id="b" type="radio" name="r">
      <input id="other" type="radio" name="other" checked>
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: ['a'] } },
      { select: '#b:indeterminate', expect: { ids: ['b'] } },
      { select: '#other:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate radio group outside form with checked member',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="r">
      <input id="b" type="radio" name="r" checked>
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: [] } },
      { select: '#b:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value indeterminate radio name does not use raw selector text',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="a b">
      <input id="b" type="radio" name="a b">
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: ['a'] } },
      { select: '#b:indeterminate', expect: { ids: ['b'] } },
    ],
  },

  {
    name: 'input value indeterminate radio name with selector syntax',
    // status: 'only',
    markup: `
      <input id="a" type="radio" name="x]y">
      <input id="b" type="radio" name="x]y">
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: ['a'] } },
      { select: '#b:indeterminate', expect: { ids: ['b'] } },
    ],
  },

  {
    name: 'input value indeterminate radio group uses form owner',
    // status: 'only',
    markup: `
      <input id="outsideA" type="radio" name="r" form="f">
      <form id="f">
        <input id="insideB" type="radio" name="r">
      </form>
    `,
    cases: [
      { select: '#outsideA:indeterminate', expect: { ids: ['outsideA'] } },
      { select: '#insideB:indeterminate', expect: { ids: ['insideB'] } },
    ],
  },

  {
    name: 'input value indeterminate radio group form owner with checked member',
    // status: 'only',
    markup: `
      <input id="outsideA" type="radio" name="r" form="f" checked>
      <form id="f">
        <input id="insideB" type="radio" name="r">
      </form>
    `,
    cases: [
      { select: '#outsideA:indeterminate', expect: { ids: [] } },
      { select: '#insideB:indeterminate', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value required excludes unsupported input types',
    // status: 'only',
    markup: `
      <input id="text" type="text" required>
      <input id="hidden" type="hidden" required>
      <input id="button" type="button" required>
      <input id="submit" type="submit" required>
      <input id="reset" type="reset" required>
      <input id="range" type="range" required>
      <input id="color" type="color" required>
    `,
    cases: [
      { select: '#text:required', expect: { ids: ['text'] } },
      { select: '#hidden:required', expect: { ids: [] } },
      { select: '#button:required', expect: { ids: [] } },
      { select: '#submit:required', expect: { ids: [] } },
      { select: '#reset:required', expect: { ids: [] } },
      { select: '#range:required', expect: { ids: [] } },
      { select: '#color:required', expect: { ids: [] }, browsers: ['chromium', 'firefox'] },
      { select: '#color:required', expect: { ids: ['color'] }, browsers: ['webkit'] },
    ],
  },

  {
    name: 'input value required matches supported controls',
    // status: 'only',
    markup: `
      <input id="text" required>
      <input id="email" type="email" required>
      <input id="checkbox" type="checkbox" required>
      <input id="file" type="file" required>
      <select id="select" required><option>x</option></select>
      <textarea id="textarea" required></textarea>
      <input id="optional">
    `,
    cases: [
      { select: '#text:required', expect: { ids: ['text'] } },
      { select: '#email:required', expect: { ids: ['email'] } },
      { select: '#checkbox:required', expect: { ids: ['checkbox'] } },
      { select: '#file:required', expect: { ids: ['file'] } },
      { select: '#select:required', expect: { ids: ['select'] } },
      { select: '#textarea:required', expect: { ids: ['textarea'] } },
      { select: '#optional:required', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value required radio group behavior',
    // status: 'only',
    engines: ['native'],
    markup: `
      <input id="a" type="radio" name="r" required>
      <input id="b" type="radio" name="r">
      <input id="c" type="radio" name="other">
    `,
    cases: [
      { select: '#a:required', expect: { ids: ['a'] } },
      { select: '#b:required', expect: { ids: [] } },
      { select: '#c:required', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value optional matches supported non-required controls',
    // status: 'only',
    markup: `
      <input id="text" type="text">
      <input id="requiredText" type="text" required>
      <select id="select"><option>x</option></select>
      <select id="requiredSelect" required><option>x</option></select>
      <textarea id="textarea"></textarea>
      <textarea id="requiredTextarea" required></textarea>
    `,
    cases: [
      { select: '#text:optional', expect: { ids: ['text'] } },
      { select: '#requiredText:optional', expect: { ids: [] } },
      { select: '#select:optional', expect: { ids: ['select'] } },
      { select: '#requiredSelect:optional', expect: { ids: [] } },
      { select: '#textarea:optional', expect: { ids: ['textarea'] } },
      { select: '#requiredTextarea:optional', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value optional unsupported input type divergence',
    status: 'fail',
    markup: `
      <input id="hidden" type="hidden">
      <input id="button" type="button">
    `,
    cases: [
      { select: '#hidden:optional', expect: { ids: ['hidden'] }, browsers: ['chromium', 'webkit'] },
      { select: '#hidden:optional', expect: { ids: [] }, browsers: ['firefox'] },
      { select: '#button:optional', expect: { ids: ['button'] }, browsers: ['chromium', 'webkit'] },
      { select: '#button:optional', expect: { ids: [] }, browsers: ['firefox'] },
    ],
  },

  {
    name: 'input value invalid ignores form novalidate',
    // status: 'only',
    markup: `
      <form id="form" novalidate>
        <input id="input" required>
      </form>
    `,
    cases: [
      { select: '#form:invalid', expect: { ids: ['form'] } },
      { select: '#input:invalid', expect: { ids: ['input'] } },
      { select: '#input:valid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value fieldset valid requires no invalid descendants',
    // status: 'only',
    markup: `
      <fieldset id="fieldset">
        <input id="validInput" required value="x">
        <input id="invalidInput" required>
      </fieldset>
    `,
    cases: [
      { select: '#validInput:valid', expect: { ids: ['validInput'] } },
      { select: '#invalidInput:invalid', expect: { ids: ['invalidInput'] } },
      { select: '#fieldset:invalid', expect: { ids: ['fieldset'] } },
      { select: '#fieldset:valid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value empty form and fieldset validity',
    // status: 'only',
    markup: `
      <form id="form"></form>
      <fieldset id="fieldset"></fieldset>
    `,
    cases: [
      { select: '#form:valid', expect: { ids: ['form'] } },
      { select: '#form:invalid', expect: { ids: [] } },
      { select: '#fieldset:valid', expect: { ids: ['fieldset'] } },
      { select: '#fieldset:invalid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value form validity includes associated controls outside form',
    // status: 'only',
    markup: `
      <input id="outside" required form="form">
      <form id="form"></form>
    `,
    cases: [
      { select: '#outside:invalid', expect: { ids: ['outside'] } },
      { select: '#form:invalid', expect: { ids: ['form'] } },
      { select: '#form:valid', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range basic number bounds',
    // status: 'only',
    markup: `
      <input id="in" type="number" min="1" max="10" value="5">
      <input id="under" type="number" min="1" max="10" value="0">
      <input id="over" type="number" min="1" max="10" value="11">
      <input id="empty" type="number" min="1" max="10">
    `,
    cases: [
      { select: '#in:in-range', expect: { ids: ['in'] } },
      { select: '#in:out-of-range', expect: { ids: [] } },

      { select: '#under:in-range', expect: { ids: [] } },
      { select: '#under:out-of-range', expect: { ids: ['under'] } },

      { select: '#over:in-range', expect: { ids: [] } },
      { select: '#over:out-of-range', expect: { ids: ['over'] } },

      // Empty value is not range underflow/overflow.
      { select: '#empty:in-range', expect: { ids: ['empty'] } },
      { select: '#empty:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range requires bounds for non-range inputs',
    // status: 'only',
    markup: `
      <input id="number" type="number" value="5">
      <input id="date" type="date" value="2024-01-01">
    `,
    cases: [
      { select: '#number:in-range', expect: { ids: [] } },
      { select: '#number:out-of-range', expect: { ids: [] } },
      { select: '#date:in-range', expect: { ids: [] } },
      { select: '#date:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range input has implicit bounds',
    // status: 'only',
    markup: `
      <input id="range" type="range" value="50">
    `,
    cases: [
      { select: '#range:in-range', expect: { ids: ['range'] } },
      { select: '#range:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range ignores formnovalidate',
    // status: 'only',
    markup: `
      <input id="submit" type="submit" formnovalidate>
      <input id="number" type="number" min="1" max="10" value="11" formnovalidate>
    `,
    cases: [
      { select: '#number:out-of-range', expect: { ids: ['number'] } },
      { select: '#number:in-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range does not use formnovalidate submitter state',
    // status: 'only',
    markup: `
      <form>
        <input id="number" type="number" min="1" max="10" value="11">
        <button id="submit" formnovalidate>submit</button>
      </form>
    `,
    cases: [
      { select: '#number:out-of-range', expect: { ids: ['number'] } },
      { select: '#submit:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range ignores disabled fieldset controls',
    // status: 'only',
    markup: `
      <fieldset disabled>
        <input id="number" type="number" min="1" max="10" value="11">
      </fieldset>
    `,
    cases: [
      { select: '#number:out-of-range', expect: { ids: [] } },
      { select: '#number:in-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'input value range excludes unsupported input types',
    // status: 'only',
    markup: `
      <input id="text" type="text" min="1" max="10" value="11">
      <input id="email" type="email" min="1" max="10" value="x@y.com">
      <input id="hidden" type="hidden" min="1" max="10" value="11">
    `,
    cases: [
      { select: '#text:in-range', expect: { ids: [] } },
      { select: '#text:out-of-range', expect: { ids: [] } },
      { select: '#email:in-range', expect: { ids: [] } },
      { select: '#email:out-of-range', expect: { ids: [] } },
      { select: '#hidden:in-range', expect: { ids: [] } },
      { select: '#hidden:out-of-range', expect: { ids: [] } },
    ],
  },

  {
    name: 'readwrite-readonly/contenteditable-inherited-svg',
    // status: 'only',
    markup: `
      <div id=host contenteditable>
        <p id=p1>html</p>
        <svg id=svg1 width=10 height=10><circle id=circle1 cx=5 cy=5 r=5 /></svg>
        <svg id=svg2 contenteditable=false width=10 height=10><circle id=circle2 cx=5 cy=5 r=5 /></svg>
      </div>
    `,
    cases: [
      // Native engines disagree on inherited SVG editability; selectlet follows the spec-shaped rule:
      // SVG can inherit editability, but contenteditable=false blocks inheritance.
      { select: '#host :read-write', expect: { ids: ['p1', 'svg1', 'circle1'] }, engines: ['selectlet'] },
      { select: '#host :read-write', expect: { ids: ['p1'] }, engines: ['native'], browsers: ['chromium', 'webkit'] },
      { select: '#host :read-write', expect: { ids: ['p1', 'svg1', 'circle1', 'svg2', 'circle2'] }, engines: ['native'], browsers: ['firefox'] },

      { select: '#host :read-only', expect: { ids: ['svg2', 'circle2'] }, engines: ['selectlet'] },
      { select: '#host :read-only', expect: { ids: [] }, engines: ['native'], browsers: ['chromium', 'firefox'] },
      { select: '#host :read-only', expect: { ids: ['svg1', 'circle1', 'svg2', 'circle2'] }, engines: ['native'], browsers: ['webkit'] },
    ],
  },

  {
    name: 'readwrite-readonly/designmode-svg',
    // status: 'only',
    markup: `
      <div id=host>
        <p id=p1>html</p>
        <svg id=svg1 width=10 height=10><circle id=circle1 cx=5 cy=5 r=5 /></svg>
        <svg id=svg2 contenteditable=false width=10 height=10><circle id=circle2 cx=5 cy=5 r=5 /></svg>
      </div>
    `,
    steps: [
      {
        setupPage: async (page) => { await page.evaluate(() => { document.designMode = 'on'; }); },
        cases: [
          // Native engines disagree on inherited SVG editability under designMode; selectlet follows the spec-shaped rule.
          { select: '#host :read-write', expect: { ids: ['p1', 'svg1', 'circle1'] }, engines: ['selectlet'] },
          { select: '#host :read-write', expect: { ids: ['p1'] }, engines: ['native'], browsers: ['chromium', 'webkit'] },
          { select: '#host :read-write', expect: { ids: ['p1', 'svg1', 'circle1', 'svg2', 'circle2'] }, engines: ['native'], browsers: ['firefox'] },

          { select: '#host :read-only', expect: { ids: ['svg2', 'circle2'] }, engines: ['selectlet'] },
          { select: '#host :read-only', expect: { ids: [] }, engines: ['native'], browsers: ['chromium', 'firefox'] },
          { select: '#host :read-only', expect: { ids: ['svg1', 'circle1', 'svg2', 'circle2'] }, engines: ['native'], browsers: ['webkit'] },
        ],
      },
      {
        setupPage: async (page) => { await page.evaluate(() => { document.designMode = 'off'; }); },
        cases: [
          { select: '#host :read-only', expect: { ids: ['p1', 'svg1', 'circle1', 'svg2', 'circle2'] }, engines: ['selectlet'] },
          { select: '#host :read-only', expect: { ids: ['p1'] }, engines: ['native'], browsers: ['chromium'] },
          { select: '#host :read-only', expect: { ids: ['p1', 'svg1', 'circle1', 'svg2', 'circle2'] }, engines: ['native'], browsers: ['firefox', 'webkit'] },
        ],
      },
    ],
  },

  {
    name: 'indeterminate/radio-group-form-owner-outside-form',
    // status: 'only',
    markup: `
      <form id=f><input id=a type=radio name=g><span id=sibling></span></form>
      <input id=b type=radio name=g form=f checked>
    `,
    cases: [
      { select: '#a:indeterminate', expect: { ids: [] } },
      { select: '#a + span', expect: { ids: ['sibling'] } },
      { select: ':indeterminate + span', expect: { ids: [] } },
    ],
  },

  {
    name: 'indeterminate/radio-group-same-tree',
    // status: 'only',
    markup: `
      <input id=a type=radio name=g><span id=sibling></span>
      <div id=host></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
        root.innerHTML = `<input id=b type=radio name=g checked>`;
      });
    },
    cases: [
      { select: ':indeterminate + span', expect: { ids: ['sibling'] } },
    ],
  },

  {
    name: 'fieldset validity checks descendant invalid controls',
    // status: 'only',
    markup: `
      <fieldset id="bad-fs">
        <input id="bad" required>
      </fieldset>
      <fieldset id="good-fs">
        <input id="good" required value="x">
      </fieldset>
    `,
    cases: [
      { select: '#bad-fs:invalid', expect: { ids: ['bad-fs'] } },
      { select: '#good-fs:invalid', expect: { ids: [] } },
      { select: '#bad-fs:valid', expect: { ids: [] } },
      { select: '#good-fs:valid', expect: { ids: ['good-fs'] } },
    ],
  },

  {
    name: 'fieldset-disabled/inner-first-legend-does-not-escape-outer-fieldset',
    // status: 'only',
    browsers: ['chromium', 'firefox'], // webkit is bugged
    markup: `
      <fieldset id="outer" disabled>
        <legend id="outer-legend">outer legend</legend>

        <fieldset id="inner" disabled>
          <legend id="inner-legend">
            <input id="x">
          </legend>
        </fieldset>
      </fieldset>
    `,
    cases: [
      { select: '#x:disabled', expect: { ids: ['x'] } },
      { select: '#x:enabled', expect: { ids: [] } },

      { match: ':disabled', ref: { by: 'id', id: 'x' }, expect: { count: 1 } },
      { match: ':enabled', ref: { by: 'id', id: 'x' }, expect: { count: 0 } },
    ],
  },

  {
    name: 'fieldset-disabled/first-legend-escapes-own-fieldset',
    // status: 'only',
    markup: `
      <fieldset id="inner" disabled>
        <legend id="inner-legend">
          <input id="x">
        </legend>
      </fieldset>
    `,
    cases: [
      { select: '#x:enabled', expect: { ids: ['x'] } },
      { select: '#x:disabled', expect: { ids: [] } },
      { match: ':enabled', ref: { by: 'id', id: 'x' }, expect: { count: 1 } },
      { match: ':disabled', ref: { by: 'id', id: 'x' }, expect: { count: 0 } },
    ],
  },

  {
    name: 'fieldset-disabled/first-legend-child-vs-nested-legend',
    // status: 'only',
    markup: `
      <fieldset id="first-legend-child" disabled>
        <div id="before-legend"></div>
        <legend id="direct-legend">
          <input id="direct-legend-input">
        </legend>
        <input id="direct-outside-input">
      </fieldset>

      <fieldset id="nested-legend-fieldset" disabled>
        <div id="legend-wrapper">
          <legend id="nested-legend">
            <input id="nested-legend-input">
          </legend>
        </div>
        <input id="nested-outside-input">
      </fieldset>
    `,
    cases: [
      // First legend *child* exempts descendants, even if not first element child.
      { select: '#direct-legend-input:enabled', expect: { ids: ['direct-legend-input'] } },
      { select: '#direct-legend-input:disabled', expect: { ids: [] } },
      { match: ':enabled', ref: { by: 'id', id: 'direct-legend-input' }, expect: { count: 1 } },
      { match: ':disabled', ref: { by: 'id', id: 'direct-legend-input' }, expect: { count: 0 } },

      // Non-legend descendants outside the first legend child are disabled.
      { select: '#direct-outside-input:disabled', expect: { ids: ['direct-outside-input'] } },
      { select: '#direct-outside-input:enabled', expect: { ids: [] } },
      { match: ':disabled', ref: { by: 'id', id: 'direct-outside-input' }, expect: { count: 1 } },
      { match: ':enabled', ref: { by: 'id', id: 'direct-outside-input' }, expect: { count: 0 } },

      // A nested legend is not a legend child of the fieldset, so it does not exempt.
      { select: '#nested-legend-input:disabled', expect: { ids: ['nested-legend-input'] } },
      { select: '#nested-legend-input:enabled', expect: { ids: [] } },
      { match: ':disabled', ref: { by: 'id', id: 'nested-legend-input' }, expect: { count: 1 } },
      { match: ':enabled', ref: { by: 'id', id: 'nested-legend-input' }, expect: { count: 0 } },

      // Ordinary descendant also disabled.
      { select: '#nested-outside-input:disabled', expect: { ids: ['nested-outside-input'] } },
      { select: '#nested-outside-input:enabled', expect: { ids: [] } },
    ],
  },

  {
    name: 'form-validation/empty-range-limited-inputs',
    // status: 'only',
    markup: `
      <input id="empty-number" type="number" min="1" max="10">
      <input id="empty-date" type="date" min="2020-01-01" max="2020-12-31">
      <input id="empty-required-number" type="number" min="1" max="10" required>
      <input id="in-number" type="number" min="1" max="10" value="5">
      <input id="under-number" type="number" min="1" max="10" value="0">
      <input id="over-number" type="number" min="1" max="10" value="11">
    `,
    cases: [
      { select: '#empty-number:in-range', expect: { ids: ['empty-number'] } },
      { select: '#empty-number:out-of-range', expect: { ids: [] } },
      { match: ':in-range', ref: { by: 'id', id: 'empty-number' }, expect: { count: 1 } },
      { match: ':out-of-range', ref: { by: 'id', id: 'empty-number' }, expect: { count: 0 } },

      { select: '#empty-date:in-range', expect: { ids: ['empty-date'] }, browsers: ['chromium', 'firefox'] },
      { select: '#empty-date:in-range', expect: { ids: [] }, browsers: ['webkit'] },
      { select: '#empty-date:out-of-range', expect: { ids: [] } },
      { match: ':in-range', ref: { by: 'id', id: 'empty-date' }, expect: { count: 1 }, browsers: ['chromium', 'firefox'] },
      { match: ':in-range', ref: { by: 'id', id: 'empty-date' }, expect: { count: 0 }, browsers: ['webkit'] },
      { match: ':out-of-range', ref: { by: 'id', id: 'empty-date' }, expect: { count: 0 } },

      // Even required-empty is invalid for valueMissing, not rangeUnderflow/rangeOverflow.
      { select: '#empty-required-number:in-range', expect: { ids: ['empty-required-number'] } },
      { select: '#empty-required-number:out-of-range', expect: { ids: [] } },
      { select: '#empty-required-number:invalid', expect: { ids: ['empty-required-number'] } },

      { select: '#in-number:in-range', expect: { ids: ['in-number'] } },
      { select: '#in-number:out-of-range', expect: { ids: [] } },

      { select: '#under-number:out-of-range', expect: { ids: ['under-number'] } },
      { select: '#under-number:in-range', expect: { ids: [] } },

      { select: '#over-number:out-of-range', expect: { ids: ['over-number'] } },
      { select: '#over-number:in-range', expect: { ids: [] } },
    ],
  },

]);
