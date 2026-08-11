export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogFields {
  job_id?: string;
  ingestion_file_id?: string;
  asset_id?: string;
  processing_stage?: string;
  sqs_message_id?: string;
  attempt?: number;
  provider?: string;
  model?: string;
  duration_ms?: number;
  status?: string;
  error_code?: string;
  trace_id?: string;
  http_method?: string;
  http_path?: string;
  http_status?: number;
  [key: string]: unknown;
}

export interface StructuredLogEntry extends StructuredLogFields {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  error_message?: string;
  stack_trace?: string;
}
