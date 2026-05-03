import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@omaha/db';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
