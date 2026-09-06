#ifndef NODE_COMPAT_HOST_HOOKS_H_
#define NODE_COMPAT_HOST_HOOKS_H_

#include <v8.h>

namespace node_compat {
void InitializeHostHooks(v8::Local<v8::Object> exports,
                         v8::Local<v8::Context> context);
v8::Local<v8::Object> GetRealmReference(v8::Local<v8::Context> context);
}  // namespace node_compat

#endif  // NODE_COMPAT_HOST_HOOKS_H_
