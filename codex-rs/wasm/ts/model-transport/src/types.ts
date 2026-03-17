export type ModelTransportTurnParams<TConfig> = {
  requestId: string;
  config: TConfig;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
};

export type ModelDiscoveryResult<TModel> = {
  data: TModel[];
  nextCursor: string | null;
};

export type ModelTransportAdapter<TConfig, TModel, TResult = unknown> = {
  discoverModels(config: TConfig): Promise<ModelDiscoveryResult<TModel>>;
  runModelTurn(params: ModelTransportTurnParams<TConfig>): Promise<TResult>;
};
