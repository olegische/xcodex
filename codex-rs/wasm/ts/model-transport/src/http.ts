export function candidateApiUrls(
  baseUrl: string,
  resource: "models" | "responses",
): string[] {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const urls = [`${normalizedBaseUrl}/${resource}`];
  if (!normalizedBaseUrl.endsWith("/v1") && !normalizedBaseUrl.endsWith("/api/v1")) {
    urls.push(`${normalizedBaseUrl}/v1/${resource}`);
  }
  return urls;
}

export function firstResponsesApiUrl(baseUrl: string): string {
  return candidateApiUrls(baseUrl, "responses")[0] ?? `${baseUrl.replace(/\/+$/, "")}/responses`;
}

export async function sendJsonRequestWithFallback<TError>(params: {
  urls: string[];
  method: "GET" | "POST";
  apiKey: string;
  signal?: AbortSignal;
  body?: Record<string, unknown>;
  fallbackMessage: string;
  createError: (
    code: string,
    message: string,
    data?: unknown,
  ) => TError;
}): Promise<Response> {
  const uniqueUrls = [...new Set(params.urls)];
  let lastError: TError | null = null;

  for (const url of uniqueUrls) {
    const response = await fetch(url, {
      method: params.method,
      signal: params.signal,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        ...(params.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: params.method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
    });
    if (response.ok) {
      return response;
    }
    lastError = await createOpenAiLikeError(response, params.fallbackMessage, params.createError);
    if (response.status !== 404) {
      throw lastError;
    }
  }

  throw lastError ?? params.createError("openaiError", params.fallbackMessage);
}

async function createOpenAiLikeError<TError>(
  response: Response,
  fallbackMessage: string,
  createError: (
    code: string,
    message: string,
    data?: unknown,
  ) => TError,
): Promise<TError> {
  let detail = fallbackMessage;
  try {
    const payload = (await response.json()) as {
      error?: { message?: string; code?: string; type?: string };
    };
    if (typeof payload.error?.message === "string") {
      detail = payload.error.message;
    }
    return createError(payload.error?.code ?? "openaiError", detail, {
      status: response.status,
      type: payload.error?.type ?? null,
    });
  } catch {
    const body = await response.text().catch(() => "");
    return createError("openaiError", detail, { status: response.status, body });
  }
}
