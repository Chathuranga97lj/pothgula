import { meResponseSchema, type MeResponse, signInResponseSchema } from '@pothgula/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, setSignedOutHandler, tokenStore } from '../api/client';

interface AuthState {
  /** The signed-in person, or null. Undefined while it is still being checked. */
  me: MeResponse | null | undefined;
  signIn(whatsappPhone: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Re-reads who is signed in, e.g. after a password change. */
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const ME_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStore.get());

  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api('/auth/me', { schema: meResponseSchema }),
    enabled: token !== null,
    staleTime: 60_000,
  });

  const forget = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    queryClient.clear();
  }, [queryClient]);

  // The API answers not_signed_in when a session expires or is ended elsewhere.
  useEffect(() => {
    setSignedOutHandler(forget);
    return () => setSignedOutHandler(null);
  }, [forget]);

  const signIn = useCallback(
    async (whatsappPhone: string, password: string) => {
      const result = await api('/auth/sign-in', {
        method: 'POST',
        body: { whatsappPhone, password },
        schema: signInResponseSchema,
      });
      tokenStore.set(result.token);
      queryClient.setQueryData<MeResponse>(ME_KEY, { user: result.user, warnings: [] });
      setToken(result.token);
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/sign-out', { method: 'POST' });
    } catch {
      /* signed out on this device regardless */
    }
    forget();
  }, [forget]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
  }, [queryClient]);

  const me = token === null ? null : meQuery.isError ? null : meQuery.data;

  return (
    <AuthContext.Provider value={{ me, signIn, signOut, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in user; only for screens behind RequireAuth. */
export function useMe(): MeResponse {
  const { me } = useAuth();
  if (!me) throw new Error('useMe outside RequireAuth');
  return me;
}
