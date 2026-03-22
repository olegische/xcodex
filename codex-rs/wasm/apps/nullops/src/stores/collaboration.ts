import { get, writable } from "svelte/store";
import type {
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
  JsonValue,
  RequestUserInputQuestion,
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../runtime/types";
import type { PendingApproval } from "../types";

export type CollaborationRequest = {
  id: string;
  title: string;
  kind: "user_input" | "browser_tool_approval";
  questions: RequestUserInputQuestion[];
  approvalDecisionMap?: Record<string, BrowserToolApprovalResponse["decision"]>;
};

type CollaborationState = {
  currentRequest: CollaborationRequest | null;
  queuedRequests: CollaborationRequest[];
  pendingApprovals: PendingApproval[];
};

type PendingResolver = {
  kind: "user_input" | "browser_tool_approval";
  resolve: (
    response: RequestUserInputResponse | BrowserToolApprovalResponse,
  ) => void;
};

const initialState: CollaborationState = {
  currentRequest: null,
  queuedRequests: [],
  pendingApprovals: [],
};

let nextRequestId = 1;
const pendingResolvers = new Map<string, PendingResolver>();

function createCollaborationStore() {
  const { subscribe, update } = writable<CollaborationState>(initialState);

  function syncApprovals(
    currentRequest: CollaborationRequest | null,
    queuedRequests: CollaborationRequest[],
  ): CollaborationState["pendingApprovals"] {
    return [currentRequest, ...queuedRequests]
      .filter((request): request is CollaborationRequest => request !== null)
      .map((request) => ({
        id: request.id,
        title: request.title,
        detail: request.questions.map((question) => question.question).join("\n\n"),
        status: "pending" as const,
      }));
  }

  function shiftQueue(state: CollaborationState): CollaborationState {
    const [nextRequest, ...remainingRequests] = state.queuedRequests;
    return {
      currentRequest: nextRequest ?? null,
      queuedRequests: remainingRequests,
      pendingApprovals: syncApprovals(nextRequest ?? null, remainingRequests),
    };
  }

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    requestUserInput(request: RequestUserInputRequest): Promise<RequestUserInputResponse> {
      const collaborationRequest: CollaborationRequest = {
        id: `collaboration-${nextRequestId++}`,
        title: request.questions[0]?.header || "User input",
        kind: "user_input",
        questions: request.questions,
      };

      return new Promise((resolve) => {
        pendingResolvers.set(collaborationRequest.id, {
          kind: "user_input",
          resolve: resolve as PendingResolver["resolve"],
        });
        update((state) => {
          if (state.currentRequest === null) {
            return {
              currentRequest: collaborationRequest,
              queuedRequests: state.queuedRequests,
              pendingApprovals: syncApprovals(collaborationRequest, state.queuedRequests),
            };
          }
          const queuedRequests = [...state.queuedRequests, collaborationRequest];
          return {
            currentRequest: state.currentRequest,
            queuedRequests,
            pendingApprovals: syncApprovals(state.currentRequest, queuedRequests),
          };
        });
      });
    },
    requestBrowserToolApproval(
      request: BrowserToolApprovalRequest,
    ): Promise<BrowserToolApprovalResponse> {
      const { question, approvalDecisionMap } = buildBrowserToolApprovalQuestion(request);
      const collaborationRequest: CollaborationRequest = {
        id: `collaboration-${nextRequestId++}`,
        title: `Approve ${request.canonicalToolName}`,
        kind: "browser_tool_approval",
        questions: [question],
        approvalDecisionMap,
      };

      return new Promise((resolve) => {
        pendingResolvers.set(collaborationRequest.id, {
          kind: "browser_tool_approval",
          resolve: resolve as PendingResolver["resolve"],
        });
        update((state) => {
          if (state.currentRequest === null) {
            return {
              currentRequest: collaborationRequest,
              queuedRequests: state.queuedRequests,
              pendingApprovals: syncApprovals(collaborationRequest, state.queuedRequests),
            };
          }
          const queuedRequests = [...state.queuedRequests, collaborationRequest];
          return {
            currentRequest: state.currentRequest,
            queuedRequests,
            pendingApprovals: syncApprovals(state.currentRequest, queuedRequests),
          };
        });
      });
    },
    submitCurrentAnswer(answers: Array<{ id: string; value: JsonValue }>) {
      const state = get({ subscribe });
      const currentRequest = state.currentRequest;
      if (currentRequest === null) {
        return;
      }
      const pendingResolver = pendingResolvers.get(currentRequest.id);
      if (pendingResolver?.kind === "browser_tool_approval") {
        const answer = answers[0]?.value;
        const decision =
          typeof answer === "string"
            ? currentRequest.approvalDecisionMap?.[answer] ?? "abort"
            : "abort";
        pendingResolver.resolve({ decision });
      } else {
        pendingResolver?.resolve({ answers });
      }
      pendingResolvers.delete(currentRequest.id);
      update(shiftQueue);
    },
    cancelCurrentRequest() {
      const state = get({ subscribe });
      const currentRequest = state.currentRequest;
      if (currentRequest === null) {
        return;
      }
      const pendingResolver = pendingResolvers.get(currentRequest.id);
      if (pendingResolver?.kind === "browser_tool_approval") {
        pendingResolver.resolve({ decision: "abort" });
        pendingResolvers.delete(currentRequest.id);
        update(shiftQueue);
        return;
      }
      const answers = currentRequest.questions.map((question) => ({
        id: question.id,
        value: findDismissValue(question),
      }));
      pendingResolver?.resolve({ answers });
      pendingResolvers.delete(currentRequest.id);
      update(shiftQueue);
    },
  };
}

function findDismissValue(question: RequestUserInputQuestion): string {
  const dismissOption = question.options.find((option) => {
    const label = option.label.toLowerCase();
    return label.includes("reject") || label.includes("decline") || label.includes("cancel");
  });
  return dismissOption?.label ?? "";
}

function buildBrowserToolApprovalQuestion(
  request: BrowserToolApprovalRequest,
): {
  question: RequestUserInputQuestion;
  approvalDecisionMap: Record<string, BrowserToolApprovalResponse["decision"]>;
} {
  const target = request.targetUrl ?? request.targetOrigin ?? request.displayOrigin;
  const availableDecisions = request.grantOptions.length > 0
    ? request.grantOptions
    : (["deny", "abort"] satisfies BrowserToolApprovalResponse["decision"][]);
  const approvalDecisionMap = Object.fromEntries(
    availableDecisions.map((decision) => {
      switch (decision) {
        case "allow_once":
          return ["Allow once", decision];
        case "allow_for_session":
          return ["Allow for session", decision];
        case "deny":
          return ["Deny", decision];
        case "abort":
          return ["Abort", decision];
      }
    }),
  );

  return {
    question: {
      header: "Browser approval",
      id: `browser-approval-${request.canonicalToolName}`,
      question: [
        `${request.canonicalToolName} requires approval.`,
        request.reason.trim(),
        `Target: ${target}`,
        `Mode: ${request.runtimeMode}`,
      ]
        .filter((value) => value.length > 0)
        .join("\n\n"),
      options: availableDecisions.map((decision) => {
        switch (decision) {
          case "allow_once":
            return {
              label: "Allow once",
              description: "Grant this action only for the current turn.",
            };
          case "allow_for_session":
            return {
              label: "Allow for session",
              description: "Keep this grant for the current runtime session.",
            };
          case "deny":
            return {
              label: "Deny",
              description: "Block this action and let the runtime continue with a denial.",
            };
          case "abort":
            return {
              label: "Abort",
              description: "Cancel the approval request without granting access.",
            };
        }
      }),
    },
    approvalDecisionMap,
  };
}

export const collaborationStore = createCollaborationStore();
