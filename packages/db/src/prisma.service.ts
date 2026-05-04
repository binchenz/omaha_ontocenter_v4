import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export const INCLUDE_DELETED_SYMBOL = Symbol.for('omaha.includeDeleted');

type MaybeArgs = {
  where?: Record<string, unknown>;
  [key: symbol]: unknown;
} | undefined;

function injectDeletedAtFilter<T extends MaybeArgs>(args: T): T {
  if (!args) return { where: { deletedAt: null } } as unknown as T;
  if ((args as Record<symbol, unknown>)[INCLUDE_DELETED_SYMBOL]) {
    const { [INCLUDE_DELETED_SYMBOL]: _drop, ...rest } = args as Record<symbol, unknown> &
      Record<string, unknown>;
    return rest as unknown as T;
  }
  const where = (args.where ?? {}) as Record<string, unknown>;
  if ('deletedAt' in where) return args;
  return { ...(args as object), where: { ...where, deletedAt: null } } as unknown as T;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // Monkey-patch objectInstance read methods because Prisma 6 removed $use
    // and $extends returns an incompatible client type that would break every
    // consumer's injection of PrismaService. Escape hatch: pass INCLUDE_DELETED_SYMBOL.
    const original = this.objectInstance;
    const wrap = (method: 'findMany' | 'findFirst' | 'count' | 'aggregate') => {
      const fn = (original as unknown as Record<string, Function>)[method].bind(original);
      (original as unknown as Record<string, Function>)[method] = (args?: MaybeArgs) =>
        fn(injectDeletedAtFilter(args));
    };
    wrap('findMany');
    wrap('findFirst');
    wrap('count');
    wrap('aggregate');
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
