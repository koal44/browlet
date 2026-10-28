#pragma once
#include <v8.h>

// Source-text and synthetic modules over the existing VM context handles.
namespace node_compat {
void InitializeVmModules(v8::Local<v8::Object> exports,
                         v8::Local<v8::Context> context,
                         v8::Local<v8::External> vm_data);
}  // namespace node_compat
