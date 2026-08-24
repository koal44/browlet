# Structured data roadmap

HTML §2.7 owns structured serialization, deserialization, transfer, and the
`structuredClone()` API. These operations serve realms, history, messaging,
workers, and Fetch, so they belong with scripting rather than any one caller.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `serializable.ts` | Serializable-object registry and per-interface serialization/deserialization steps | HTML §2.7.1 |
| `transferable.ts` | Transferable-object registry, transfer steps, receiving steps, and detached state | HTML §2.7.2 |
| `serialize.ts` | Recursive serialization, storage mode, memory/cycle preservation, and supported JavaScript types | HTML §§2.7.3–2.7.6 |
| `transfer.ts` | Serialization/deserialization with transfer lists | HTML §§2.7.7–2.7.8 |
| `structured-clone.ts` | `structuredClone()` and `StructuredSerializeOptions` | HTML §2.7.10 |
| `web-idl.ts` | `WindowOrWorkerGlobalScope` contributions and platform-object serialization hooks | HTML §2.7 and Web IDL serializable/transferable declarations |

Native `structuredClone()` can be an optimization for supported ordinary
values, but it cannot replace Browlet's interface-specific steps, target-realm
object creation, exposure checks, or Web IDL platform-object records. Buffer
detachment must retain the existing expected limitations until the JavaScript
engine exposes every required internal capability.

History state, `postMessage`, workers, and Fetch abort-reason serialization
must consume this one implementation instead of inventing caller-specific
cloning.

MessagePort is the first required transferable platform object. Its transfer
steps move a port's pending message tasks, and its receiving steps reconstruct
and re-entangle a new endpoint in the destination realm. That behavior must be
registered here while queue ownership and delivery remain in
`communication/message-port.ts`; neither side can be replaced by Node's native
MessagePort without an explicit adapter proving the same realm and lifecycle
contract.

## Removal condition

Burn this file after structured serialization and transfer have cross-realm,
cycle, platform-object, and failure coverage through their public consumers.
