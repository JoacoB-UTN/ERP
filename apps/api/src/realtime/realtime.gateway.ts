import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import {
  companyRealtimeRoom,
  REALTIME_SUBSCRIBE_COMPANY,
  type SubscribeCompanyAck,
  type SubscribeCompanyPayload,
} from '@erp/shared';
import { ACCESS_TOKEN_COOKIE } from '../auth/auth.constants';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../database/prisma.service';
import { CompanyContextService } from '../company-context/company-context.service';
import type { AuthenticatedUser } from '../auth/types';

/**
 * Per-socket state this gateway tracks on `socket.data` — deliberately
 * tiny. The socket is a notification channel only; it never substitutes
 * for RequestContext on the REST path (see docs/desktop-lan-architecture.md).
 */
interface RealtimeSocketData {
  user: AuthenticatedUser;
  companyId?: string;
}

/**
 * Realtime notification transport — see docs/desktop-lan-architecture.md
 * "Realtime architecture". Authenticates a socket using the exact same
 * session cookie/JWT the REST API trusts (see JwtAuthGuard), and only
 * ever joins a company room after independently re-validating that
 * company's membership through CompanyContextService — the same service
 * CompanyContextGuard uses for every REST request. A client can never
 * subscribe to another company's events by guessing its UUID.
 *
 * Authentication runs as Socket.IO connection MIDDLEWARE (`server.use`,
 * registered in `afterInit`), not inside `handleConnection`. This matters:
 * middleware — including its awaited work — always finishes before the
 * client's own `'connect'` event fires, so `socket.data.user` is
 * guaranteed set by the time any message handler (including
 * `onSubscribeCompany`) can possibly run. Authenticating inside
 * `handleConnection` instead would race a client that subscribes
 * immediately on connect, since Socket.IO does not wait for an async
 * `handleConnection` to finish before delivering messages on that same
 * socket. A rejected middleware surfaces to the client as `connect_error`,
 * never a bare disconnect.
 *
 * This gateway does not itself decide when to notify anyone — domain
 * services call RealtimePublisher after their own transaction commits;
 * see realtime.publisher.ts.
 */
@WebSocketGateway({
  // CORS is configured centrally by RealtimeIoAdapter (see realtime.adapter.ts),
  // reusing the exact same CORS_ORIGIN allow-list as the HTTP API — never a
  // wildcard here, since this is a credentialed (cookie-based) connection.
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
    private readonly companyContextService: CompanyContextService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          if (!user) {
            this.logger.warn({
              event: 'unauthorized_connection_attempt',
              socketId: socket.id,
            });
            next(new Error('Unauthorized'));
            return;
          }
          (socket.data as RealtimeSocketData).user = user;
          next();
        })
        .catch(() => next(new Error('Unauthorized')));
    });
  }

  handleConnection(client: Socket): void {
    const user = (client.data as RealtimeSocketData).user;
    this.logger.log({
      event: 'socket_connected',
      userId: user.sub,
      socketId: client.id,
    });
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as Partial<RealtimeSocketData>;
    this.logger.log({
      event: 'socket_disconnected',
      userId: data.user?.sub,
      socketId: client.id,
    });
  }

  /**
   * Client asks to (re)subscribe to one company's realtime room —
   * e.g. right after connecting once the active company is known, and
   * again whenever the user switches company in the UI. Membership is
   * re-validated server-side on every call; nothing here trusts the
   * client-supplied companyId without that check. Leaves any previously
   * joined company room first, so a socket is never subscribed to more
   * than one company's events at a time.
   */
  @SubscribeMessage(REALTIME_SUBSCRIBE_COMPANY)
  async onSubscribeCompany(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribeCompanyPayload,
  ): Promise<SubscribeCompanyAck> {
    const data = client.data as RealtimeSocketData;
    const user = data.user;
    if (!user) {
      return { ok: false, error: 'UNAUTHENTICATED' };
    }

    const companyId = payload?.companyId;
    if (!companyId || typeof companyId !== 'string') {
      return { ok: false, error: 'INVALID_COMPANY_ID' };
    }

    try {
      await this.companyContextService.validateCompanyAccess(
        user.sub,
        companyId,
      );
    } catch {
      this.logger.warn({
        event: 'unauthorized_subscription_attempt',
        userId: user.sub,
        socketId: client.id,
        companyId,
      });
      return { ok: false, error: 'COMPANY_ACCESS_DENIED' };
    }

    if (data.companyId && data.companyId !== companyId) {
      await client.leave(companyRealtimeRoom(data.companyId));
    }
    await client.join(companyRealtimeRoom(companyId));
    data.companyId = companyId;

    this.logger.log({
      event: 'company_subscribed',
      userId: user.sub,
      socketId: client.id,
      companyId,
    });
    return { ok: true, companyId };
  }

  /**
   * Mirrors JwtAuthGuard exactly (same cookie, same JWT verification, same
   * revoked-session check) — a socket is authenticated the same way an
   * HTTP request is, never by a second, weaker mechanism. Socket.IO's
   * handshake is a plain HTTP request under the hood, so the session
   * cookie the browser already holds is sent automatically as long as the
   * client connects with `withCredentials: true`.
   */
  private async authenticate(
    client: Socket,
  ): Promise<AuthenticatedUser | null> {
    const cookieHeader = client.handshake.headers.cookie;
    if (!cookieHeader) return null;

    const cookies = parseCookie(cookieHeader);
    const token = cookies[ACCESS_TOKEN_COOKIE];
    if (!token) return null;

    let user: AuthenticatedUser;
    try {
      user = this.tokenService.verifyAccessToken(token);
    } catch {
      return null;
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: user.sid },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() < Date.now()
    ) {
      return null;
    }

    return user;
  }
}
