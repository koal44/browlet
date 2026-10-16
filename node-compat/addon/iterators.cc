#include <node.h>
#include "iterators.h"
#include "vm.h"

namespace node_compat {
namespace {
using namespace v8;

#ifdef NODE_COMPAT_COLLECTION_ITERATORS
Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Fail(Isolate* isolate, const char* code, const char* message) {
  auto error = Exception::TypeError(Text(isolate, message)).As<Object>();
  if (error->Set(isolate->GetCurrentContext(), Text(isolate, "code"),
                 Text(isolate, code)).IsNothing()) return;
  isolate->ThrowException(error);
}

void CreateCollectionIterator(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> realm;
  if (!GetContext(args, args[0]).ToLocal(&realm)) return;
  CollectionIterator::Kind kind;
  if (args[1]->StrictEquals(Text(isolate, "map"))) {
    kind = CollectionIterator::Kind::kMap;
  } else if (args[1]->StrictEquals(Text(isolate, "set"))) {
    kind = CollectionIterator::Kind::kSet;
  } else {
    Fail(isolate, "ERR_INVALID_ARG_VALUE", "Iterator kind must be map or set");
    return;
  }
  if (!args[2]->IsFunction()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Iterator steps must be a function");
    return;
  }
  Context::Scope scope(realm);
  Local<Object> iterator;
  if (CollectionIterator::New(realm, kind, args[2].As<Function>())
          .ToLocal(&iterator)) {
    args.GetReturnValue().Set(iterator);
  }
}
#endif

#ifdef NODE_COMPAT_ITERATOR_PREDICATES
template <bool (Value::*predicate)() const>
void IsIterator(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(((*args[0])->*predicate)());
}
#endif

}  // namespace

void InitializeIterators(v8::Local<v8::Object> exports,
                        v8::Local<v8::Context> context,
                        v8::Local<v8::External> vm_data) {
  using namespace v8;
#ifdef NODE_COMPAT_COLLECTION_ITERATORS
  Local<Function> create;
  if (!Function::New(context, CreateCollectionIterator, vm_data).ToLocal(&create) ||
      exports->Set(context, Text(Isolate::GetCurrent(), "createCollectionIterator"), create).IsNothing()) return;
#endif
#ifdef NODE_COMPAT_ITERATOR_PREDICATES
  NODE_SET_METHOD(exports, "isArrayIterator", IsIterator<&Value::IsArrayIterator>);
  NODE_SET_METHOD(exports, "isStringIterator", IsIterator<&Value::IsStringIterator>);
  NODE_SET_METHOD(exports, "isRegExpStringIterator",
                  IsIterator<&Value::IsRegExpStringIterator>);
#endif
}

}  // namespace node_compat
