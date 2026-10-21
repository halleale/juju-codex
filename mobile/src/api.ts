export function normalizeURL(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS API base URL without credentials, query, or fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}

export async function request<T>(base: string, path: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(normalizeURL(base) + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'API request failed');
    return data as T;
  } finally { clearTimeout(timeout); }
}
