#ifndef NODE_COMPAT_REALM_H_
#define NODE_COMPAT_REALM_H_

#include <v8.h>

// Identify an object's creation realm or a callable's target realm without
// trusting mutable prototypes or running author code. Stable references distinguish
// successive realms even when navigation reuses the same global proxy.
namespace node_compat {
void InitializeRealm(v8::Local<v8::Object> exports, v8::Local<v8::Context> context);
v8::Local<v8::Object> GetRealmReference(v8::Local<v8::Context> context);
}  // namespace node_compat

#endif  // NODE_COMPAT_REALM_H_
