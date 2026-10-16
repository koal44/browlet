# Form controls needed by HTML collections

HTML §§2.6.4.2–2.6.4.3 now have collection implementations and minimal concrete
`form`, `input`, `select`, `option`, and `optgroup` implementations. These are
the owners of the required state, not complete implementations of HTML §4.10.
The collection algorithms call those owners; unfinished owner algorithms remain
explicit stubs.

## Present behavior

- `HTMLFormControlsCollection` consumes an owner-supplied live source. Named
  lookup returns null, one element, or a new live `RadioNodeList`. Radio values
  use input type state and internal checkedness, not the checked attribute.
- `HTMLOptionsCollection` consumes the select's list of options. Length changes,
  indexed assignment, add/remove, names, indices, and selected-index forwarding
  use the existing DOM mutation and Web IDL binding machinery.
- Inputs retain checkedness and dirty checkedness. Options retain selectedness
  and dirtiness. The implemented attribute changes preserve those distinctions.
  Selects supply option membership and explicit selected-index changes.

The form-controls implementation extends `HTMLCollectionImpl`, retaining its
first-element `namedItem()` operation. The form-controls platform method forwards
to `namedItemOrItems()` for its wider result; a borrowed
`HTMLCollection.prototype.namedItem` still returns the first matching element.
Both implementation and platform inherit the base collection behavior. The
generated declarations use `Omit<HTMLCollection, "namedItem">` to describe the
child's replacement signature without changing the runtime prototype chain.

## Missing owner algorithms

| Owner | Explicit gap | Required follow-up |
| --- | --- | --- |
| `HTMLFormElementImpl.getListedElements()` | Throws until form-owner association exists | Listed-element classification; external `form` references and duplicate IDs; parser associations; tree/attribute/adoption changes; form-associated custom elements. Do not substitute descendant-only membership. |
| `HTMLInputElementImpl.updateRadioButtonGroup()` | No-op | Same nonempty name, tree, and form owner; uncheck other radio inputs. Connect every checkedness, type, name, form-owner, and connection trigger from §4.10.5. |
| `HTMLSelectElementImpl.resetSelectedness()` | No-op | Selectedness-setting algorithm, including display size, disabled options, single/multiple selection, and all mutation triggers. |
| `HTMLOptionElementImpl.askForReset()` | No-op | Notify the nearest ancestor select, run selectedness setting, and update selectedcontent. Connect option insertion/removal and selected-attribute changes. |
| `HTMLSelectElementImpl.updateSelectedContent()` | No-op | Selectedcontent ownership and cloning, including the option and select mutation hooks. |
| Other form-control APIs and lifecycle | Not yet declared | Complete §4.10 interfaces, construction, activation, disabled/value modes, validation, submission/reset, and cloning. Optgroup currently supplies identity only. |
| Custom-element reactions | Existing deferred dependency | Implement `[CEReactions]` entry/exit and delivery; annotations are retained on the collection mutations. |

Current collection tests retain three approved expected failures: external form-control
membership, radio-group exclusion when assigning `RadioNodeList.value`, and
default option selection after mutations. They run with `it.fails`, preserving the
required expectations and failing on an unexpected pass so the marker can be
removed when the owner algorithm is implemented. The passing cases establish the
collection algorithms without claiming that the owner stubs work. Selectedcontent,
cloning, and the rest of §4.10 still need their own coverage when implemented.

See the [HTML collection overview](../../../../html/ROADMAP.md#collections-and-domstringlist),
[form collection tests](../../../../../../test/browlet/html/collections/form-controls.test.ts),
and [options tests](../../../../../../test/browlet/html/collections/options.test.ts).

## Specification references

- [HTMLFormControlsCollection and RadioNodeList](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#htmlformcontrolscollection)
- [HTMLOptionsCollection](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#htmloptionscollection)
- [Form-associated elements](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#association-of-controls-and-forms)
- [Radio-button groups](https://html.spec.whatwg.org/multipage/input.html#radio-button-group)
- [Select option membership](https://html.spec.whatwg.org/multipage/form-elements.html#concept-select-option-list)
- [Selectedness setting](https://html.spec.whatwg.org/multipage/form-elements.html#selectedness-setting-algorithm)

Remove this scaffolding roadmap once these owner algorithms and their mutation
hooks are implemented and covered, transferring remaining §4.10 work to its
broader roadmap.
