let installed = false;

export async function initializeDesktopSession(): Promise<void> {
  if (installed) return;
  if (!window.studioDesktop) throw new Error('Open Azat Studio from Applications. This workspace requires its authenticated desktop session.');
  const session = await window.studioDesktop.getSession();
  if (session.origin !== window.location.origin || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error('The desktop session does not match this workspace.');
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin !== session.origin || (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/devops/'))) return originalFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('Authorization', `Bearer ${session.token}`);
    return originalFetch(input, { ...init, headers, cache: 'no-store', redirect: 'error' });
  };
  installed = true;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : `${response.status} ${response.statusText}`;
    throw new Error(errorMessage);
  }
  return data as T;
}

export function buildJsonInit(method: "POST" | "PUT" | "DELETE", body: unknown): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
