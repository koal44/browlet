#ifndef NODE_COMPAT_GLOBAL_OBJECT_H_
#define NODE_COMPAT_GLOBAL_OBJECT_H_

#include <v8.h>

namespace node_compat {
// A host view of one context's ordinary properties, independent of proxy reuse.
v8::MaybeLocal<v8::Object> CreateGlobalObject(v8::Local<v8::Context> context);
bool PrepareGlobalObjectDetach(v8::Local<v8::Context> context);
bool FinishGlobalObjectDetach(v8::Local<v8::Context> context);
bool IsGlobalObjectReflection();
}  // namespace node_compat

#endif  // NODE_COMPAT_GLOBAL_OBJECT_H_
