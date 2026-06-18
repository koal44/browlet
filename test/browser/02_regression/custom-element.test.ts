import { runScenarios } from '../../dispatch';

runScenarios('custom-elements', 'normal', [
  {
    name: ':state() matches custom element states',
    // status: 'only',
    browsers: ['chromium', 'firefox', 'webkit'],
    markup: `
      <custom-state id="plain"></custom-state>
      <custom-state id="foo" class="c1 c2"></custom-state>
    `,
    setupPage: async (page) => {
      await page.evaluate(async () => {
        type StateBridgeElement = Element & { __selectletStates?: CustomStateSet; };
        class CustomStateElement extends HTMLElement {
          __selectletStates: CustomStateSet;

          constructor() {
            super();
            const internals = this.attachInternals();

            // Test-only bridge: native selectors see ElementInternals.states;
            // selectlet sees the same state set through its capability hook.
            this.__selectletStates = internals.states;
          }

          addState(name: string) {
            this.__selectletStates.add(name);
          }
        }

        if (!customElements.get('custom-state')) {
          customElements.define('custom-state', CustomStateElement);
        }

        await customElements.whenDefined('custom-state');

        const foo = document.getElementById('foo');
        if (!(foo instanceof CustomStateElement)) {
          throw new Error('custom-state element was not upgraded');
        }

        foo.addState('foo');

        window.selectlet = window.createSelectlet(document, {
          caps: {
            el: {
              hasCustomState: (el, name) => {
                return (el as StateBridgeElement).__selectletStates?.has(name) === true;
              },
            },
          },
        }) as typeof window.selectlet;
      });
    },
    cases: [
      { match: ':state(foo)', ref: { by: 'id', id: 'plain' }, expect: { ids: [] } },
      { match: ':state(foo)', ref: { by: 'id', id: 'foo' }, expect: { ids: ['foo'] } },
      { match: ':state(Foo)', ref: { by: 'id', id: 'foo' }, expect: { ids: [] } },

      { match: ':not(:state(foo))', ref: { by: 'id', id: 'plain' }, expect: { ids: ['plain'] } },
      { match: ':not(:state(foo))', ref: { by: 'id', id: 'foo' }, expect: { ids: [] } },

      { match: ':is(:state(foo))', ref: { by: 'id', id: 'foo' }, expect: { ids: ['foo'] } },
      { match: '.c1:state(foo)', ref: { by: 'id', id: 'foo' }, expect: { ids: ['foo'] } },
      { match: ':state(foo).c2', ref: { by: 'id', id: 'foo' }, expect: { ids: ['foo'] } },

      { select: ':state(foo)', ref: { by: 'document' }, expect: { ids: ['foo'] } },
    ],
  },

]);
