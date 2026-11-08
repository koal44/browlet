import { InternalError, type Public } from '../../../infra/index';
import { JSMessageChannel, JSMessagePort, type JSMessagePortHandle, type JSTransferable } from '../../../js-engine/index';
import type { Origin } from '../../../url/index';
import { StorageKey, type StorageEnvironmentBase } from '../../../storage/index';

import type { BroadcastChannelRegistry, BroadcastChannelSource, BroadcastChannelDestination } from '../../communication/index';
import type { SerializedRecord } from '../../scripting/structured-data/index';
import type { UserAgent } from '../../user-agent';

/** Worker-side discovery calls; all registrations still belong to the original browser. */
export class WorkerBroadcastChannels implements Public<BroadcastChannelRegistry> {
  /** Written before worker closing becomes observable, so senders need not wake this isolate. */
  #closing = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  /** Connection-local IDs correlate requests; these are not new environment or channel identities. */
  #nextId = 0;
  /** Retain only IDs, not source channels, after close during serialization. */
  #ids = new WeakMap<BroadcastChannelSource, number>();
  /** Listening-channel retention stays with the global, not the transport. */
  #destinations = new Map<number, WeakRef<BroadcastChannelDestination>>();
  /** One stream preserves DOM-task ordering across every channel in this agent. */
  #port: JSMessagePort<BroadcastMessage> | null = null;
  /** Stop native reception before closing the delivery stream. */
  #stop: (() => void) | null = null;
  /** Collection removes discovery without a blocking host call. */
  #collected: FinalizationRegistry<number>;
  /** Acknowledged host calls select destinations before postMessage returns. */
  #request: (request: WorkerBroadcastRequest, transferList?: JSTransferable[]) => void;

  constructor(
    request: (request: WorkerBroadcastRequest, transferList?: JSTransferable[]) => void,
    release: (id: number) => void,
  ) {
    this.#request = request;
    this.#collected = new FinalizationRegistry((id) => {
      if (this.#destinations.delete(id)) release(id);
    });
  }

  /** Register synchronously; deliveries later enqueue HTML tasks through a weak local destination. */
  register(destination: BroadcastChannelDestination): () => void {
    const id = this.#nextId++;
    const channel = this.#port === null ? new JSMessageChannel<BroadcastMessage>() : null;
    if (channel !== null) {
      this.#port = channel.port1;
      this.#stop = this.#port.listen({
        onMessage: ({ id, serialized, origin }) => this.#destinations.get(id)?.deref()?.receiveMessage(serialized, origin),
        onClose: () => this.disconnect(),
      });
    }
    this.#destinations.set(id, new WeakRef(destination));
    try {
      this.#request({
        type: 'broadcast-register', id, name: destination.name,
        port: channel?.port2.handle ?? null, closing: this.#closing,
      }, channel === null ? [] : [channel.port2.handle]);
    } catch (error) {
      this.#destinations.delete(id);
      if (channel !== null) { this.disconnect(); channel.port2.close(); }
      throw error;
    }
    this.#ids.set(destination, id);
    this.#collected.register(destination, id, destination);
    return () => {
      this.#collected.unregister(destination);
      try { this.#request({ type: 'broadcast-close', id }); }
      finally { this.#destinations.delete(id); }
    };
  }

  /** Publish the already-serialized graph; the browser selects its own storage partition. */
  postMessage(source: BroadcastChannelSource, serialized: SerializedRecord, _origin: Origin): void {
    this.#request({ type: 'broadcast-send', id: this.#ids.get(source)!, name: source.name, serialized });
  }

  /** Reject new selection immediately, including while close()'s current task keeps running. */
  beginClosing(): void { Atomics.store(this.#closing, 0, 1); }

  /** Drop every receiver when the native execution owner disconnects. */
  disconnect(): void {
    this.beginClosing();
    this.#destinations.clear();
    this.#stop?.();
    this.#stop = null;
    this.#port?.close();
    this.#port = null;
  }
}

/** Browser-side registrations for one worker connection; no author objects leave their isolate. */
export class WorkerBroadcastChannelConnection {
  /** The original UserAgent owns the one discovery registry shared with Windows and other workers. */
  #userAgent: UserAgent;
  /** Worker identity and storage partition already assigned by startup. */
  #env: StorageEnvironmentBase;
  /** Dedicated Document activity can be checked without entering a paused worker. */
  #isEligible: (() => boolean) | undefined;
  /** All channels in this worker share delivery order on a single native endpoint. */
  #port: JSMessagePort<BroadcastMessage> | null = null;
  /** Remove peer-close observation during explicit teardown. */
  #stop: (() => void) | null = null;
  /** Strong remote endpoints last only as long as their native connection. */
  #channels = new Map<number, RemoteBroadcastChannel>();

  constructor(userAgent: UserAgent, isEligible: (() => boolean) | undefined, env: StorageEnvironmentBase) {
    this.#userAgent = userAgent;
    this.#env = env;
    this.#isEligible = isEligible;
  }

  /** Apply an ordered registration, publication, or close before acknowledging the worker's call. */
  handle(request: WorkerBroadcastRequest): void {
    const key = StorageKey.obtainForNonStoragePurposes(this.#env);
    if (request.type === 'broadcast-register') {
      if (request.port !== null) {
        this.#port = new JSMessagePort<BroadcastMessage>(request.port);
        this.#stop = this.#port.listen({
          onMessage: () => { throw new InternalError('Broadcast delivery endpoints do not accept requests'); },
          onClose: () => this.close(),
        });
      }
      const isEligible = this.#isEligible;
      if (isEligible === undefined) {
        this.close();
        throw new InternalError('Worker BroadcastChannel requires connected owner eligibility');
      }
      const destination: BroadcastChannelDestination = {
        name: request.name,
        storageKey: key,
        get isEligibleForMessaging() { return Atomics.load(request.closing, 0) === 0 && isEligible(); },
        receiveMessage: (serialized, origin) => { this.#port!.send({ id: request.id, serialized, origin }); },
      };
      const remove = this.#userAgent.broadcastChannels.register(destination);
      this.#channels.set(request.id, { destination, remove });
    } else if (request.type === 'broadcast-close') {
      this.#remove(request.id);
    } else {
      // A getter may close the source during serialization, after the closed-flag
      // check. Publication still proceeds; the now-absent source cannot echo.
      const source = this.#channels.get(request.id)?.destination ?? { name: request.name, storageKey: key };
      this.#userAgent.broadcastChannels.postMessage(source, request.serialized, key.origin);
    }
  }

  /** Release discovery even after forced termination bypasses every inside cleanup callback. */
  close(): void {
    for (const id of this.#channels.keys()) this.#remove(id);
    this.#stop?.();
    this.#stop = null;
    this.#port?.close();
    this.#port = null;
  }

  /** Remove this destination from browser discovery; repeated cleanup is harmless. */
  #remove(id: number): void {
    const entry = this.#channels.get(id);
    if (entry === undefined) return;
    this.#channels.delete(id);
    entry.remove();
  }
}

/** Browser discovery retains this remote destination until close, collection, or thread teardown. */
interface RemoteBroadcastChannel {
  destination: BroadcastChannelDestination;
  /** Remove the destination from the original UserAgent's registry. */
  remove: () => void;
}

/** Trusted service requests; a transferred endpoint is used only for asynchronous destination delivery. */
export type WorkerBroadcastRequest =
  { type: 'broadcast-register'; id: number; name: string; port: JSMessagePortHandle | null; closing: Int32Array<SharedArrayBuffer>; } |
  { type: 'broadcast-send'; id: number; name: string; serialized: SerializedRecord; } |
  { type: 'broadcast-close'; id: number; };

/** HTML serialization records cross the wire; each destination reconstructs independently. */
interface BroadcastMessage {
  /** Select a weak destination on the worker's single ordered delivery stream. */
  id: number;
  serialized: SerializedRecord;
  origin: Origin;
}
