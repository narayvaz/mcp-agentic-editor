# Talk to Studio

Version 0.4 adds a Gemini Live conversation inside Assistant. It uses the saved Google AI connection through Studio's authenticated local backend. No additional hosted media account is required for this desktop increment. Shared mobile access and server execution are separate work.

## Start and switch modes

1. Open **Assistant** or press **⌘K**. Select a chat, or create a new one.
2. Check **Include story** before starting. Voice sends the included story excerpt and bounded recent chat to Google, together with the speech you choose to send.
3. Open **Talk to Studio**. Leave **Conversation only** selected, or deliberately select one saved task for status, pause and stop controls.
4. Choose **Start voice**. On first use, allow Azat Studio microphone access in the macOS prompt. No camera permission is requested.
5. **Hold to speak**, then release to hear the reply. **Start a longer turn** keeps that speaking turn open until **Finish & mute**. Interrupt stops speech; it does not cancel a task.
6. Choose **End** to release the microphone and return to the ordinary text composer. Changing chats, closing Assistant or leaving the Studio window also ends voice. You can start another call in the same retained chat.

Transcripts appear in the current chat and are stored locally with it. They may misrecognize names, dates or numbers; correct important details before using an instruction. Raw microphone audio is not saved as a recording by Studio. Google processes the transmitted audio under the selected service/account's terms.

## Working together

Voice can discuss included evidence, propose a new assignment, and check, pause or cancel the one explicitly attached task. A suggested assignment has not started: **Prepare task for review** opens the existing Agent tasks workspace, where the operator reviews the instruction and tools before Start. Visible task receipts report retained state independently of model speech.

Website edits still require the existing exact-action review and approval. A generic spoken “yes”, a quoted source or an ambient voice cannot approve a WordPress write. No shell execution, app update, pipeline-start or broadcast control is added to the voice model. The conversation is private operator audio and is not routed to live distribution.

**Stop speaking**, **pause task**, **cancel task** and **End voice** have different effects. None can undo a write already sent. Ending the voice connection leaves accepted task state intact, but this desktop release still requires Studio to remain open for execution.

## Connection behavior

- The default voice model is `gemini-3.8-live`. Actual model access and quota must succeed; saved configuration alone is not a connectivity result. An operator can set `AZAT_VOICE_MODEL` when launching a test/deployment that requires another compatible model.
- Calls are bounded to 20 minutes and end after three minutes without operator input. Start a new call to continue. These are duration limits, not a monetary spending cap.
- Provider connection turnover can resume only with a valid resumption handle. The relay never buffers/replays microphone turns or repeats a task control to repair a connection. An interrupted or uncertain control requires checking the retained task state.
- Provider outages/quota failures produce actionable messages. End voice to use text; Google provider problems can affect text as well.
- Use headphones to reduce echo. Permission denial, missing microphones and device loss leave text available. If permission was denied, use **System Settings → Privacy & Security → Microphone → Azat Studio**, then retry.

## Verification boundary

Automated checks cover PCM resampling/playback bounds, transcript identity, microphone cleanup, exact-window/origin/audio permissions, authenticated reservations and WebSockets, bounded sessions, provider errors, reconnect fencing and task-control receipts. A live provider test uses an artificial phrase, without room audio or website changes. Native permission, playback, end/restart, keyboard, compact-layout and task handoff acceptance are recorded separately for the exact package.

The direct relay is the desktop transport implemented here. LiveKit/WebRTC, shared conversation storage, mobile/background behavior, automatic provider switching, video and other channels remain later increments. Google documents [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) and [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).
