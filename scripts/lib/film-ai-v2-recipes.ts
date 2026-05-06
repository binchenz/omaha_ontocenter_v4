import type { IngestRecipe } from './run-recipe';
import type { BookWithAnalysis } from './film-ai-v2-source-reader';
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
