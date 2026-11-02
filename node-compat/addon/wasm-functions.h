#pragma once

#include <v8.h>

namespace node_compat {
void InitializeWasmFunctions(v8::Local<v8::Object> exports);
}  // namespace node_compat
