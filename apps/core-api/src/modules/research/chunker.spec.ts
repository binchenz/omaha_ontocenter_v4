import { Chunker } from './chunker';

describe('Chunker', () => {
  const chunker = new Chunker();

  it('returns one chunk for a page shorter than the chunk size', () => {
    const chunks = chunker.chunk([{ page: 1, text: '短页内容' }], { size: 100, overlap: 20 });
    expect(chunks).toEqual([{ page: 1, text: '短页内容' }]);
  });

  it('splits a long page into overlapping chunks', () => {
    const text = 'a'.repeat(250);
    const chunks = chunker.chunk([{ page: 1, text }], { size: 100, overlap: 20 });
    // stride = size - overlap = 80 → starts at 0, 80, 160 → 3 chunks
    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toHaveLength(100);
    expect(chunks[1].text).toHaveLength(100);
    expect(chunks[2].text).toHaveLength(90); // tail: chars 160..250
  });

  it('overlaps consecutive chunks by exactly `overlap` characters', () => {
    const text = Array.from({ length: 250 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
    const chunks = chunker.chunk([{ page: 1, text }], { size: 100, overlap: 20 });
    const tailOfFirst = chunks[0].text.slice(-20);
    const headOfSecond = chunks[1].text.slice(0, 20);
    expect(headOfSecond).toBe(tailOfFirst);
  });

  it('preserves the page anchor on every chunk', () => {
    const long = 'x'.repeat(150);
    const chunks = chunker.chunk(
      [
        { page: 3, text: long },
        { page: 7, text: '另一页' },
      ],
      { size: 100, overlap: 20 },
    );
    const page3 = chunks.filter((c) => c.page === 3);
    const page7 = chunks.filter((c) => c.page === 7);
    expect(page3.length).toBeGreaterThan(1); // 150 chars splits
    expect(page7).toHaveLength(1);
    expect(page7[0].text).toBe('另一页');
  });

  it('chunks each page independently so a chunk never spans pages', () => {
    const chunks = chunker.chunk(
      [
        { page: 1, text: 'a'.repeat(90) },
        { page: 2, text: 'b'.repeat(90) },
      ],
      { size: 100, overlap: 20 },
    );
    // Each page is < size → one chunk each, neither mixing a/b.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ page: 1, text: 'a'.repeat(90) });
    expect(chunks[1]).toEqual({ page: 2, text: 'b'.repeat(90) });
  });

  it('trims and skips empty or whitespace-only pages', () => {
    const chunks = chunker.chunk(
      [
        { page: 1, text: '  \n  ' },
        { page: 2, text: '  有内容  ' },
        { page: 3, text: '' },
      ],
      { size: 100, overlap: 20 },
    );
    expect(chunks).toEqual([{ page: 2, text: '有内容' }]);
  });
});
