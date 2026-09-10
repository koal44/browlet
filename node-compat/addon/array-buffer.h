#pragma once
#include <v8.h>

namespace node_compat {
void InitializeArrayBuffer(v8::Local<v8::Object> exports,
                           v8::Local<v8::Context> context);
}  // namespace node_compat
