/** Electron-independent microphone policy; handlers never grant camera or other permissions. */
export type VoicePermissionContents = { isDestroyed(): boolean; getURL(): string };
export type VoicePermissionDetails = {
  isMainFrame?: boolean; requestingUrl?: string; securityOrigin?: string; embeddingOrigin?: string;
  mediaType?: string; mediaTypes?: string[];
};
export type VoicePermissionDiagnostic = {
  phase: 'check' | 'request' | 'native-request' | 'native-result';
  decision: 'allow' | 'deny' | 'pending';
  reason: 'policy-denied' | 'native-grant-missing' | 'native-consent-required' | 'native-consent-returned' | 'allowed';
  mediaPermission: boolean; audioOnly: boolean; trustedContents: boolean; destroyedContents: boolean;
  foreground: boolean; mainFrame: boolean; contentsUrlMatches: boolean; requestingOriginPresent: boolean; requestingOriginMatches: boolean; requestingUrlPresent: boolean; requestingUrlMatches: boolean;
  securityOriginPresent: boolean; securityOriginMatches: boolean; embeddingOriginPresent: boolean; embeddingOriginMatches: boolean;
  nativeStatus: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
};
export type VoicePermissionOptions = {
  studioOrigin(): string;
  trustedContents(): VoicePermissionContents | undefined;
  isForeground(): boolean;
  microphoneAccessGranted(): boolean;
  requestMicrophoneAccess(): Promise<boolean>;
  /** Operator acceptance profiles only; never receives URLs, identifiers, tokens or transcripts. */
  diagnostic?(event: VoicePermissionDiagnostic): void;
  microphoneAccessStatus?(): string;
};

function sameOrigin(value: unknown, expected: string): boolean {
  if (typeof value !== 'string' || !expected) return false;
  try { return new URL(value).origin === expected; } catch { return false; }
}

/**
 * Register check/request on the Studio window's session before loadURL. The UI must
 * request getUserMedia({audio: true, video: false}) only from its Start voice gesture,
 * and end the stream when hidden or ended. Electron's permission details do not
 * expose a user-gesture flag, so these handlers do not claim to establish one.
 *
 * On macOS, provide getMediaAccessStatus('microphone') === 'granted' and
 * askForMediaAccess('microphone'); never ask on app startup or for camera access.
 * Other platforms may use the Chromium permission grant after the same policy.
 */
export function createVoicePermissionHandlers(options: VoicePermissionOptions) {
  let pendingNativeRequest: Promise<boolean> | undefined;
  function trusted(contents: VoicePermissionContents | null, permission: string, details: VoicePermissionDetails): boolean {
    try {
      const origin = options.studioOrigin();
      if (!contents || contents !== options.trustedContents() || contents.isDestroyed() || !options.isForeground() || permission !== 'media' || details.isMainFrame !== true) return false;
      if (!sameOrigin(contents.getURL(), origin) || !sameOrigin(details.requestingUrl, origin)) return false;
      if (details.securityOrigin !== undefined && !sameOrigin(details.securityOrigin, origin)) return false;
      if (details.embeddingOrigin !== undefined && !sameOrigin(details.embeddingOrigin, origin)) return false;
      return true;
    } catch { return false; }
  }
  function microphoneGranted(): boolean {
    try { return options.microphoneAccessGranted() === true; } catch { return false; }
  }
  function trace(phase: VoicePermissionDiagnostic['phase'], decision: VoicePermissionDiagnostic['decision'], reason: VoicePermissionDiagnostic['reason'], contents: VoicePermissionContents | null, permission: string, details: VoicePermissionDetails, requestingOrigin?: string): void {
    if (!options.diagnostic) return;
    // Diagnostics are observational only: failures cannot affect a permission decision.
    try {
      const origin = options.studioOrigin(), status = options.microphoneAccessStatus?.();
      const nativeStatus = status === 'not-determined' || status === 'granted' || status === 'denied' || status === 'restricted' ? status : 'unknown';
      options.diagnostic({
        phase, decision, reason, mediaPermission: permission === 'media',
        audioOnly: phase === 'check' ? details.mediaType === 'audio' : Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio',
        trustedContents: !!contents && contents === options.trustedContents(), destroyedContents: !contents || contents.isDestroyed(),
        foreground: options.isForeground(), mainFrame: details.isMainFrame === true,
        contentsUrlMatches: !!contents && sameOrigin(contents.getURL(), origin),
        requestingOriginPresent: typeof requestingOrigin === 'string', requestingOriginMatches: sameOrigin(requestingOrigin, origin),
        requestingUrlPresent: typeof details.requestingUrl === 'string', requestingUrlMatches: sameOrigin(details.requestingUrl, origin),
        securityOriginPresent: details.securityOrigin !== undefined, securityOriginMatches: sameOrigin(details.securityOrigin, origin),
        embeddingOriginPresent: details.embeddingOrigin !== undefined, embeddingOriginMatches: sameOrigin(details.embeddingOrigin, origin), nativeStatus,
      });
    } catch { /* Private acceptance diagnostics must never change permission handling. */ }
  }
  return {
    check(contents: VoicePermissionContents | null, permission: string, requestingOrigin: string, details: VoicePermissionDetails): boolean {
      const policyAllowed = details.mediaType === 'audio' && sameOrigin(requestingOrigin, options.studioOrigin()) && trusted(contents, permission, details);
      const granted = policyAllowed && microphoneGranted();
      trace('check', granted ? 'allow' : 'deny', granted ? 'allowed' : policyAllowed ? 'native-grant-missing' : 'policy-denied', contents, permission, details, requestingOrigin);
      return granted;
    },
    request(contents: VoicePermissionContents | null, permission: string, callback: (granted: boolean) => void, details: VoicePermissionDetails): void {
      // Empty/unknown and combined audio+video requests fail closed.
      const audioOnly = Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio';
      if (!audioOnly || !trusted(contents, permission, details)) { trace('request', 'deny', 'policy-denied', contents, permission, details); callback(false); return; }
      if (microphoneGranted()) { trace('request', 'allow', 'allowed', contents, permission, details); callback(true); return; }
      trace('request', 'pending', 'native-consent-required', contents, permission, details);
      if (!pendingNativeRequest) pendingNativeRequest = Promise.resolve().then(() => {
        trace('native-request', 'pending', 'native-consent-required', contents, permission, details);
        return options.requestMicrophoneAccess();
      }).then(value => value === true, () => false).finally(() => { pendingNativeRequest = undefined; });
      // Recheck after native consent: focus, navigation or window lifetime may change.
      void pendingNativeRequest.then(granted => {
        const allowed = granted && microphoneGranted() && trusted(contents, permission, details);
        trace('native-result', allowed ? 'allow' : 'deny', 'native-consent-returned', contents, permission, details);
        callback(allowed);
      });
    },
  };
}
