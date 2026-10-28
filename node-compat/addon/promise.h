#ifndef NODE_COMPAT_PROMISE_H_
#define NODE_COMPAT_PROMISE_H_

#include <v8.h>

// Observe an existing Promise in the observer's realm and queue without calling its
// author-visible `then`. Node 26+ also bypasses `constructor` and species; Node 24's
// native Promise::Then still consults `constructor`.
// Rejection notifications use the executing context's registered tracker and
// otherwise preserve Node's reporting; slot queries do not observe the promise.
namespace node_compat {
void InitializePromise(v8::Local<v8::Object> exports, v8::Local<v8::Context> context,
                       v8::Local<v8::External> vm_data);
}  // namespace node_compat

#endif  // NODE_COMPAT_PROMISE_H_
