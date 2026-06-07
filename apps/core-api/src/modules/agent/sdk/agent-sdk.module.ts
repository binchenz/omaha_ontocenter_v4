import { Module } from '@nestjs/common';
import { OntologyModule } from '../../ontology/ontology.module';
import { TypeResolver } from './type-resolver.service';
import { ImportEngine } from './import-engine.service';
import { FileParserService } from '../tools/file-parser.service';

/**
 * The shared write-path primitives, provided once so every module that touches them
 * (OntologySdk, ResearchSdk's importer, the import/parse Tools) gets the SAME instance.
 * This matters for TypeResolver, whose per-tenant cache must be invalidated coherently
 * across all callers (ADR-0040). ImportEngine and FileParserService are stateless but
 * live here too so the single write path has one home.
 */
@Module({
  imports: [OntologyModule],
  providers: [TypeResolver, ImportEngine, FileParserService],
  exports: [TypeResolver, ImportEngine, FileParserService],
})
export class AgentSdkModule {}
