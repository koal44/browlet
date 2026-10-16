#ifndef NODE_COMPAT_HOST_HOOKS_H_
#define NODE_COMPAT_HOST_HOOKS_H_

#include <v8.h>

// Preserve registration context for Promise and FinalizationRegistry callbacks,
// and let HTML schedule Promise and Atomics.waitAsync jobs. These interception
// points require the V8 host-hook patches; ordinary JavaScript cannot supply them.
namespace node_compat {
void InitializeHostHooks(v8::Local<v8::Object> exports,
                         v8::Local<v8::Context> context);
}  // namespace node_compat

#endif  // NODE_COMPAT_HOST_HOOKS_H_
