export type AssistantChannel = 'telegram' | 'api';

export type AssistantTurnStatus = 'processing' | 'completed' | 'failed';

export interface AssistantTurnRecord {
  turn_id: string;
  thread_id: string;
  channel: AssistantChannel;
  status: AssistantTurnStatus;
  ack_message: string;
  follow_up_message: string | null;
  inbox_item_id: string | null;
  extraction_run_id: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AssistantTurnAck {
  turn_id: string;
  thread_id: string;
  ack_message: string;
}

export interface AssistantDelivery {
  sendAck(message: string): Promise<void>;
  sendFollowUp(message: string): Promise<number | null>;
}

export interface StartCaptureInput {
  text: string;
  thread_id: string;
  channel: AssistantChannel;
  received_at: string;
  timezone: string;
  source_reference?: string | null;
  metadata?: Record<string, unknown>;
  delivery: AssistantDelivery;
}

export interface ResolveClarificationInput {
  clarification_id: string;
  inbox_item_id: string;
  answer: string;
  thread_id: string;
  channel: AssistantChannel;
  delivery: AssistantDelivery;
  chat_id?: number;
}
