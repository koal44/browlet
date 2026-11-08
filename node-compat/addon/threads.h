#pragma once
#include <v8.h>

namespace node_compat {
// Cross-isolate suspension controls; scheduling policy belongs to the host.
void InitializeThreads(v8::Local<v8::Object> exports);
}  // namespace node_compat
