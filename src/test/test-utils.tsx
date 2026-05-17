import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Wrap component tests that consume React Query hooks. A fresh client per
 * call keeps tests isolated; retries are disabled so failed fetches don't
 * stall the suite.
 */
export function withQueryClient(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
