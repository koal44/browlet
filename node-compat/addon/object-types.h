#ifndef NODE_COMPAT_OBJECT_TYPES_H_
#define NODE_COMPAT_OBJECT_TYPES_H_

#include <v8.h>

// Expose V8 object-brand checks missing from node:util.types without invoking
// author code or inspecting prototypes.
namespace node_compat {
void InitializeObjectTypes(v8::Local<v8::Object> exports);
}  // namespace node_compat

#endif  // NODE_COMPAT_OBJECT_TYPES_H_
