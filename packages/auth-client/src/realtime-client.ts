'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_EVENTS,
  REALTIME_SUBSCRIBE_COMPANY,
  type RealtimeEventName,
  type RealtimeEventPayloads,
  type SubscribeCompanyAck,
} from '@erp/shared';

export interface RealtimeClientConfig {
  /** Same API base URL the REST client uses (e.g. "http://localhost:3001/api/v1") — the Socket.IO endpoint is derived from its origin, never a second hardcoded URL. See docs/desktop-lan-architecture.md's "Socket URL" note: runtime server configuration is future (Electron) work, not this milestone. */
  baseUrl: string;
  useActiveCompanyId: () => string | null;
}

/**
 * Maps one realtime event to the exact existing TanStack Query key
 * prefixes it should invalidate — reusing the SAME prefixes each domain's
 * own mutation hooks already invalidate on local success (see
 * sales-hooks.ts/inventory-hooks.ts/customers-hooks.ts/products-hooks.ts/
 * pricing-hooks.ts/dashboard-hooks.ts), never invented keys. Every key is
 * scoped by the event's own `companyId` — see the isolation check in
 * `useRealtimeSync` below, which never invalidates for any other company.
 */
export function invalidationKeysFor<E extends RealtimeEventName>(
  event: E,
  payload: RealtimeEventPayloads[E],
): QueryKey[] {
  const companyId = payload.companyId;
  switch (event) {
    case 'sale.confirmed':
    case 'sale.cancelled':
      return [
        ['company', companyId, 'sales'],
        ['company', companyId, 'dashboard', 'summary'],
      ];
    case 'stock.changed':
      // Mirrors sales-hooks.ts's own onSuccess invalidation — one broad
      // prefix covers stock list, movements, product/variant-stock, and
      // adjustments in one shot.
      return [['company', companyId, 'inventory']];
    case 'customer.updated': {
      const { customerId } = payload as RealtimeEventPayloads['customer.updated'];
      return [
        ['company', companyId, 'customers', 'list'],
        ['company', companyId, 'customers', 'lookup'],
        ['company', companyId, 'customers', 'detail', customerId],
      ];
    }
    case 'product.updated': {
      const { productId } = payload as RealtimeEventPayloads['product.updated'];
      return [
        ['company', companyId, 'products', 'list'],
        ['company', companyId, 'products', 'lookup'],
        ['company', companyId, 'products', 'detail', productId],
        // Facturación/POS price product search reads through inventory
        // lookup (availability) alongside identity — see facturacion.md.
        ['company', companyId, 'inventory', 'lookup'],
      ];
    }
    case 'price.changed':
      // Broad on purpose — pricing-hooks.ts's own local mutations do the
      // same. Covers lists, lookup/batch (Facturación/POS cart pricing),
      // and per-product/variant history in one shot.
      return [['company', companyId, 'pricing']];
    default:
      return [];
  }
}

/**
 * Tiny invalidation batcher — see docs/desktop-lan-architecture.md's
 * "Event burst / duplicate refetch control". One sale can produce a
 * `sale.confirmed` plus many `stock.changed` events; without this, a
 * 20-line sale could schedule 20 near-simultaneous invalidations of the
 * same broad key. Coalescing over one microtask-scale window collapses
 * them into a single `invalidateQueries` call per unique key — no
 * scheduler framework, just a Map + one timer.
 */
function createInvalidationBatcher(queryClient: QueryClient) {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    timer = null;
    const keys = [...pending.values()];
    pending.clear();
    for (const key of keys) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }

  return {
    schedule(key: QueryKey) {
      pending.set(JSON.stringify(key), key);
      timer ??= setTimeout(flush, 50);
    },
    /** Used on reconnect recovery — bypasses the debounce window since this is already a single, deliberate call. */
    flushNow(key: QueryKey) {
      void queryClient.invalidateQueries({ queryKey: key });
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}

/**
 * Builds the realtime (Socket.IO) client for one app — see
 * docs/desktop-lan-architecture.md "Realtime architecture". Call once per
 * app (same convention as createAuthClient) and use the returned
 * `useRealtimeSync` hook once, from the top-level authenticated layout —
 * never per-component, never per-render. Deliberately a plain hook, not a
 * React context provider, matching every other client in this package.
 */
export function createRealtimeClient(config: RealtimeClientConfig) {
  let socket: Socket | null = null;

  function getSocket(): Socket {
    if (!socket) {
      const origin = new URL(config.baseUrl).origin;
      socket = io(origin, {
        withCredentials: true,
        autoConnect: false,
      });
    }
    return socket;
  }

  /**
   * Connects (once enabled — i.e. authenticated) and keeps the active
   * company's room subscription in sync. Safe to call from exactly one
   * place in the component tree; internally guarded against creating more
   * than one socket (module-level singleton above) even across
   * remounts/React Strict Mode double-invocation.
   */
  function useRealtimeSync(options: { enabled: boolean }): void {
    const queryClient = useQueryClient();
    const companyId = config.useActiveCompanyId();
    const companyIdRef = useRef(companyId);
    companyIdRef.current = companyId;

    // Connection + event listeners — mount/unmount only.
    useEffect(() => {
      if (!options.enabled) return;
      const s = getSocket();
      const batcher = createInvalidationBatcher(queryClient);
      let hasConnectedBefore = false;

      function subscribeToCurrentCompany() {
        const id = companyIdRef.current;
        if (!id) return;
        s.emit(
          REALTIME_SUBSCRIBE_COMPANY,
          { companyId: id },
          (_ack: SubscribeCompanyAck) => {
            // Best-effort — a failed subscription (e.g. access revoked
            // mid-session) just means no realtime updates for this
            // company; REST remains the source of truth regardless.
          },
        );
      }

      function handleConnect() {
        if (hasConnectedBefore) {
          // Reconnect recovery: we may have missed events while
          // disconnected (no durable event log — see the architecture
          // doc). One safe broad invalidation of the current company's
          // mounted queries recovers visible state; REST is what's
          // actually re-fetched.
          const id = companyIdRef.current;
          if (id) batcher.flushNow(['company', id]);
        }
        hasConnectedBefore = true;
        subscribeToCurrentCompany();
      }

      function makeHandler(event: RealtimeEventName) {
        return (payload: RealtimeEventPayloads[typeof event]) => {
          // Never act on another company's event, even though the server
          // only emits to the room this socket is subscribed to — this
          // is a defensive second check, not the primary isolation
          // mechanism (see realtime.gateway.ts for that).
          if (payload.companyId !== companyIdRef.current) return;
          for (const key of invalidationKeysFor(event, payload)) {
            batcher.schedule(key);
          }
        };
      }

      const handlers = REALTIME_EVENTS.map(
        (event) => [event, makeHandler(event)] as const,
      );
      for (const [event, handler] of handlers) {
        s.on(event, handler as (...args: unknown[]) => void);
      }
      s.on('connect', handleConnect);

      if (!s.connected) s.connect();
      else handleConnect();

      return () => {
        for (const [event, handler] of handlers) {
          s.off(event, handler as (...args: unknown[]) => void);
        }
        s.off('connect', handleConnect);
        batcher.dispose();
      };
    }, [options.enabled, queryClient]);

    // Resubscribe whenever the active company changes — Socket.IO buffers
    // the emit until connected, so this is safe to call unconditionally.
    useEffect(() => {
      if (!options.enabled || !companyId || !socket) return;
      socket.emit(
        REALTIME_SUBSCRIBE_COMPANY,
        { companyId },
        (_ack: SubscribeCompanyAck) => {},
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options.enabled, companyId]);

    // Disconnect on logout (enabled -> false) so a signed-out session
    // never keeps listening — see docs/desktop-lan-architecture.md's
    // client connection lifecycle.
    useEffect(() => {
      if (options.enabled) return;
      socket?.disconnect();
    }, [options.enabled]);
  }

  return { useRealtimeSync };
}
