'use client';

import type { Me } from '@gcd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/hooks/auth';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const qc = new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: false } },
    });
    // refresh·dev-login으로 받은 user를 /me 캐시에 바로 넣는다
    apiClient.configure({ onSession: (user) => qc.setQueryData<Me>(queryKeys.me, user) });
    return qc;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
