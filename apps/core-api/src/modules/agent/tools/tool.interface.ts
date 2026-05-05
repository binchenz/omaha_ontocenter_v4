import { CurrentUser as CurrentUserType } from '@omaha/shared-types';

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresConfirmation: boolean;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  user: CurrentUserType;
}
