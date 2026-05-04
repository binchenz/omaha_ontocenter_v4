import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { analyze, parse } from '@omaha/dsl';
import type { OntologyView, Predicate } from '@omaha/dsl';
import type { CurrentUser, RolePermission } from '@omaha/shared-types';
import { OntologyViewLoader } from '../ontology/ontology-view-loader.service';

const TEMPLATE_WHITELIST = new Set(['userId', 'userRoleId', 'userTenantId', 'now']);

export interface PermissionResolution {
  allowed: boolean;
  allowedFields: Set<string> | null;
  predicates: Predicate[];
}

@Injectable()
export class PermissionResolver {
  constructor(private readonly viewLoader: OntologyViewLoader) {}

  async resolveOrThrow(
    actor: CurrentUser,
    resource: string,
    action: string,
    objectType: string,
  ): Promise<PermissionResolution> {
    const resolution = await this.resolve(actor, resource, action, objectType);
    if (!resolution.allowed) {
      throw new ForbiddenException(`No permission for ${resource}.${action}`);
    }
    return resolution;
  }

  async resolve(
    actor: CurrentUser,
    resource: string,
    action: string,
    objectType: string,
  ): Promise<PermissionResolution> {
    const rules = actor.permissionRules ?? [];
    const matching = rules.filter((r) => ruleMatches(r, resource, action));
    const allowed = matching.length > 0;
    if (!allowed) {
      return { allowed: false, allowedFields: null, predicates: [] };
    }

    const allowedFields = collectAllowedFields(matching);

    const conditionRules = matching.filter((r) => r.condition && r.condition.trim());
    if (conditionRules.length === 0) {
      return { allowed: true, allowedFields, predicates: [] };
    }

    const view = await this.viewLoader.load(actor.tenantId, objectType);
    if (!view) {
      return { allowed: true, allowedFields, predicates: [] };
    }

    const templateBindings: Record<string, unknown> = {
      userId: actor.id,
      userRoleId: actor.roleId,
      userTenantId: actor.tenantId,
      now: new Date().toISOString(),
    };

    const predicates: Predicate[] = [];
    for (const rule of conditionRules) {
      predicates.push(this.compileRuleToPredicate(rule.condition!, view, templateBindings));
    }
    return { allowed: true, allowedFields, predicates };
  }

  private compileRuleToPredicate(
    source: string,
    view: OntologyView,
    templateBindings: Record<string, unknown>,
  ): Predicate {
    const analysis = analyze(source, {
      knownProperties: new Set([...view.numericFields, ...view.booleanFields, ...view.stringFields]),
      knownDerivedProperties: new Set(view.derivedProperties.keys()),
      knownRelations: new Set(Object.keys(view.relations)),
    });
    if (!analysis.valid) {
      throw new BadRequestException(
        `Permission condition invalid: ${analysis.errors.join('; ')}`,
      );
    }
    for (const paramName of analysis.parameters) {
      if (!TEMPLATE_WHITELIST.has(paramName)) {
        throw new BadRequestException(
          `Permission condition uses unbound template :${paramName} (allowed: ${[...TEMPLATE_WHITELIST].join(', ')})`,
        );
      }
    }
    return {
      ast: parse(source),
      view,
      params: templateBindings,
      scope: 'parent',
    };
  }
}

function ruleMatches(rule: RolePermission, resource: string, action: string): boolean {
  if (rule.permission === '*') return true;
  const base = rule.permission.split(':')[0];
  const [res, act] = base.split('.');
  if (res !== resource) return false;
  return act === '*' || act === action;
}

function collectAllowedFields(rules: RolePermission[]): Set<string> | null {
  const fields = new Set<string>();
  for (const r of rules) {
    if (r.permission === '*') return null;
    const colonIdx = r.permission.indexOf(':');
    if (colonIdx === -1) return null;
    for (const f of r.permission.substring(colonIdx + 1).split(',')) {
      fields.add(f.trim());
    }
  }
  return fields.size > 0 ? fields : null;
}
