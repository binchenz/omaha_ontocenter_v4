import { Module } from '@nestjs/common';
import { PrismaService } from '@omaha/db';

@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => {
        const prisma = new PrismaService();
        return prisma;
      },
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
