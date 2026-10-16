#ifndef NODE_COMPAT_ITERATORS_H_
#define NODE_COMPAT_ITERATORS_H_

#include <v8.h>

// Bridge two V8 patches: identify Array/String/RegExp-string iterators so structured
// cloning can reject them without advancing them, and create native Map/Set
// iterators driven by Web IDL callbacks. Stock Node already provides Map/Set detection.
namespace node_compat {
void InitializeIterators(v8::Local<v8::Object> exports,
                        v8::Local<v8::Context> context,
                        v8::Local<v8::External> vm_data);
}  // namespace node_compat

#endif  // NODE_COMPAT_ITERATORS_H_
