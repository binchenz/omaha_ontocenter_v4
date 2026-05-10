export type ObjectEdit =
  | { op: 'create'; objectType: string; properties: Record<string, unknown>; externalId?: string; label?: string }
  | { op: 'update'; objectId: string; properties: Record<string, unknown>; label?: string }
  | { op: 'delete'; objectId: string }
  | { op: 'link'; from: string; to: string; linkType: string }
  | { op: 'unlink'; from: string; to: string; linkType: string };

export interface ApplyContext {
  tenantId: string;
  userId: string;
  dryRun?: boolean;
  batchMode?: boolean;
}

export interface ApplyResult {
  applied: number;
  created: string[];
  errors?: Array<{ index: number; message: string }>;
}
