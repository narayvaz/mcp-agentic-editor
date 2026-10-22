/** Electron-independent microphone policy; handlers never grant camera or other permissions. */
export type VoicePermissionContents = { isDestroyed(): boolean; getURL(): string };
export type VoicePermissionDetails = {
  isMainFrame?: boolean; requestingUrl?: string; securityOrigin?: string; embeddingOrigin?: string;
  mediaType?: string; mediaTypes?: string[];
};
export type VoicePermissionOptions = {
  studioOrigin(): string;
  trustedContents(): VoicePermissionContents | undefined;
  isForeground(): boolean;
  microphoneAccessGranted(): boolean;
  requestMicrophoneAccess(): Promise<boolean>;
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
  return {
    check(contents: VoicePermissionContents | null, permission: string, requestingOrigin: string, details: VoicePermissionDetails): boolean {
      return details.mediaType === 'audio' && sameOrigin(requestingOrigin, options.studioOrigin()) && trusted(contents, permission, details) && microphoneGranted();
    },
    request(contents: VoicePermissionContents | null, permission: string, callback: (granted: boolean) => void, details: VoicePermissionDetails): void {
      // Empty/unknown and combined audio+video requests fail closed.
      const audioOnly = Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio';
      if (!audioOnly || !trusted(contents, permission, details)) { callback(false); return; }
      if (microphoneGranted()) { callback(true); return; }
      if (!pendingNativeRequest) pendingNativeRequest = Promise.resolve().then(() => options.requestMicrophoneAccess()).then(value => value === true, () => false).finally(() => { pendingNativeRequest = undefined; });
      // Recheck after native consent: focus, navigation or window lifetime may change.
      void pendingNativeRequest.then(granted => callback(granted && microphoneGranted() && trusted(contents, permission, details)));
    },
  };
}
