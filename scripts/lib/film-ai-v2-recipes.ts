import type { IngestRecipe } from './run-recipe';
import type {
  BookWithAnalysis,
  MainCharExpanded,
  EdgeExpanded,
  PlotBeatExpanded,
  EmotionalPointExpanded,
  MarketScoreExpanded,
} from './film-ai-v2-source-reader';
import type { InstanceInput } from './object-instance-importer';
import { flattenBookAnalysis } from './book-analysis-flattener';

function bookToInstance(bwa: BookWithAnalysis): InstanceInput {
  const props = flattenBookAnalysis(bwa.book, bwa.analysis);
  return {
    externalId: bwa.book.id,
    label: bwa.book.title || bwa.book.id,
    properties: props as unknown as Record<string, unknown>,
    searchText: [
      props.title,
      props.tone,
      props.pace,
      ...(props.tags ?? []),
    ].filter(Boolean).join(' '),
  };
}

export const bookRecipe: IngestRecipe<BookWithAnalysis> = {
  objectType: 'Book',
  read: (ctx) => (ctx.sourceData['booksWithAnalysis'] ?? []) as BookWithAnalysis[],
  toInstance: (bwa) => bookToInstance(bwa),
};

// BookCharacter externalId composite — used as join key in ChapterCharacterMention.
export function bookCharacterExternalId(bookId: string, name: string): string {
  return `${bookId}::${name}`;
}

export const bookCharacterRecipe: IngestRecipe<MainCharExpanded> = {
  objectType: 'BookCharacter',
  read: (ctx) => (ctx.sourceData['mainCharRows'] ?? []) as MainCharExpanded[],
  parentRef: { objectType: 'Book', sourceField: 'book_external_id' },
  toInstance: (mc) => ({
    externalId: bookCharacterExternalId(mc.book_external_id, mc.name),
    label: mc.name,
    properties: {
      name: mc.name,
      desc: mc.desc,
      role: mc.role,
    },
    searchText: [mc.name, mc.desc].filter(Boolean).join(' '),
  }),
};

export const plotBeatRecipe: IngestRecipe<PlotBeatExpanded> = {
  objectType: 'PlotBeat',
  read: (ctx) => (ctx.sourceData['plotBeats'] ?? []) as PlotBeatExpanded[],
  parentRef: { objectType: 'Book', sourceField: 'book_external_id' },
  toInstance: (b) => ({
    externalId: `${b.book_external_id}::beat::${b.seq}`,
    label: b.label || `节拍 ${b.seq + 1}`,
    properties: {
      seq: b.seq,
      pct: b.pct,
      label: b.label,
      desc: b.desc,
    },
    searchText: [b.label, b.desc].filter(Boolean).join(' '),
  }),
};

export const emotionalCurvePointRecipe: IngestRecipe<EmotionalPointExpanded> = {
  objectType: 'EmotionalCurvePoint',
  read: (ctx) => (ctx.sourceData['emoPoints'] ?? []) as EmotionalPointExpanded[],
  parentRef: { objectType: 'Book', sourceField: 'book_external_id' },
  toInstance: (p) => ({
    externalId: `${p.book_external_id}::ep::${p.seq}`,
    label: `点 ${p.seq + 1} = ${p.value}`,
    properties: { seq: p.seq, value: p.value },
  }),
};

export const marketScoreRecipe: IngestRecipe<MarketScoreExpanded> = {
  objectType: 'MarketScore',
  read: (ctx) => (ctx.sourceData['marketScores'] ?? []) as MarketScoreExpanded[],
  parentRef: { objectType: 'Book', sourceField: 'book_external_id' },
  toInstance: (m) => ({
    externalId: `${m.book_external_id}::ms::${m.label}`,
    label: `${m.label}: ${m.score ?? '-'}`,
    properties: { label: m.label, score: m.score },
    searchText: m.label,
  }),
};

export const bookCharacterEdgeRecipe: IngestRecipe<EdgeExpanded> = {
  objectType: 'BookCharacterEdge',
  read: (ctx) => (ctx.sourceData['edgeRows'] ?? []) as EdgeExpanded[],
  entityResolution: {
    candidatesFromObjectType: 'BookCharacter',
    groupBy: 'book_external_id',
    nameField: 'name',
  },
  // We need to attach belongsTo to Book for the type-level relationship.
  // Since parentRef and relationships are mutually exclusive, we encode the
  // Book relationship inside the relationships callback alongside any other.
  relationships: (row, ctx) => {
    const bookMap = ctx.externalIdMaps.get('Book') ?? {};
    const bookPlatformId = bookMap[row.book_external_id];
    const out: Record<string, string> = {};
    if (bookPlatformId) out.belongsTo = bookPlatformId;
    return out;
  },
  toInstance: (edge, _ctx, deps) => {
    const fromCharExternalId = deps.resolve(edge.from_name);
    const toCharExternalId = deps.resolve(edge.to_name);
    const resolutionStatus =
      fromCharExternalId && toCharExternalId
        ? 'fully_resolved'
        : fromCharExternalId || toCharExternalId
          ? 'partially_resolved'
          : 'unresolved';
    return {
      externalId: `${edge.book_external_id}::edge::${edge.seq}`,
      label: `${edge.from_name} → ${edge.to_name}${edge.label ? ` (${edge.label})` : ''}`,
      properties: {
        from_string: edge.from_name,
        to_string: edge.to_name,
        label: edge.label,
        from_character_id: fromCharExternalId,
        to_character_id: toCharExternalId,
        resolution_status: resolutionStatus,
      },
      searchText: [edge.from_name, edge.to_name, edge.label].filter(Boolean).join(' '),
    };
  },
};
