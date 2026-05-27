export interface LinkedInClient {
  fetchJson(path: string, init?: RequestInit): Promise<unknown>;
}

export function makeClient(accessToken: string): LinkedInClient {
  const base = 'https://api.linkedin.com/v2';
  return {
    async fetchJson(path, init) {
      const r = await fetch(base + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          ...(init?.headers ?? {}),
        },
      });
      if (!r.ok) {
        const err = new Error(`linkedin ${r.status}: ${await r.text()}`);
        (err as Error & { status?: number }).status = r.status;
        throw err;
      }
      return r.json();
    },
  };
}
