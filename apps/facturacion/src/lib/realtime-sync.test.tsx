import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { REALTIME_SUBSCRIBE_COMPANY } from '@erp/shared';
import { createRealtimeClient } from '@erp/auth-client';

type Handler = (...args: unknown[]) => void;

/**
 * Minimal fake standing in for a socket.io-client `Socket` — just enough
 * surface for useRealtimeSync (on/off/connect/disconnect/emit with an ack
 * callback) to drive it deterministically from a test, without a real
 * network connection. See realtime.e2e-spec.ts (apps/api) for the real
 * transport/auth/isolation coverage — this file is only about the
 * frontend's event → TanStack Query invalidation wiring (section 19/20/21
 * of the realtime milestone).
 */
class FakeSocket {
  connected = false;
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler) {
    (this.listeners.get(event) ?? this.listeners.set(event, new Set()).get(event)!).add(handler);
    return this;
  }

  off(event: string, handler: Handler) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  connect() {
    this.connected = true;
    this.trigger('connect');
    return this;
  }

  disconnect() {
    this.connected = false;
    return this;
  }

  emit(event: string, payload?: unknown, cb?: (ack: unknown) => void) {
    if (event === REALTIME_SUBSCRIBE_COMPANY) {
      cb?.({ ok: true, companyId: (payload as { companyId: string }).companyId });
    }
    return this;
  }

  trigger(event: string, payload?: unknown) {
    for (const handler of this.listeners.get(event) ?? []) handler(payload);
  }
}

let fakeSocket: FakeSocket;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

describe('useRealtimeSync', () => {
  beforeEach(() => {
    fakeSocket = new FakeSocket();
  });

  async function setup(initialCompanyId: string | null) {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    let activeCompanyId = initialCompanyId;

    const client = createRealtimeClient({
      baseUrl: 'http://localhost:3001/api/v1',
      useActiveCompanyId: () => activeCompanyId,
    });

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { rerender } = renderHook(() => client.useRealtimeSync({ enabled: true }), { wrapper });
    await waitFor(() => expect(fakeSocket.connected).toBe(true));

    return {
      queryClient,
      invalidateSpy,
      setActiveCompanyId: (id: string) => {
        activeCompanyId = id;
        rerender();
      },
    };
  }

  it('invalidates the exact keys for the active company when a matching event arrives', async () => {
    const { invalidateSpy } = await setup('company-1');

    await act(async () => {
      fakeSocket.trigger('customer.updated', { companyId: 'company-1', customerId: 'cust-1' });
      // the invalidation batcher coalesces over a short window — see
      // createInvalidationBatcher in realtime-client.ts.
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['company', 'company-1', 'customers', 'list'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['company', 'company-1', 'customers', 'detail', 'cust-1'],
    });
  });

  it('never invalidates anything for an event belonging to a different company', async () => {
    const { invalidateSpy } = await setup('company-1');

    await act(async () => {
      // The server only ever emits into the room this socket subscribed
      // to (see realtime.gateway.ts) — this simulates the defensive
      // client-side check for a hypothetical stale/racy delivery.
      fakeSocket.trigger('customer.updated', { companyId: 'company-2', customerId: 'cust-9' });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('performs one broad current-company recovery invalidation on reconnect, not a replay', async () => {
    const { invalidateSpy } = await setup('company-1');
    invalidateSpy.mockClear();

    await act(async () => {
      // A second 'connect' from the same socket is what a real
      // reconnect looks like from the client's perspective.
      fakeSocket.trigger('connect');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['company', 'company-1'] });
  });

  it('resubscribes to the new company room when the active company changes, without touching the old company cache', async () => {
    const { invalidateSpy, setActiveCompanyId } = await setup('company-1');
    invalidateSpy.mockClear();

    setActiveCompanyId('company-2');

    // Switching company alone must not invalidate anything by itself —
    // it only changes which room future events are scoped to.
    expect(invalidateSpy).not.toHaveBeenCalled();

    await act(async () => {
      fakeSocket.trigger('customer.updated', { companyId: 'company-1', customerId: 'stale' });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    // The old company's event must be ignored now that company-2 is active.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
