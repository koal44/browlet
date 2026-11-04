#pragma once

#include <v8.h>

namespace node_compat {
void InitializeWasmFunctions(v8::Local<v8::Object> exports,
                             v8::Local<v8::Context> context,
                             v8::Local<v8::External> vm_data);
}  // namespace node_compat
