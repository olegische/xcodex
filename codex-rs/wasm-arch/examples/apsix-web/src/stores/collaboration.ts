import { get, writable } from "svelte/store";
import type {
  JsonValue,
  RequestUserInputQuestion,
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../runtime/types";
import type { PendingApproval } from "../types";

export type CollaborationRequest = {
  id: string;
  title: string;
  questions: RequestUserInputQuestion[];
};

type CollaborationState = {
  currentRequest: CollaborationRequest | null;
  queuedRequests: CollaborationRequest[];
  pendingApprovals: PendingApproval[];
};

type PendingResolver = {
  resolve: (response: RequestUserInputResponse) => void;
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
        questions: request.questions,
      };

      return new Promise((resolve) => {
        pendingResolvers.set(collaborationRequest.id, { resolve });
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
      pendingResolvers.get(currentRequest.id)?.resolve({ answers });
      pendingResolvers.delete(currentRequest.id);
      update(shiftQueue);
    },
    cancelCurrentRequest() {
      const state = get({ subscribe });
      const currentRequest = state.currentRequest;
      if (currentRequest === null) {
        return;
      }
      const answers = currentRequest.questions.map((question) => ({
        id: question.id,
        value: findDismissValue(question),
      }));
      pendingResolvers.get(currentRequest.id)?.resolve({ answers });
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

export const collaborationStore = createCollaborationStore();
