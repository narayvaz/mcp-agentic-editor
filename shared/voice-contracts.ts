/** The relay carries microphone PCM only during an explicitly opened speaking turn. */
export const VOICE_INPUT_MIME = 'audio/pcm;rate=16000' as const;
export const VOICE_OUTPUT_MIME = 'audio/pcm;rate=24000' as const;
export const DEFAULT_VOICE_MODEL = 'gemini-3.8-live';

export interface VoiceHistoryTurn { role: 'user' | 'agent'; text: string }
export interface VoiceSessionRequest {
  threadId: string;
  context?: string;
  history?: VoiceHistoryTurn[];
  selectedTaskId?: string;
}
export interface VoiceStatus {
  ok: true;
  available: boolean;
  provider: 'gemini-live';
  model: string;
  active: boolean;
  /** Availability describes configuration, rather than a paid provider connectivity test. */
  reason?: string;
}
export interface VoiceSessionCreated {
  ok: true;
  id: string;
  sessionId: string;
  websocketPath: string;
  expiresAt: string;
  model: string;
}
export type VoiceClientMessage =
  | { type: 'audio'; data: string; mimeType?: typeof VOICE_INPUT_MIME }
  | { type: 'activity'; active: boolean }
  | { type: 'text'; text: string }
  | { type: 'interrupt' }
  | { type: 'end' };
export type VoiceServerMessage =
  | { type: 'ready'; sessionId: string; model: string }
  | { type: 'audio'; data: string; mimeType: typeof VOICE_OUTPUT_MIME }
  /** Text is an append; an empty final update closes the same turnId. */
  | { type: 'transcript'; role: 'user' | 'agent'; text: string; final: boolean; turnId: string }
  | { type: 'interrupted' }
  | { type: 'turn-complete' }
  | { type: 'task-proposal'; instruction: string }
  | { type: 'task-receipt'; action: 'status' | 'pause' | 'cancel'; task: unknown }
  | { type: 'status'; state: 'connecting' | 'reconnecting'; message: string }
  | { type: 'error'; code: string; message: string };
