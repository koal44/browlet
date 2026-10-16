#ifndef NODE_COMPAT_PROMISE_H_
#define NODE_COMPAT_PROMISE_H_

#include <v8.h>

// Observe an existing Promise in the observer's realm and queue without calling its
// author-visible `then`. Node 26+ also bypasses `constructor` and species; Node 24's
// native Promise::Then still consults `constructor`.
namespace node_compat {
void InitializePromise(v8::Local<v8::Object> exports);
}  // namespace node_compat

#endif  // NODE_COMPAT_PROMISE_H_
