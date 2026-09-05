#ifndef NODE_COMPAT_PROPERTY_DELEGATE_H_
#define NODE_COMPAT_PROPERTY_DELEGATE_H_

#include <v8.h>

namespace node_compat {
void ConfigurePropertyDelegate(v8::Isolate* isolate, v8::Local<v8::ObjectTemplate> object,
                               bool global = false);
void InitializePropertyDelegate(v8::Local<v8::Context> context,
                                v8::Local<v8::Object> object,
                                bool global = false);
void SetPropertyDelegate(const v8::FunctionCallbackInfo<v8::Value>& args);
}  // namespace node_compat

#endif  // NODE_COMPAT_PROPERTY_DELEGATE_H_
