import { Injectable } from '@nestjs/common';
import { OntologyService } from '../../ontology/ontology.service';

@Injectable()
export class TypeResolver {
  private cache = new Map<string, Map<string, string>>();

  constructor(private readonly ontologyService: OntologyService) {}

  async resolve(tenantId: string, typeName: string): Promise<string> {
    const map = await this.getOrLoad(tenantId);
    const id = map.get(typeName);
    if (!id) throw new Error(`对象类型 "${typeName}" 不存在`);
    return id;
  }

  async resolveMany(tenantId: string, typeNames: string[]): Promise<Map<string, string>> {
    const map = await this.getOrLoad(tenantId);
    const result = new Map<string, string>();
    for (const name of typeNames) {
      const id = map.get(name);
      if (!id) throw new Error(`对象类型 "${name}" 不存在`);
      result.set(name, id);
    }
    return result;
  }

  invalidate(tenantId?: string): void {
    if (tenantId) {
      this.cache.delete(tenantId);
    } else {
      this.cache.clear();
    }
  }

  private async getOrLoad(tenantId: string): Promise<Map<string, string>> {
    if (this.cache.has(tenantId)) return this.cache.get(tenantId)!;
    const types = await this.ontologyService.listObjectTypes(tenantId);
    const map = new Map<string, string>();
    for (const t of types) {
      map.set((t as any).name, (t as any).id);
    }
    this.cache.set(tenantId, map);
    return map;
  }
}
