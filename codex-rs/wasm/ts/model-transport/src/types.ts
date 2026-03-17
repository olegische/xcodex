import type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";

export type ModelTransportTurnParams<TConfig> = {
  requestId: string;
  config: TConfig;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
  transportOptions?: Record<string, unknown>;
  emitNotification?: (notification: JsonValue) => Promise<void>;
};

export type ModelDiscoveryResult<TModel> = {
  data: TModel[];
  nextCursor: string | null;
};

export type ModelTransportAdapter<TConfig, TModel, TResult = unknown> = {
  discoverModels(config: TConfig): Promise<ModelDiscoveryResult<TModel>>;
  runModelTurn(params: ModelTransportTurnParams<TConfig>): Promise<TResult>;
};
