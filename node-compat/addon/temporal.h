#pragma once
#include <v8.h>

namespace node_compat {
// Install an internal, nonthrowing clock for one context's Temporal.Now methods.
void InitializeTemporal(v8::Local<v8::Object> exports);
}  // namespace node_compat
