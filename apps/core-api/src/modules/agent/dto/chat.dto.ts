import { IsString, IsOptional } from 'class-validator';

export class ChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  fileId?: string;

  /** The Surface this message originates from; sets a new Conversation's surface
   * at creation (ADR-0041 §3). Ignored for an existing Conversation. */
  @IsOptional()
  @IsString()
  surface?: string;
}
