export interface AssistantFailure { message: string; code?: string; requestId?: string; retryable: boolean; }
export interface AssistantTurn { id: string; role: 'user' | 'agent'; content: string; failure?: AssistantFailure; }

export function describeAssistantFailure(error: any): AssistantFailure {
  if (error?.name === 'AbortError') return { message: 'Stopped waiting. Your question is retained. Remote processing may still finish.', retryable: true };
  if (error?.name === 'TimeoutError') return { message: 'The Assistant request timed out. Your question is retained; retry when ready.', code: 'MODEL_TIMEOUT', retryable: true };
  return { message: error?.message || 'The Assistant could not be reached. Your question is retained; retry when ready.', code: error?.code, requestId: error?.requestId, retryable: error?.retryable !== false };
}

/** An unanswered last turn can be restored after closing/relaunch without duplicating it. */
export function canRecoverAssistantTurn(messages: AssistantTurn[], id: string, status: string | undefined, busy: boolean) {
  const last = messages.at(-1);
  return !busy && status === 'active' && last?.id === id && last.role === 'user';
}

/** A retry may narrow the original disclosure scope; it never silently adds context. */
export function narrowedAssistantRetry<T extends {includeContext:boolean;research:{web:boolean;scholar:boolean;notebook:boolean};payload?:unknown}>(original:T, controls:{includeContext:boolean;web:boolean;scholar:boolean;notebook:boolean}):T {
  const includeContext=original.includeContext&&controls.includeContext;
  const research={...original.research,web:original.research.web&&controls.web,scholar:original.research.scholar&&controls.scholar,notebook:original.research.notebook&&controls.notebook};
  const changed=includeContext!==original.includeContext||research.web!==original.research.web||research.scholar!==original.research.scholar||research.notebook!==original.research.notebook;
  return changed?{...original,includeContext,research,payload:undefined}:original;
}

export function restoredAssistantTurnId(last:AssistantTurn|undefined, restored:{threadId:string;id:string;prompt:string}|null, threadId:string, draft:string) {
  return restored?.threadId===threadId&&restored.id===last?.id&&last?.role==='user'&&draft===restored.prompt?last.id:undefined;
}

export function assistantHistory(messages: AssistantTurn[], maximum = 24_000) {
  const retained: string[] = []; let size = 0;
  for (const message of messages.slice(-12).reverse()) {
    const text = `${message.role}: ${message.content}`;
    const remaining = maximum - size;
    if (remaining <= 0) break;
    retained.unshift(text.length > remaining ? `[Earlier part of this turn omitted]\n${text.slice(-remaining)}` : text);
    size += text.length + 2;
  }
  return retained.join('\n\n');
}
