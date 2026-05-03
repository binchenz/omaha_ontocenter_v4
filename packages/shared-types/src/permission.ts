export interface PermissionRule {
  resource: string;
  action: string;
  fields?: string[];
  conditions?: Record<string, unknown>;
}
