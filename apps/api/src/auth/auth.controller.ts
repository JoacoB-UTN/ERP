import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type LoginResponse,
  type MeResponse,
} from '@erp/shared';
import type { Env } from '@erp/config';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Authenticated } from './decorators/authenticated.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './types';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import {
  buildCookieOptions,
  clearedCookieOptions,
  getCookie,
  getSessionMeta,
} from './cookie.util';
import { parseDurationMs } from '../common/utils/duration';
import type { AuthResult } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  private setAuthCookies(res: Response, result: AuthResult) {
    const accessTtlMs = parseDurationMs(
      this.configService.get('AUTH_ACCESS_TOKEN_TTL', { infer: true }),
    );
    const refreshTtlMs = result.refreshTokenExpiresAt.getTime() - Date.now();
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      result.accessToken,
      buildCookieOptions(this.configService, accessTtlMs),
    );
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      result.refreshToken,
      buildCookieOptions(this.configService, refreshTtlMs),
    );
  }

  private clearAuthCookies(res: Response) {
    const cleared = clearedCookieOptions(this.configService);
    res.clearCookie(ACCESS_TOKEN_COOKIE, cleared);
    res.clearCookie(REFRESH_TOKEN_COOKIE, cleared);
  }

  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(
      body.email,
      body.password,
      getSessionMeta(req),
    );
    this.setAuthCookies(res, result);
    return { user: result.user };
  }

  @UseGuards(ThrottlerGuard)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const rawToken = getCookie(req, REFRESH_TOKEN_COOKIE);
    if (!rawToken) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    const result = await this.authService.refresh(
      rawToken,
      getSessionMeta(req),
    );
    this.setAuthCookies(res, result);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.authService.logout(
      getCookie(req, REFRESH_TOKEN_COOKIE),
      getSessionMeta(req),
    );
    this.clearAuthCookies(res);
    return { ok: true };
  }

  @Authenticated()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.authService.logoutAll(user.sub, getSessionMeta(req));
    this.clearAuthCookies(res);
    return { ok: true };
  }

  @Authenticated()
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.authService.getMe(user.sub);
  }

  @Authenticated()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: { currentPassword: string; newPassword: string },
  ): Promise<{ ok: true }> {
    await this.authService.changePassword(
      user.sub,
      user.sid,
      body.currentPassword,
      body.newPassword,
      getSessionMeta(req),
    );
    return { ok: true };
  }

  @UseGuards(ThrottlerGuard)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: { email: string },
  ): Promise<{ message: string }> {
    await this.authService.forgotPassword(body.email);
    return {
      message:
        'If the account exists, password recovery instructions will be sent.',
    };
  }

  @UseGuards(ThrottlerGuard)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Req() req: Request,
    @Body(new ZodValidationPipe(resetPasswordSchema))
    body: {
      token: string;
      newPassword: string;
    },
  ): Promise<{ ok: true }> {
    await this.authService.resetPassword(
      body.token,
      body.newPassword,
      getSessionMeta(req),
    );
    return { ok: true };
  }
}
