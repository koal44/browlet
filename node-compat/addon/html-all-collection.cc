#include <node.h>
#include "html-all-collection.h"
#include "property-delegate.h"
#include "vm.h"

#include <vector>

namespace node_compat {
namespace {
using namespace v8;

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Fail(Isolate* isolate, const char* code, const char* message) {
  auto error = Exception::TypeError(Text(isolate, message)).As<Object>();
  if (error->Set(isolate->GetCurrentContext(), Text(isolate, "code"),
                 Text(isolate, code)).IsNothing()) return;
  isolate->ThrowException(error);
}

void CallHTMLDDA(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  std::vector<Local<Value>> arguments(args.Length());
  for (int i = 0; i < args.Length(); ++i) arguments[i] = args[i];
  Local<Value> result;
  if (args.Data().As<Function>()->Call(isolate->GetCurrentContext(),
          Undefined(isolate), args.Length(), arguments.data()).ToLocal(&result)) {
    args.GetReturnValue().Set(result);
  }
}

void CreateHTMLDDA(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> realm;
  if (!GetContext(args, args[0]).ToLocal(&realm)) return;
  if (!args[1]->IsFunction()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "HTMLDDA call steps must be a function");
    return;
  }
  Context::Scope scope(realm);
  auto object_template = ObjectTemplate::New(isolate);
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#the-htmlallcollection-interface
  // The caller owns lookup/conversion; V8 supplies [[Call]] and [[IsHTMLDDA]].
  object_template->SetCallAsFunctionHandler(CallHTMLDDA, args[1]);
  object_template->MarkAsUndetectable();
  ConfigurePropertyDelegate(isolate, object_template);
  Local<Object> object;
  if (!object_template->NewInstance(realm).ToLocal(&object)) return;
  InitializePropertyDelegate(realm, object);
  args.GetReturnValue().Set(object);
}

}  // namespace

void InitializeHTMLAllCollection(v8::Local<v8::Object> exports,
                                v8::Local<v8::Context> context,
                                v8::Local<v8::External> vm_data) {
  v8::Local<v8::Function> create;
  if (!v8::Function::New(context, CreateHTMLDDA, vm_data).ToLocal(&create) ||
      exports->Set(context, Text(v8::Isolate::GetCurrent(), "createHTMLDDA"), create).IsNothing()) return;
}

}  // namespace node_compat
