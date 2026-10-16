#ifndef NODE_COMPAT_HTML_ALL_COLLECTION_H_
#define NODE_COMPAT_HTML_ALL_COLLECTION_H_

#include <v8.h>

// Supply document.all's native callable, falsy object. Ordinary JavaScript cannot
// reproduce its typeof/loose-equality behavior, and an outer Proxy loses it.
// Collection lookup and conversion remain in HTML and Web IDL.
namespace node_compat {
void InitializeHTMLAllCollection(v8::Local<v8::Object> exports,
                                v8::Local<v8::Context> context,
                                v8::Local<v8::External> vm_data);
}  // namespace node_compat

#endif  // NODE_COMPAT_HTML_ALL_COLLECTION_H_
