#pragma once
#include <v8.h>

namespace node_compat {
// Exposes the private binding predicate only on the reviewed engine builds.
void InitializeVmModuleBindings(v8::Local<v8::Object> exports,
                                v8::Local<v8::Context> context);
}  // namespace node_compat
