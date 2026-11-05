'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { PwaBootstrap } from '@/components/pwa/pwa-bootstrap';
import { apiClient } from '@/lib/api';
import { applySessionUser } from '@/lib/hooks/auth';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const qc = new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: false } },
    });
    apiClient.configure({ onSession: (user) => applySessionUser(qc, user) });
    return qc;
  });
  return (
    <QueryClientProvider client={client}>
      <PwaBootstrap />
      {children}
    </QueryClientProvider>
  );
}
