import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
// Usage: @Public() above login/register — the only endpoints that should
// work without a JWT. Everything else in the API requires a valid token
// once JwtAuthGuard is registered globally (see app.module.ts).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
