# HTML collections roadmap

HTML §2.6 defines collection interfaces beyond the DOM Standard's `NodeList`
and `HTMLCollection`. Keep their live tree semantics here while reusing the
DOM collection machinery underneath.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `all.ts` | `HTMLAllCollection`, indexed/named lookup, callable behavior, and `document.all` | HTML §2.6.4.1 |
| `form-controls.ts` | `HTMLFormControlsCollection` and `RadioNodeList` | HTML §2.6.4.2 |
| `options.ts` | `HTMLOptionsCollection` indexed setter/add/remove behavior | HTML §2.6.4.3 |
| `dom-string-list.ts` | Read-only indexed string-list surface over its owner's associated list | HTML §2.6.5 |
| `web-idl.ts` | Legacy indexed/named/callable projection contributions | HTML §2.6 and Web IDL legacy platform objects |

`HTMLAllCollection` requires JavaScript's engine-internal [[IsHTMLDDA]]
behavior (`typeof document.all`, falsiness, and loose equality). Userland
JavaScript cannot reproduce that contract; preserve a focused expected-failure
test when the collection is introduced rather than distorting Web IDL around
it.

## Removal condition

Burn this file after all four collection families have live-tree behavior and
public binding tests, with the [[IsHTMLDDA]] host limitation still explicit if
the engine cannot provide it.
