#pragma once
#include <v8.h>

namespace node_compat {
// ScriptOrigin metadata shared by classic and source-text module compilation.
v8::MaybeLocal<v8::Data> DynamicImportOptions(v8::Isolate* isolate,
                                            v8::Local<v8::Value> loader);
void InitializeVmImports(v8::Local<v8::Object> exports, v8::Local<v8::Context> context,
                         v8::Local<v8::External> vm_data);
}  // namespace node_compat
