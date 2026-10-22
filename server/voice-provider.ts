import { GoogleGenAI, Modality, Type, type FunctionDeclaration, type LiveServerMessage } from '@google/genai';
import { VOICE_INPUT_MIME, VOICE_OUTPUT_MIME, type VoiceHistoryTurn } from '../shared/voice-contracts';

export interface VoiceToolCall { id: string; name: string; args: Record<string, unknown> }
export interface VoiceProviderEvent {
  audio?: { data: string; mimeType: string }[];
  inputTranscript?: string;
  outputTranscript?: string;
  inputFinished?: boolean;
  outputFinished?: boolean;
  interrupted?: boolean;
  turnComplete?: boolean;
  tools?: VoiceToolCall[];
  cancelledTools?: string[];
  resumption?: { resumable: boolean; handle?: string };
  goAway?: boolean;
}
export interface VoiceConnection {
  sendAudio(data: string): void;
  sendActivity(active: boolean): void;
  sendText(text: string): void;
  interrupt(): void;
  sendToolResponse(id: string, name: string, response: Record<string, unknown>): void;
  close(): void;
}
export interface VoiceProviderOptions {
  apiKey: string;
  model: string;
  systemInstruction: string;
  history: VoiceHistoryTurn[];
  resumeHandle?: string;
  taskControls: boolean;
  signal: AbortSignal;
  onEvent(event: VoiceProviderEvent): void;
  onError(error: unknown): void;
  onClose(code?: number): void;
}
export interface VoiceProvider { connect(options: VoiceProviderOptions): Promise<VoiceConnection> }

/** Normalize every content part, without forwarding thought parts or provider diagnostics. */
export function voiceProviderEvent(message: LiveServerMessage): VoiceProviderEvent {
  const content = message.serverContent;
  const event: VoiceProviderEvent = {};
  const audio = (content?.modelTurn?.parts || []).flatMap(part => {
    const blob = part.inlineData;
    return !part.thought && typeof blob?.data === 'string' && blob.mimeType?.startsWith('audio/pcm')
      ? [{ data: blob.data, mimeType: blob.mimeType || VOICE_OUTPUT_MIME }] : [];
  });
  if (audio.length) event.audio = audio;
  if (typeof content?.inputTranscription?.text === 'string') event.inputTranscript = content.inputTranscription.text;
  if (typeof content?.outputTranscription?.text === 'string') event.outputTranscript = content.outputTranscription.text;
  if (content?.inputTranscription?.finished) event.inputFinished = true;
  if (content?.outputTranscription?.finished) event.outputFinished = true;
  if (content?.interrupted) event.interrupted = true;
  if (content?.turnComplete) event.turnComplete = true;
  if (message.toolCall?.functionCalls?.length) event.tools = message.toolCall.functionCalls.map(call => ({
    id: typeof call.id === 'string' ? call.id : '',
    name: typeof call.name === 'string' ? call.name : '',
    args: call.args && typeof call.args === 'object' ? call.args : {},
  }));
  if (message.toolCallCancellation?.ids) event.cancelledTools = message.toolCallCancellation.ids;
  if (message.sessionResumptionUpdate) event.resumption = {
    resumable: message.sessionResumptionUpdate.resumable === true,
    handle: message.sessionResumptionUpdate.newHandle,
  };
  if (message.goAway) event.goAway = true;
  return event;
}

export function createGeminiVoiceProvider(): VoiceProvider {
  return {
    async connect(options) {
      const ai = new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { apiVersion: 'v1beta' } });
      const declarations: FunctionDeclaration[] = [{
        name: 'prepare_assignment',
        description: 'Prepare a concise proposed instruction for the operator to review in Agent Tasks. This does not create or start a task. Never claim it started.',
        parameters: { type: Type.OBJECT, properties: { instruction: { type: Type.STRING } }, required: ['instruction'] },
      }];
      if (options.taskControls) for (const action of ['status', 'pause', 'cancel']) declarations.push({
        name: `selected_task_${action}`,
        description: action === 'status' ? 'Read the selected Studio task status.' : `${action === 'pause' ? 'Pause' : 'Cancel'} only the selected Studio task, only when the operator explicitly requests it.`,
        parameters: { type: Type.OBJECT, properties: {}, required: [] },
      });
      const session = await ai.live.connect({
        model: options.model,
        config: {
          abortSignal: options.signal,
          responseModalities: [Modality.AUDIO],
          systemInstruction: options.systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
          sessionResumption: options.resumeHandle ? { handle: options.resumeHandle } : {},
          contextWindowCompression: { slidingWindow: {} },
          tools: [{ functionDeclarations: declarations }],
        },
        callbacks: {
          onmessage: message => options.onEvent(voiceProviderEvent(message)),
          onerror: error => options.onError(error),
          onclose: event => options.onClose(event.code),
        },
      });
      if (options.signal.aborted) { session.close(); throw new Error('Voice connection stopped.'); }
      // Resuming already restores history. Never replay speech, text, or tool responses.
      if (!options.resumeHandle && options.history.length) session.sendClientContent({
        turns: options.history.map(turn => ({ role: turn.role === 'agent' ? 'model' : 'user', parts: [{ text: turn.text }] })),
        turnComplete: false,
      });
      return {
        sendAudio: data => session.sendRealtimeInput({ audio: { data, mimeType: VOICE_INPUT_MIME } }),
        sendActivity: active => session.sendRealtimeInput(active ? { activityStart: {} } : { activityEnd: {} }),
        sendText: text => session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }),
        interrupt: () => { session.sendRealtimeInput({ activityStart: {} }); session.sendRealtimeInput({ activityEnd: {} }); },
        sendToolResponse: (id, name, response) => session.sendToolResponse({ functionResponses: [{ id, name, response }] }),
        close: () => session.close(),
      };
    },
  };
}
