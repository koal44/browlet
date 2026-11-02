#include <node.h>
#include <node_buffer.h>
#include "wasm-functions.h"

namespace node_compat {
namespace {

void GetWasmModuleBytes(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  if (!args[0]->IsWasmModuleObject()) {
    isolate->ThrowException(v8::Exception::TypeError(
        v8::String::NewFromUtf8Literal(isolate, "Expected a WebAssembly.Module")));
    return;
  }
  auto compiled = args[0].As<v8::WasmModuleObject>()->GetCompiledModule();
  auto bytes = compiled.GetWireBytesRef();
  v8::Local<v8::Object> copy;
  if (node::Buffer::Copy(isolate, reinterpret_cast<const char*>(bytes.data()),
                         bytes.size()).ToLocal(&copy)) {
    args.GetReturnValue().Set(copy);
  }
}

void CompileWasmImportBridge(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  if (!node::Buffer::HasInstance(args[0])) {
    isolate->ThrowException(v8::Exception::TypeError(
        v8::String::NewFromUtf8Literal(isolate, "Expected generated Wasm bridge bytes")));
    return;
  }
  const auto* bytes = reinterpret_cast<const uint8_t*>(node::Buffer::Data(args[0]));
  v8::Local<v8::WasmModuleObject> module;
  // Only wasm-functions.cjs supplies these internally generated modules. This
  // public API deliberately bypasses author code-generation policy: instantiating
  // an already compiled Module must still work in a realm that forbids compiling.
  if (v8::WasmModuleObject::Compile(isolate,
          {bytes, node::Buffer::Length(args[0])}).ToLocal(&module)) {
    args.GetReturnValue().Set(module);
  }
}

}  // namespace

void InitializeWasmFunctions(v8::Local<v8::Object> exports) {
  NODE_SET_METHOD(exports, "getWasmModuleBytes", GetWasmModuleBytes);
  NODE_SET_METHOD(exports, "compileWasmImportBridge", CompileWasmImportBridge);
}

}  // namespace node_compat
