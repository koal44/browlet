#pragma once
#include <v8.h>

namespace node_compat {
// Per-context interception of eval/Function source, preserving Node's checks.
void InitializeCodeGeneration(v8::Local<v8::Object> exports);
}  // namespace node_compat
