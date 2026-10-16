#pragma once
#include <v8.h>

// Allocate shared-buffer objects in the destination realm over existing storage.
// The optional V8 length-tracking patch also identifies fixed versus auto-length
// views without resizing their buffers or reading author properties.
namespace node_compat {
void InitializeArrayBuffer(v8::Local<v8::Object> exports,
                           v8::Local<v8::Context> context,
                           v8::Local<v8::External> vm_data);
}  // namespace node_compat
