// Shared TypeScript types for 语枢 (VoiceHub)

export type RecordingState = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export interface TranscriptResult {
  raw: string;        // raw ASR output
  cleaned: string;    // fast-path: filler words removed
  refined: string;    // precise-path: structured Codex instruction
  intent?: string;    // detected intent (create/modify/debug/etc.)
  confidence?: number;
}

export interface AudioChunk {
  sequenceNumber: number;
  timestamp: number;
  byteLength: number;
}

export interface VADEvent {
  type: 'silence' | 'speech';
  rms: number;
  consecutiveSilenceChunks: number;
}

export interface RefinedInstruction {
  goal: string;
  context: string;
  constraints: string;
  done_when: string;
  intent: 'Create' | 'Modify' | 'Delete' | 'Query' | 'Debug' | 'Refactor' | 'Test' | 'Document' | 'Unknown';
  confidence: number;
  raw_input: string;
  cleaned_input: string;
  processing_ms: number;
}

export interface PromptHistoryItem {
  id: string;
  prompt: string;
  preview?: string;
  intent: RefinedInstruction['intent'];
  createdAt: number;
}
