#include "vm-module-bindings.h"
#include <v8-version.h>
#include <cstring>

namespace node_compat {
namespace {

// HACK: V8's public API does not expose resolved export identities. These reads
// depend on private layouts in module.tq, js-objects.tq, fixed-array.tq and
// hash-table.h. Matching Node headers supply pointer/handle decoding, but not
// these field positions. Wrong positions can crash the process, not throw JS.
// Keep this isolated and review it when updating either official or custom V8.
// Only Windows x64 without pointer compression has been validated. Unknown
// builds omit the predicate and retain the existing Wasm re-export limitation.
// A custom layout change without a version change still needs manual review;
// these pins are not an ABI guarantee. There is deliberately no startup probe.
#if defined(_WIN32) && defined(_M_X64) && !defined(V8_COMPRESS_POINTERS) && \
    ((V8_MAJOR_VERSION == 13 && V8_MINOR_VERSION == 6 && \
      V8_BUILD_NUMBER == 233 && V8_PATCH_LEVEL == 17) || \
     (V8_MAJOR_VERSION == 14 && V8_MINOR_VERSION == 6 && \
      V8_BUILD_NUMBER == 202 && V8_PATCH_LEVEL == 34))
#define NODE_COMPAT_MODULE_BINDING_LAYOUT

using v8::internal::Address;
using v8::internal::Internals;
constexpr int kTaggedSize = v8::internal::kApiTaggedSize;

// The compile-time gate alone cannot protect an existing binary loaded into a
// different Node with a compatible addon ABI. Check the actual engine too.
bool ReviewedRuntime() {
  const char* version = v8::V8::GetVersion();
#if V8_MAJOR_VERSION == 13
  return std::strcmp(version, "13.6.233.17-node.51") == 0;
#else
  return std::strcmp(version, "14.6.202.34-node.28") == 0 ||
         std::strcmp(version, "14.6.202.34-node.29") == 0;
#endif
}

// No allocations or callbacks while addresses are in use. Never retain/expose
// a raw address, read a binding's value, or write a cell.
Address FindBinding(v8::Local<v8::Value> module_namespace,
                    v8::Local<v8::String> internalized_name) {
  const Address ns = v8::internal::ValueHelper::ValueAsAddress(*module_namespace);
  const Address name = v8::internal::ValueHelper::ValueAsAddress(*internalized_name);
  // JSModuleNamespace extends JSSpecialObject (including cpp_heap_wrappable)
  // with `module`; Module extends HeapObject with `exports`. ObjectHashTable
  // has three metadata slots followed by internalized-name/Cell pairs.
  const Address module = Internals::ReadTaggedPointerField(
      ns, Internals::kJSAPIObjectWithEmbedderSlotsHeaderSize);
  const Address exports = Internals::ReadTaggedPointerField(module, kTaggedSize);
  const int length = Internals::SmiValue(Internals::ReadTaggedSignedField(exports, kTaggedSize));
  for (int index = 3; index + 1 < length; index += 2) {
    const int offset = Internals::kFixedArrayHeaderSize + index * kTaggedSize;
    if (Internals::ReadTaggedPointerField(exports, offset) == name) {
      return Internals::ReadTaggedPointerField(exports, offset + kTaggedSize);
    }
  }
  return 0;
}

v8::MaybeLocal<v8::String> Internalize(v8::Isolate* isolate, v8::Local<v8::Value> name) {
  v8::String::Value characters(isolate, name);
  if (*characters == nullptr) return {};
  return v8::String::NewFromTwoByte(isolate, *characters,
      v8::NewStringType::kInternalized, characters.length());
}

void HaveSameModuleBinding(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  if (args.Length() != 4 || !args[0]->IsModuleNamespaceObject() ||
      !args[1]->IsString() || !args[2]->IsModuleNamespaceObject() || !args[3]->IsString()) {
    isolate->ThrowException(v8::Exception::TypeError(v8::String::NewFromUtf8Literal(
        isolate, "Expected two module namespaces, each followed by an export name")));
    return;
  }
  v8::Local<v8::String> left_name, right_name;
  if (!Internalize(isolate, args[1]).ToLocal(&left_name) ||
      !Internalize(isolate, args[3]).ToLocal(&right_name)) return;
  const Address left = FindBinding(args[0], left_name);
  const Address right = FindBinding(args[2], right_name);
  args.GetReturnValue().Set(left != 0 && left == right);
}
#endif

}  // namespace

void InitializeVmModuleBindings(v8::Local<v8::Object> exports,
                                v8::Local<v8::Context> context) {
#ifdef NODE_COMPAT_MODULE_BINDING_LAYOUT
  if (!ReviewedRuntime()) return;
  auto* isolate = v8::Isolate::GetCurrent();
  v8::Local<v8::Function> predicate;
  if (!v8::Function::New(context, HaveSameModuleBinding).ToLocal(&predicate)) return;
  exports->Set(context, v8::String::NewFromUtf8Literal(isolate, "haveSameModuleBinding"), predicate).Check();
#endif
}

}  // namespace node_compat
