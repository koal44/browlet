# Browlet automation

WebDriver BiDi owns the protocol algorithms. Browlet's Node convenience API is
a client above that boundary, with its own function-source conversion, value
copying, callback API, and navigation policy.

## Current separation

`WebDriver.evaluate(session, parameters)` and
`WebDriver.callFunction(session, parameters)` translate the remote-end command
steps. They accept protocol targets and options and produce protocol success,
exception, or error results. They create HTML classic scripts, prepare the
selected environment, request evaluation of the retained record, and clean up.
They neither call `PageEvaluation` nor fall back to source evaluation.

Command completion uses `InternalPromise` with `userAgent.HostPromise`, so
remote-end continuations belong to the host rather than the selected page's
microtask queue. WebDriver commands are protocol operations, not Web IDL
members; there is no binding layer to project their promises. Native Promise
conversion belongs at the Node API or transport boundary.

[protocol.ts](protocol.ts) describes the command bodies and script values.
Protocol input validation, command IDs/envelopes, session establishment, and
WebSocket transport are not implemented. `WebDriverSession` currently supplies
identity only; constructing it does not establish a live session.

The commands are **not yet executable end to end**. These dependencies throw
explicitly:

| Dependency | Remaining work |
| --- | --- |
| Target lookup | Context/realm registration, lifecycle, ID lookup, and sandbox selection |
| `JSScriptRecord.evaluate()` | Execute the retained compiled artifact in its realm and connect active-script metadata |
| ECMAScript Await | Observe the native author Promise in its realm; suspend/resume the modeled execution context when invoking its internal continuation |
| LocalValue/RemoteValue | Specified deserialization, serialization limits, handles, shared node IDs, and channels |
| Exception details | Throw-site stack frames and protocol serialization |
| User activation | HTML's activation-notification algorithm |

The algorithm tests substitute those dependencies explicitly. They verify
command behavior such as exception results, the default null function receiver,
and awaiting only genuine Promises when requested. They do not establish
runtime execution or protocol conformance. `awaitPromise()` remains an explicit
throwing dependency. Its eventual internal result must resume the script
context for cleanup before the command continues on the host; changing its
return type does not implement ECMAScript Await.

## Temporary convenience path

Until those dependencies are connected, the production path remains:

```text
Browlet.evaluate / exposeFunction
    -> PageEvaluation
        -> LocalEvaluation (existing source evaluator)
```

The intended next path is `Browlet -> PageEvaluation -> WebDriver -> HTML/engine`.
Reroute only when the required driver operations work; do not catch an
unfinished driver operation and retry through the local evaluator.

`PageEvaluation` owns the page's convenience API and retained Node callbacks.
Its private `LocalEvaluation` queues evaluation and callback completions as
HTML tasks. This temporary implementation copies arguments, results, and
exceptions, preserving cycles and repeated references. Its copy algorithm is
not BiDi serialization.

The UserAgent keeps a weak map from Navigables to their local evaluation
clients. Document replacement cancels pending local calls and installs retained
callbacks in the new Window. Destruction cancels calls and releases that entry.
These notifications implement Browlet's existing convenience behavior;
`activeDocumentChanged()` is not a WebDriver algorithm or a
`script.realmDestroyed` event. BiDi's unloading/worker lifecycle hooks remain
separate unfinished work.

Keep these existing notifications until BiDi navigation and realm lifecycle
integration can replace them; do not add new `PageEvaluation` dependencies to
browser algorithms. At that point, move the client to those notifications and
remove the UserAgent weak map and direct Navigable/Document calls. Preserve
pending-call rejection, queued-task cancellation, callback reinstallation,
and destroyed-page errors. Realm destruction alone is insufficient: document
replacement can reuse a Window and realm.

The local API accepts functions or source, snapshots arguments, awaits the
result, and returns a Node copy. Functions' closures remain in Node.
`exposeFunction` runs a supplied callback on Node's queue and delivers its
completion through the page's task queue. Supported copies are primitive data
except symbols, arrays, plain objects, Date, RegExp, Map, Set, and Error.
Functions, proxies, and live DOM values require a different contract.

## Parse errors

`SPEC_GAP(bidi-script-parse-errors)`: Both
[script.evaluate](https://w3c.github.io/webdriver-bidi/#command-script-evaluate)
and [evaluate function body](https://w3c.github.io/webdriver-bidi/#evaluate-function-body)
call `ScriptEvaluation` on the newly created classic script's record.
HTML's [creation algorithm](https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-classic-script)
leaves that record null after a parse failure. Those BiDi steps provide no
parse-error branch, and ECMAScript requires a Script Record.

The reviewed choice follows [Firefox's exception handling](https://searchfox.org/mozilla-central/source/remote/webdriver-bidi/modules/windowglobal/script.sys.mjs),
[Chromium's BiDi mapper](https://github.com/GoogleChromeLabs/chromium-bidi/blob/main/src/bidiMapper/modules/script/Realm.ts),
and [WPT's invalid-script expectation](https://github.com/web-platform-tests/wpt/blob/master/webdriver/tests/bidi/script/evaluate/exception_details.py):
turn the retained parse error into a throw completion and return the command's
normal `type: "exception"` result, including its realm and exception details.
The command cleans up its prepared execution context before describing that
exception. It neither evaluates a null record nor reparses the source.

The command tests use the real parser and substitute only unfinished dependencies,
including exception serialization. Browlet's existing local syntax-error behavior
is unchanged.
