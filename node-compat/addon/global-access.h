#ifndef NODE_COMPAT_GLOBAL_ACCESS_H_
#define NODE_COMPAT_GLOBAL_ACCESS_H_

#include <v8.h>

namespace node_compat {
// Native global access checks retain V8's ordinary store and global-this identity.
void ConfigureGlobalAccess(v8::Isolate*, v8::Local<v8::ObjectTemplate>);
void PrepareGlobalAccess(v8::Local<v8::Context>);
void InitializeGlobalAccess(v8::Local<v8::Object>, v8::Local<v8::Context>);
}  // namespace node_compat

#endif  // NODE_COMPAT_GLOBAL_ACCESS_H_
