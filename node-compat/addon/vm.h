#ifndef NODE_COMPAT_VM_H_
#define NODE_COMPAT_VM_H_

#include <v8.h>

// Give HTML control over microtask checkpoints across related realms and preserve
// WindowProxy identity when navigation replaces a context. Contexts retain their
// shared queues for as long as their jobs can still run.
namespace node_compat {
// Returns opaque callback data for operations that use GetContext.
v8::Local<v8::External> InitializeVm(v8::Local<v8::Object> exports,
                                   v8::Local<v8::Context> context);

// Retrieve an attached context. The callback must carry InitializeVm's data.
v8::MaybeLocal<v8::Context> GetContext(
    const v8::FunctionCallbackInfo<v8::Value>& args, v8::Local<v8::Value> value);

// Supply InitializeVm's opaque data explicitly when the callback has its own state.
v8::MaybeLocal<v8::Context> GetContext(
    const v8::FunctionCallbackInfo<v8::Value>& args, v8::Local<v8::Value> value,
    v8::Local<v8::External> vm_data);
}  // namespace node_compat

#endif  // NODE_COMPAT_VM_H_
