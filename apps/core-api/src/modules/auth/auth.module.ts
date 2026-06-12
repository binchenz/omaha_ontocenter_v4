import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '@omaha/db';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { JWT_EXPIRES_IN, JWT_STRATEGY } from './auth.constants';
import { resolveJwtSecret } from './jwt-secret.resolver';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: JWT_STRATEGY }),
    JwtModule.registerAsync({
      useFactory: async (prisma: PrismaService) => ({
        secret: await resolveJwtSecret(prisma),
        signOptions: { expiresIn: JWT_EXPIRES_IN },
      }),
      inject: [PrismaService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
