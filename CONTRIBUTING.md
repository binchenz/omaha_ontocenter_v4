# 贡献指南 / Contributing

感谢你考虑为 OmahA OntoCenter 做贡献。本文档说明本地开发、测试与提交 PR 的约定。
*Thanks for considering a contribution to OmahA OntoCenter. This document covers local development, testing, and PR conventions.*

---

## 开发环境 / Development setup

```bash
git clone https://github.com/binchenz/omaha_ontocenter_v4.git
cd omaha_ontocenter_v4
cp .env.example .env
docker-compose up -d
pnpm setup        # install + generate + migrate（空库，由 Setup 向导初始化）
pnpm dev
```

详见 [docs/guide/getting-started.md](docs/guide/getting-started.md)。
*See [Getting Started](docs/guide/getting-started.en.md) for the full walkthrough.*

技术栈 / Stack: NestJS · Prisma · PostgreSQL · Next.js · pnpm workspaces + Turborepo。

---

## 提交前必须通过 / Required before opening a PR

CI 会在 PR 上运行同样的检查。本地先跑一遍能省去往返。
*CI runs the same checks on every PR. Run them locally first.*

```bash
pnpm build                              # 全工作区编译 / build all packages
pnpm test                               # 单元测试（全 mock，无需数据库）/ unit tests (mocked, no DB)
pnpm --filter @omaha/web exec tsc --noEmit   # 前端类型检查 / web typecheck
```

- 单元测试（`*.spec.ts`）必须全绿。
  *All unit tests must pass.*
- 不要破坏 `pnpm build`。lint 警告不阻断合并，但类型错误会。
  *Don't break the build. Lint warnings don't block merges; type errors do.*
- e2e 测试（`apps/core-api/test/`）依赖种子数据 + LLM key，不在 CI 跑；改动读写路径时请本地手动验证。
  *e2e tests need seed data + an LLM key and don't run in CI; verify them locally when touching read/write paths.*

---

## 测试约定 / Testing conventions

本项目实践 TDD（红 → 绿 → 重构），按垂直切片推进而非"先写完所有测试"。
*We practice TDD (red → green → refactor) in vertical slices, not "write all tests first."*

好的测试通过**公开接口**验证**行为**，能在内部重构后存活；不要测私有方法或断言实现细节。
*Good tests verify behavior through public interfaces and survive refactors — don't test private methods or assert on implementation details.*

参考既有测试风格：`auth.service.spec.ts`、`setup.service.spec.ts`（mock PrismaService + `Test.createTestingModule`）。
*Mirror existing specs like `auth.service.spec.ts` and `setup.service.spec.ts`.*

---

## 架构与领域语言 / Architecture & domain language

动手前请先读：
*Before writing code, read:*

- [CONTEXT.md](CONTEXT.md) — 领域词汇表。命名、PR、issue 都用这套词汇。
  *Domain glossary. Use this vocabulary in names, PRs, and issues.*
- [ARCHITECTURE.md](ARCHITECTURE.md) — 代码在哪里、三条主线、不变量。
  *Where the code lives, the three main flows, the invariants.*
- [docs/adr/](docs/adr/) — 重要决策及其理由。改动相关区域前先看对应 ADR。
  *Architecture decisions and their rationale. Check the relevant ADR before changing an area it covers.*

关键不变量（细节见 ADR）：读路径必经 `scoped-where.ts`（租户隔离）；对象实例写操作必经 `ImportEngine.importInstances`（单一 TCB）。
*Key invariants: all reads go through `scoped-where.ts`; all object-instance writes go through `ImportEngine.importInstances`.*

---

## 提交与 PR / Commits & pull requests

- 分支从最新 `main` 切出，PR 目标也是 `main`。
  *Branch from the latest `main`; target `main`.*
- Commit 用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat(scope): ...`、`fix(scope): ...`、`docs:`、`test:`、`refactor:`。
- PR 描述说明：改了什么、怎么验证的、有无破坏性变更。关联 issue 用 `Closes #123`。
  *PR description: what changed, how you verified it, any breaking changes. Link issues with `Closes #123`.*
- 新建 issue 请加 `needs-triage` 标签，进入正常 triage 流程。
  *Label new issues `needs-triage`.*

---

## 许可证 / License

贡献的代码以 [MIT](LICENSE) 许可证发布。
*Contributions are released under the [MIT](LICENSE) license.*
