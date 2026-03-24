import type {
  BrowserToolApprovalBroker,
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
  EmbeddedClientNotification,
  EmbeddedPendingServerRequest,
  EmbeddedPendingServerRequestReply,
} from "./types.ts";

type PendingBrowserToolApproval = {
  id: number;
  method: "item/browserTool/requestApproval";
  receivedAtIso: string;
  params: {
    reason: string;
    request: BrowserToolApprovalRequest;
  };
  resolve: (response: BrowserToolApprovalResponse) => void;
  reject: (error: Error) => void;
};

export function createBrowserToolApprovalBroker(): BrowserToolApprovalBroker {
  let nextPendingRequestId = 1;
  const pendingApprovals = new Map<number, PendingBrowserToolApproval>();
  const notificationListeners = new Set<
    (notification: EmbeddedClientNotification) => void
  >();

  function emitNotification(method: string, params: unknown): void {
    const notification: EmbeddedClientNotification = {
      method,
      params,
      atIso: new Date().toISOString(),
    };
    notificationListeners.forEach((listener) => {
      listener(notification);
    });
  }

  return {
    subscribe(listener) {
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    },
    async requestBrowserToolApproval(
      request: BrowserToolApprovalRequest,
    ): Promise<BrowserToolApprovalResponse> {
      return await new Promise<BrowserToolApprovalResponse>((resolve, reject) => {
        const id = nextPendingRequestId++;
        const pending: PendingBrowserToolApproval = {
          id,
          method: "item/browserTool/requestApproval",
          receivedAtIso: new Date().toISOString(),
          params: {
            reason: formatBrowserToolApprovalReason(request),
            request,
          },
          resolve,
          reject,
        };

        pendingApprovals.set(id, pending);
        emitNotification("server/request", {
          id: pending.id,
          method: pending.method,
          receivedAtIso: pending.receivedAtIso,
          params: pending.params,
        });
      });
    },
    async getPendingServerRequests(): Promise<EmbeddedPendingServerRequest[]> {
      return [...pendingApprovals.values()].map((pending) => ({
        id: pending.id,
        method: pending.method,
        receivedAtIso: pending.receivedAtIso,
        params: pending.params,
      }));
    },
    async replyToServerRequest(
      id: number,
      payload: EmbeddedPendingServerRequestReply,
    ): Promise<void> {
      const pending = pendingApprovals.get(id);
      if (pending === undefined) {
        throw new Error(`No pending browser tool approval found for id ${String(id)}`);
      }

      pendingApprovals.delete(id);
      emitNotification("server/request/resolved", { id });

      if (payload.error !== undefined) {
        pending.reject(new Error(payload.error.message));
        return;
      }

      const result =
        payload.result !== null && typeof payload.result === "object"
          ? (payload.result as Record<string, unknown>)
          : null;
      const decision = result?.decision;

      if (
        decision !== "allow_once" &&
        decision !== "allow_for_session" &&
        decision !== "deny" &&
        decision !== "abort"
      ) {
        pending.reject(new Error("Browser approval reply must include a valid decision."));
        return;
      }

      pending.resolve({ decision });
    },
  };
}

export function formatBrowserToolApprovalReason(
  request: BrowserToolApprovalRequest,
): string {
  const target = request.targetUrl ?? request.targetOrigin ?? request.displayOrigin;
  return [
    `Browser tool approval required for ${request.canonicalToolName}.`,
    request.reason.trim(),
    target === null ? "" : `Target: ${target}`,
    `Mode: ${request.runtimeMode}`,
  ]
    .filter((value) => value.length > 0)
    .join(" ");
}
