import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Prisma } from '@omaha/db';
import {
  deIdentifyToTemplate,
  instantiateTemplate,
  type OntologyTemplate,
  type TemplateEvalQuestion,
} from '@omaha/shared-types';
import { DraftService } from './draft.service';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  typeCount: number;
  questionCount: number;
  createdAt: Date;
}

/**
 * Per-OPC private template library (ADR-0034). Save a tuned, Evals-validated ontology as a
 * de-identified template (the pure deIdentifyToTemplate), store it in tenant-independent
 * storage, and apply it by instantiating the snapshot into a Draft — reusing the same
 * Draft-instantiation path as reverse-inference. The applied Draft is then refined and
 * published through the normal flow.
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly draftService: DraftService,
  ) {}

  /**
   * Save the tenant's CURRENT ontology as a private template. Snapshot source is the Draft
   * if one exists (the OPC's in-progress tuned model), else the live published ontology. The
   * tenant's Evals question bank is bundled and the whole thing is de-identified.
   */
  async saveAsTemplate(tenantId: string, input: { name: string; description?: string }): Promise<TemplateSummary> {
    const draft = await this.draftService.getDraft(tenantId);
    const snapshot = draft ? draft.snapshot : await this.draftService.snapshotPublished(tenantId);

    const questions = await this.prisma.evalQuestion.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    const questionBank: TemplateEvalQuestion[] = questions.map((q) => ({
      question: q.question,
      baselineTool: q.baselineTool,
      baselineArgs: (q.baselineArgs ?? {}) as Record<string, unknown>,
      planSummary: q.planSummary ?? undefined,
    }));

    const template = deIdentifyToTemplate({ name: input.name, description: input.description, snapshot, questionBank });

    const row = await this.prisma.ontologyTemplate.create({
      data: {
        name: template.name,
        description: template.description ?? null,
        snapshot: template.snapshot as unknown as Prisma.InputJsonValue,
        questionBank: template.questionBank as unknown as Prisma.InputJsonValue,
        ownerTenantId: tenantId,
      },
    });
    return this.toSummary(row);
  }

  async list(): Promise<TemplateSummary[]> {
    const rows = await this.prisma.ontologyTemplate.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toSummary(r));
  }

  async remove(id: string): Promise<void> {
    const row = await this.prisma.ontologyTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('模板不存在');
    await this.prisma.ontologyTemplate.delete({ where: { id } });
  }

  /**
   * Apply a template to the tenant: instantiate its snapshot into a Draft (same path as
   * reverse-inference) and seed the tenant's Evals question bank with the template's
   * questions (skipping ones already present by text). The OPC then refines and publishes.
   */
  async apply(tenantId: string, templateId: string): Promise<{ types: number; questionsAdded: number }> {
    const row = await this.prisma.ontologyTemplate.findUnique({ where: { id: templateId } });
    if (!row) throw new NotFoundException('模板不存在');
    const template: OntologyTemplate = {
      name: row.name,
      description: row.description ?? undefined,
      snapshot: row.snapshot as never,
      questionBank: (Array.isArray(row.questionBank) ? row.questionBank : []) as unknown as TemplateEvalQuestion[],
    };

    const draftSnapshot = instantiateTemplate(template);
    const saved = await this.draftService.upsertSnapshot(tenantId, draftSnapshot);

    const existing = new Set(
      (await this.prisma.evalQuestion.findMany({ where: { tenantId }, select: { question: true } })).map((q) => q.question),
    );
    const toAdd = template.questionBank.filter((q) => !existing.has(q.question));
    if (toAdd.length > 0) {
      await this.prisma.evalQuestion.createMany({
        data: toAdd.map((q) => ({
          tenantId,
          question: q.question,
          baselineTool: q.baselineTool,
          baselineArgs: (q.baselineArgs ?? {}) as Prisma.InputJsonValue,
          planSummary: q.planSummary ?? null,
        })),
      });
    }

    return { types: saved.snapshot.objectTypes.length, questionsAdded: toAdd.length };
  }

  private toSummary(row: {
    id: string;
    name: string;
    description: string | null;
    snapshot: unknown;
    questionBank: unknown;
    createdAt: Date;
  }): TemplateSummary {
    const snap = row.snapshot as { objectTypes?: unknown[] } | null;
    const qb = Array.isArray(row.questionBank) ? row.questionBank : [];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      typeCount: Array.isArray(snap?.objectTypes) ? snap!.objectTypes!.length : 0,
      questionCount: qb.length,
      createdAt: row.createdAt,
    };
  }
}
