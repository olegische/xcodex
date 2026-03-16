import type { RequestId } from "../../../../app-server-protocol/schema/typescript/RequestId";
import type { PendingRequestEntry } from "./types";

export class PendingServerRequestStore {
  private nextCompatId = 1;
  private readonly byCompatId = new Map<number, PendingRequestEntry>();
  private readonly compatIdByRuntimeId = new Map<RequestId, number>();

  create(method: string, runtimeId: RequestId, params: unknown): PendingRequestEntry {
    const compatId = this.nextCompatId++;
    const entry: PendingRequestEntry = {
      compatId,
      runtimeId,
      method,
      params,
      receivedAtIso: new Date().toISOString()
    };
    this.byCompatId.set(compatId, entry);
    this.compatIdByRuntimeId.set(runtimeId, compatId);
    return entry;
  }

  list(): PendingRequestEntry[] {
    return Array.from(this.byCompatId.values()).sort((left, right) =>
      left.receivedAtIso.localeCompare(right.receivedAtIso)
    );
  }

  getByCompatId(compatId: number): PendingRequestEntry | null {
    return this.byCompatId.get(compatId) ?? null;
  }

  takeByRuntimeId(runtimeId: RequestId): PendingRequestEntry | null {
    const compatId = this.compatIdByRuntimeId.get(runtimeId);
    if (compatId === undefined) {
      return null;
    }
    this.compatIdByRuntimeId.delete(runtimeId);
    const entry = this.byCompatId.get(compatId) ?? null;
    this.byCompatId.delete(compatId);
    return entry;
  }
}
