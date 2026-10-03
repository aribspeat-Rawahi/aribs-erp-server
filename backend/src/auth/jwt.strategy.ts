import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_SECRET environment variable is missing or empty. Set a strong, random JWT_SECRET in your .env before starting the app.',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Whatever this returns becomes `req.user` in controllers.
  // Re-checks the account on every request (see AuthService.findActiveForToken):
  // deleted/deactivated users are rejected immediately, and the CURRENT
  // role and module permissions are used.
  async validate(payload: { sub: string; role: string; email: string }) {
    const user = await this.authService.findActiveForToken(payload.sub);
    if (!user) throw new UnauthorizedException('Your account is no longer active. Please contact an administrator.');
    return {
      userId: user.id,
      role: user.role,
      email: user.email,
      modulePermissions: user.modulePermissions || null,
    };
  }
}
