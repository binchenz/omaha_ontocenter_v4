export interface CreateConnectorRequest {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface UpdateConnectorRequest {
  name?: string;
  config?: Record<string, unknown>;
  status?: string;
}

export interface ConnectorResponse {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}
