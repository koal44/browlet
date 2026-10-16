#pragma once
#include <v8.h>

// Let serialization preserve fixed versus auto-length views without resizing
// their buffers or reading author properties. Requires the V8 length-tracking
// inspection patch.
namespace node_compat {
void InitializeArrayBuffer(v8::Local<v8::Object> exports,
                           v8::Local<v8::Context> context);
}  // namespace node_compat
