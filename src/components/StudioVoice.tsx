import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';
import { request, jsonBody } from '../lib/studio';
import { acceptsVoiceCapturePacket, decodeVoicePcm, encodeVoicePcm, guardVoiceMicrophone, voiceHistory, VoiceResampler, VoiceTranscripts, voicePlaybackWindow, type VoiceTranscript } from '../lib/voice-audio';
import './StudioVoice.css';

type VoiceStatus = { available: boolean; model?: string; reason?: string; active?: boolean };
type VoiceResources = {
  context: AudioContext; stream: MediaStream; input: MediaStreamAudioSourceNode; worklet: AudioWorkletNode; sink: GainNode;
  socket?: WebSocket; resampler: VoiceResampler; playing: Set<AudioBufferSourceNode>; queuedUntil: number;
  capture: boolean; captureId: number; ready: boolean; transcripts: VoiceTranscripts; model?: string; sessionId?: string; connectTimer?: ReturnType<typeof setTimeout>; receipts: Set<string>;
  finishingCapture?: { id: number; timer: ReturnType<typeof setTimeout> };
};
type Props = {
  threadId: string; disabled?: boolean; disabledReason?: string; storyLabel: string;
  getContext: (signal: AbortSignal) => Promise<string>;
  history: { role: 'user' | 'agent'; text: string }[];
  onTranscript: (transcript: VoiceTranscript & { modelUsed?: string; warning?: string }) => void;
  onActiveChange: (active: boolean) => void;
  onTaskProposal?: (instruction: string) => void;
};

function describeMicrophoneError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone access was denied. Enable Azat Studio in macOS System Settings → Privacy & Security → Microphone, then start voice again. You can keep using text.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect a microphone or keep using text.';
  if (name === 'NotReadableError') return 'The microphone is unavailable or in use. Check its connection and try again, or use text.';
  return error instanceof Error ? error.message : 'Voice could not start. You can keep using text.';
}
function voiceWindowIsForeground() { return document.visibilityState === 'visible' && document.hasFocus(); }

/** One explicit, local desktop voice session. It owns and disposes every media resource. */
export default function StudioVoice(props: Props) {
  const [expanded, setExpanded] = useState(false), [status, setStatus] = useState<VoiceStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'ready' | 'reconnecting'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [capture, setCaptureState] = useState(false);
  const [pending, setPending] = useState<VoiceTranscript[]>([]), [proposal, setProposal] = useState('');
  const [tasks, setTasks] = useState<{ id: string; instruction: string; status: string }[]>([]), [taskId, setTaskId] = useState('');
  const [sessionStoryLabel, setSessionStoryLabel] = useState('');
  const [voiceDraft, setVoiceDraft] = useState(''), [receipt, setReceipt] = useState<{ status: string; instruction: string; summary: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const resources = useRef<VoiceResources | null>(null), generation = useRef(0), mounted = useRef(true), starting = useRef<AbortController | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const latched = useRef(false);
  const active = phase !== 'idle';

  function stopPlayback(resource = resources.current) {
    if (!resource) return;
    for (const source of resource.playing) { try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
    resource.playing.clear(); resource.queuedUntil = resource.context.currentTime;
    if (mounted.current) setSpeaking(false);
  }
  function send(value: unknown, resource = resources.current) {
    if (resource?.socket?.readyState === WebSocket.OPEN) resource.socket.send(JSON.stringify(value));
  }
  function finishCapture(resource: VoiceResources) {
    if (!resource.finishingCapture) return;
    clearTimeout(resource.finishingCapture.timer); resource.finishingCapture = undefined;
    resource.resampler.reset(); send({ type: 'activity', active: false }, resource);
  }
  function setCapture(next: boolean, flush = true) {
    const resource = resources.current;
    if (!resource || (!resource.ready && next)) return;
    if (resource.capture === next && (flush || !resource.finishingCapture)) return;
    if (next) {
      finishCapture(resource); resource.capture = true; resource.captureId++; resource.resampler.reset();
      resource.worklet.port.postMessage({ active: true, captureId: resource.captureId });
      stopPlayback(resource); send({ type: 'activity', active: true }, resource);
    } else {
      resource.capture = false;
      if (flush && resource.ready) {
        const id = resource.captureId;
        // Only previously captured frames may drain. A suspended/hung worklet cannot hold the turn open.
        const timer = setTimeout(() => {
          if (resources.current === resource && resource.finishingCapture?.id === id) { resource.captureId++; finishCapture(resource); }
        }, 150);
        resource.finishingCapture = { id, timer };
        resource.worklet.port.postMessage({ active: false, captureId: id, flush: true });
      } else {
        const finishing = !!resource.finishingCapture;
        resource.captureId++;
        resource.worklet.port.postMessage({ active: false, captureId: resource.captureId });
        if (finishing) finishCapture(resource);
        else { resource.resampler.reset(); send({ type: 'activity', active: false }, resource); }
      }
    }
    for (const track of resource.stream.getAudioTracks()) track.enabled = next;
    if (mounted.current) setCaptureState(next);
  }
  function end(message = '', savePartial = true) {
    generation.current++; starting.current?.abort(); starting.current = null;
    const resource = resources.current; resources.current = null; latched.current = false;
    if (resource) {
      clearTimeout(resource.connectTimer);
      if (resource.finishingCapture) { clearTimeout(resource.finishingCapture.timer); resource.finishingCapture = undefined; }
      resource.ready = false; resource.capture = false;
      for (const track of resource.stream.getTracks()) track.stop();
      resource.worklet.port.onmessage = null; resource.worklet.port.close();
      resource.input.disconnect(); resource.worklet.disconnect(); resource.sink.disconnect(); stopPlayback(resource);
      if (savePartial) for (const item of resource.transcripts.finish()) callbacks.current.onTranscript({ ...item, modelUsed: resource.model, warning: 'Voice session ended before this transcript was complete.' });
      if (resource.socket) {
        resource.socket.onopen = resource.socket.onmessage = resource.socket.onerror = resource.socket.onclose = null;
        send({ type: 'end' }, resource); resource.socket.close();
      }
      if (resource.sessionId) void request(`/api/voice/sessions/${encodeURIComponent(resource.sessionId)}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => {});
      void resource.context.close().catch(() => {});
    }
    callbacks.current.onActiveChange(false);
    if (mounted.current) { setPhase('idle'); setCaptureState(false); setPending([]); if (message) setNotice(message); }
  }

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    if (!window.studioDesktop) { setStatus({ available: false, reason: 'Live voice currently requires the Azat Studio desktop app. Mobile access will use the future secure gateway.' }); return () => controller.abort(); }
    request<VoiceStatus>('/api/voice/status', { signal: controller.signal }).then(setStatus).catch(error => { if (!controller.signal.aborted) setStatus({ available: false, reason: error.message }); });
    request<{ runs: { id: string; instruction: string; status: string }[] }>('/api/agent-runtime/runs', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setTasks((result.runs || []).slice(0, 50)); }).catch(() => {});
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.visibilityState === 'hidden' && (resources.current || starting.current)) end('Voice ended because Studio moved to the background. Start again when ready.'); };
    const blur = () => { if (resources.current) end('Voice ended because Studio lost focus. Start again when ready.'); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('blur', blur);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', blur); end(); };
  }, []);

  async function start() {
    if (resources.current || starting.current || props.disabled || status?.available !== true) return;
    const current = ++generation.current, abort = new AbortController(); starting.current = abort;
    setPhase('starting'); setError(''); setNotice(''); setProposal(''); setPending([]); setReceipt(null); setSessionStoryLabel(props.storyLabel); callbacks.current.onActiveChange(true);
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    const valid = () => mounted.current && current === generation.current && !abort.signal.aborted;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable here. Open the installed Azat Studio app.');
      // The permission request and audio resume both begin inside this explicit button gesture.
      const microphone = guardVoiceMicrophone(navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }), valid);
      // These handlers also own late rejections when another setup step fails first.
      void microphone.catch(() => {});
      context = new AudioContext(); const resumed = context.resume(); void resumed.catch(() => {});
      stream = await microphone;
      if (!valid()) { stream.getTracks().forEach(track => track.stop()); await context.close(); return; }
      if (!voiceWindowIsForeground()) throw new Error('Return to the Studio window and start voice again.');
      stream.getAudioTracks().forEach(track => { track.enabled = false; });
      await resumed;
      await context.audioWorklet.addModule('/voice-capture-worklet.js');
      if (!valid()) { stream.getTracks().forEach(track => track.stop()); await context.close(); return; }
      if (!voiceWindowIsForeground()) throw new Error('Return to the Studio window and start voice again.');
      const input = context.createMediaStreamSource(stream), worklet = new AudioWorkletNode(context, 'studio-voice-capture'), sink = context.createGain(); sink.gain.value = 0;
      input.connect(worklet); worklet.connect(sink); sink.connect(context.destination);
      const resource: VoiceResources = { context, stream, input, worklet, sink, resampler: new VoiceResampler(context.sampleRate), playing: new Set(), queuedUntil: 0, capture: false, captureId: 0, ready: false, transcripts: new VoiceTranscripts(), receipts: new Set() };
      resources.current = resource;
      const contextText = await props.getContext(abort.signal);
      const desktop = await window.studioDesktop!.getSession();
      if (!valid()) return;
      if (desktop.origin !== window.location.origin || !/^[a-f0-9]{64}$/.test(desktop.token)) throw new Error('The desktop session does not match this workspace.');
      const session = await request<{ sessionId: string; websocketPath: string; model?: string }>('/api/voice/sessions', { ...jsonBody('POST', { threadId: props.threadId, context: contextText.slice(0, 24000), history: voiceHistory(props.history), ...(taskId ? { selectedTaskId: taskId } : {}) }), signal: abort.signal });
      resource.sessionId = session.sessionId;
      if (!valid()) { void request(`/api/voice/sessions/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => {}); return; }
      const url = new URL(session.websocketPath, desktop.origin);
      if (url.origin !== desktop.origin || url.pathname !== '/ws/voice' || url.searchParams.get('sessionId') !== session.sessionId) throw new Error('The voice connection address was invalid.');
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      resource.model = session.model;
      const socket = new WebSocket(url, [`azat-session.${desktop.token}`]); resource.socket = socket;
      const connectTimer = setTimeout(() => { if (valid() && !resource.ready) { setError('Voice did not connect in time. Try again or keep using text.'); end(); } }, 30000); resource.connectTimer = connectTimer;
      socket.onclose = () => { clearTimeout(connectTimer); if (valid()) end('Voice connection ended. Your text chat is available.'); };
      socket.onerror = () => { if (valid()) { clearTimeout(connectTimer); setError('Voice could not connect. Try again or keep using text.'); end(); } };
      socket.onmessage = event => {
        if (!valid() || resources.current !== resource) return;
        try {
          const packet = JSON.parse(String(event.data));
          if (packet.type === 'ready') { clearTimeout(connectTimer); resource.ready = true; starting.current = null; resource.model = packet.model || resource.model; setPhase('ready'); setNotice('Connected. Hold to speak; release to hear Studio.'); }
          else if (packet.type === 'status' && packet.state === 'reconnecting') { resource.ready = false; setCapture(false, false); latched.current = false; stopPlayback(resource); setPhase('reconnecting'); setNotice('Reconnecting. The microphone is muted; press to speak again after connection returns.'); }
          else if (packet.type === 'audio') {
            if (!resource.ready || resource.capture) return;
            const rateMatch = /^audio\/pcm;rate=(\d+)$/.exec(packet.mimeType || '');
            const rate = rateMatch ? Number(rateMatch[1]) : 24000;
            if (rate < 8000 || rate > 48000) throw new Error('Studio received an unsupported voice sample rate.');
            const samples = decodeVoicePcm(packet.data); if (!samples.length) return;
            const schedule = voicePlaybackWindow(context!.currentTime, resource.queuedUntil, samples.length / rate);
            const buffer = context!.createBuffer(1, samples.length, rate); buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
            const source = context!.createBufferSource(); source.buffer = buffer; source.connect(context!.destination); resource.playing.add(source); resource.queuedUntil = schedule.end;
            source.onended = () => { resource.playing.delete(source); source.disconnect(); if (valid() && !resource.playing.size) setSpeaking(false); }; source.start(schedule.start); setSpeaking(true);
          } else if (packet.type === 'interrupted') stopPlayback(resource);
          else if (packet.type === 'transcript' && ['user', 'agent'].includes(packet.role) && typeof packet.turnId === 'string' && typeof packet.text === 'string') {
            const completed = resource.transcripts.append({ role: packet.role, text: packet.text, turnId: packet.turnId, final: packet.final === true });
            if (completed) callbacks.current.onTranscript({ ...completed, modelUsed: resource.model });
            setPending(resource.transcripts.pending());
          } else if (packet.type === 'task-receipt' && packet.task && typeof packet.task.id === 'string' && typeof packet.task.status === 'string') {
            const key = `${packet.task.id}:${packet.task.revision}:${packet.action}`;
            if (!resource.receipts.has(key)) {
              resource.receipts.add(key);
              const status = ({ 'waiting-approval': 'Needs approval', 'waiting-input': 'Needs your answer', cancelled: 'Stopped' }[packet.task.status] || packet.task.status) as string;
              const actual = { status, instruction: String(packet.task.instruction || '').slice(0, 4000), summary: String(packet.task.summary || '').slice(0, 2000) };
              setReceipt(actual);
              callbacks.current.onTranscript({ role: 'agent', turnId: key, text: `Studio task record: ${status}\n${actual.instruction}${actual.summary ? `\n${actual.summary}` : ''}`, warning: 'Task state returned by Studio.' });
            }
          } else if (packet.type === 'task-proposal' && typeof packet.instruction === 'string') setProposal(packet.instruction.slice(0, 12000));
          else if (packet.type === 'error') { setError(typeof packet.message === 'string' ? packet.message : 'The voice provider returned an error.'); end(); }
        } catch (error) { setError(describeMicrophoneError(error)); end(); }
      };
      worklet.port.onmessage = event => {
        if (!valid() || resources.current !== resource || !resource.ready || !acceptsVoiceCapturePacket(event.data.captureId, resource.captureId, resource.capture, resource.finishingCapture?.id) || !(event.data.samples instanceof Float32Array)) return;
        if (socket.bufferedAmount > 256000) { setCapture(false, false); latched.current = false; setError('The connection fell behind. Your microphone was muted; try a shorter turn.'); return; }
        const samples = resource.resampler.process(event.data.samples);
        if (samples.length) send({ type: 'audio', data: encodeVoicePcm(samples), mimeType: 'audio/pcm;rate=16000' }, resource);
        if (event.data.ended === true && resource.finishingCapture?.id === event.data.captureId) finishCapture(resource);
      };
      for (const track of stream.getTracks()) track.addEventListener('ended', () => { if (valid()) end('The microphone disconnected. Connect it and start voice again.'); }, { once: true });
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (context && !resources.current && context.state !== 'closed') void context.close().catch(() => {});
      if (!valid()) return;
      setError(describeMicrophoneError(error)); end();
    }
  }

  function sendVoiceText() {
    if (!voiceDraft.trim() || phase !== 'ready') return;
    latched.current = false; setCapture(false, false); stopPlayback();
    send({ type: 'text', text: voiceDraft.trim().slice(0, 6000) }); setVoiceDraft('');
  }

  const ready = phase === 'ready';
  return <section className="studio-voice" aria-label="Live voice collaboration">
    <button type="button" className="studio-voice-heading" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><Mic size={15}/><strong>Talk to Studio</strong>{active && <span className="studio-voice-dot" aria-label="Voice connected"/>}{expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
    {!expanded && active && <div className="studio-voice-minimized"><span role="status">{capture ? 'Microphone on' : phase === 'ready' ? 'Voice connected · microphone muted' : 'Connecting voice…'}</span><button type="button" className="btn" onClick={() => end('Voice ended. Continue in text or start another call.')}><PhoneOff size={14}/> End voice</button></div>}
    {expanded && <div className="studio-voice-body">
      <p className="local-note">Live conversation with Gemini. Voice transcripts stay in this chat. {active ? sessionStoryLabel : props.storyLabel}</p>
      {!active && <><label className="studio-voice-task">Task to collaborate on<select value={taskId} onChange={event => setTaskId(event.target.value)} disabled={props.disabled}><option value="">Conversation only</option>{tasks.map(task => <option key={task.id} value={task.id}>{String(task.instruction || 'Untitled task').slice(0, 65)} · {task.status}</option>)}</select></label>{taskId && <p className="local-note">Voice may check, pause or stop this task when you ask. New assignments and website changes require screen review.</p>}</>}
      {status && !status.available && <p role="status" className="studio-voice-error">{status.reason || 'Configure a Gemini API key in Settings to use voice.'}</p>}
      {!active && props.disabledReason && <p className="local-note">{props.disabledReason}</p>}
      {!active && <div className="actions"><button type="button" className="btn btn-primary" disabled={props.disabled || status?.available !== true} onClick={() => void start()}><Mic size={14}/> Start voice</button><button type="button" className="text-btn" onClick={() => setRefresh(value => value + 1)}>Check connection</button></div>}
      {active && <div className="studio-voice-controls">
        <button type="button" className={`btn ${capture && !latched.current ? 'btn-primary' : ''}`} disabled={!ready || latched.current} aria-pressed={capture && !latched.current}
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setCapture(true); }}
          onPointerUp={() => { if (!latched.current) setCapture(false); }} onPointerCancel={() => { if (!latched.current) setCapture(false); }}
          onKeyDown={event => { if ([' ', 'Enter'].includes(event.key) && !event.repeat) { event.preventDefault(); setCapture(true); } }}
          onKeyUp={event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!latched.current) setCapture(false); } }}
          onBlur={() => { if (!latched.current) setCapture(false); }}><Mic size={14}/> Hold to speak</button>
        <button type="button" className="btn" disabled={!ready} onClick={() => { latched.current = !latched.current; setCapture(latched.current); }}>{latched.current ? <MicOff size={14}/> : <Mic size={14}/>} {latched.current ? 'Finish & mute' : 'Start a longer turn'}</button>
        <button type="button" className="btn" disabled={!ready} onClick={() => { latched.current = false; setCapture(false, false); stopPlayback(); send({ type: 'interrupt' }); }}><VolumeX size={14}/> Interrupt</button>
        <button type="button" className="btn" onClick={() => end('Voice ended. Continue here in text or start another call.')}><PhoneOff size={14}/> End</button>
      </div>}
      {active && <div className="studio-voice-text"><label htmlFor={`voice-text-${props.threadId}`}>Type for a spoken reply</label><div className="actions"><input id={`voice-text-${props.threadId}`} value={voiceDraft} maxLength={6000} onChange={event => setVoiceDraft(event.target.value)} disabled={!ready} placeholder="Exact names or a question…" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); sendVoiceText(); } }}/><button type="button" className="btn" disabled={!ready || !voiceDraft.trim()} onClick={sendVoiceText}>Send</button></div></div>}
      <p className="studio-voice-state" role="status">{phase === 'starting' ? 'Connecting voice…' : phase === 'reconnecting' ? 'Reconnecting · microphone muted' : capture ? 'Microphone on · Studio receives this turn' : speaking && ready ? 'Studio speaking · microphone muted' : ready ? 'Microphone muted · press to speak' : notice}</p>
      {error && <p role="alert" className="studio-voice-error">{error}</p>}
      {pending.length > 0 && <div className="studio-voice-transcript" aria-live="polite">{pending.map(item => <p key={`${item.role}:${item.turnId}`}><strong>{item.role === 'user' ? 'You' : 'Studio'} · live</strong><br/>{item.text}</p>)}</div>}
      {receipt && <div className="studio-voice-receipt" role="status"><strong>Studio task record · {receipt.status}</strong><p>{receipt.instruction}</p>{receipt.summary && <p>{receipt.summary}</p>}</div>}
      {proposal && <div className="studio-voice-proposal"><strong>Suggested assignment</strong><p>{proposal}</p>{props.onTaskProposal && <button type="button" className="btn" onClick={() => { const instruction = proposal; end(); props.onTaskProposal?.(instruction); }}>Prepare task for review</button>}<p className="local-note">This suggestion has not started a task.</p></div>}
      <p className="local-note">Microphone turns, typed voice questions, recent chat, included story context and selected task records are sent to Google. Headphones reduce echo. Voice ends when you switch chats, leave Studio or close the assistant. Use the text box below whenever voice is unavailable.</p>
    </div>}
  </section>;
}
