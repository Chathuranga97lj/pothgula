import { apiErrorSchema } from '@pothgula/shared';
import type { z } from 'zod';

const TOKEN_KEY = 'pothgula.session';

/**
 * Where the session token lives in this browser. Storage can be unavailable
 * (private windows, blocked site data), so every access is guarded.
 */
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* the session then lasts only until the page is reloaded */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

/** An error answered by the API, with the stable code the screens translate. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let onSignedOut: (() => void) | null = null;

/** Called when the API says the session is gone (expired, ended elsewhere, deactivated). */
export function setSignedOutHandler(handler: (() => void) | null): void {
  onSignedOut = handler;
}

interface RequestOptions<S extends z.ZodType | undefined> {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Checks the response against the shared schema, so a mismatch fails loudly. */
  schema?: S;
}

export async function api<S extends z.ZodType | undefined = undefined>(
  path: string,
  options: RequestOptions<S> = {},
): Promise<S extends z.ZodType ? z.output<S> : unknown> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body === undefined
          ? undefined
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'The server cannot be reached.');
  }

  if (res.status === 204) return undefined as never;
  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    const error = parsed.success
      ? new ApiError(res.status, parsed.data.code, parsed.data.message, parsed.data.details)
      : new ApiError(res.status, 'http_error', res.statusText);
    if (res.status === 401 && error.code === 'not_signed_in') {
      tokenStore.clear();
      onSignedOut?.();
    }
    throw error;
  }

  return (options.schema ? options.schema.parse(data) : data) as never;
}

/**
 * Fetches a file the API makes (an export, a sheet to print) and hands it to the
 * browser to save. It needs the session token, so it cannot be a plain link.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(0, 'network_error', 'The server cannot be reached.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(res.status, body?.code ?? 'http_error', body?.message ?? res.statusText);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? fallbackName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
