export type ConnectorStatus = 'active' | 'inactive' | 'error';

export interface CreateConnectorRequest {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface UpdateConnectorRequest {
  name?: string;
  config?: Record<string, unknown>;
  status?: ConnectorStatus;
}

export interface ConnectorResponse {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
}
