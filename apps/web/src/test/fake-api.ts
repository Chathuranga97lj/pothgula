import { vi } from 'vitest';

type Reply = { status?: number; body?: unknown };
type Route = Reply | ((body: unknown) => Reply);

export interface Call {
  route: string;
  body: unknown;
  authorization: string | null;
}

/**
 * Replaces fetch with a table of answers keyed by "METHOD /path" (without /api).
 * Unknown routes answer 404, so a screen calling something unexpected shows up.
 */
export function fakeApi(routes: Record<string, Route>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const route = `${init?.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ route, body, authorization: headers.authorization ?? null });

      const handler = routes[route];
      if (!handler) return Response.json({ code: 'not_found', message: route }, { status: 404 });
      const reply = typeof handler === 'function' ? handler(body) : handler;
      if (reply.status === 204) return new Response(null, { status: 204 });
      return Response.json(reply.body ?? {}, { status: reply.status ?? 200 });
    }),
  );
  return { calls };
}

export const user = (over: Record<string, unknown> = {}) => ({
  id: 7,
  fullName: 'නිමල් පෙරේරා',
  userType: 'admin',
  status: 'active',
  branchId: 1,
  whatsappPhone: '0771234567',
  mustChangePassword: false,
  ...over,
});
