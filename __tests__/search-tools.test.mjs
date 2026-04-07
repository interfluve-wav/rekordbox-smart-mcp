import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Search MCP tools integration smoke test', () => {
  const indexPath = resolve(process.cwd(), 'src/index.ts');
  const source = readFileSync(indexPath, 'utf-8');

  test('registers key-compatible search tool', () => {
    expect(source).toContain("name: 'search_keyCompatible'");
  });

  test('routes key-compatible search tool calls to handler', () => {
    expect(source).toContain("case 'search_keyCompatible':");
    expect(source).toContain('libraryTools.searchKeyCompatible');
  });

  test('registers fuzzy search tool', () => {
    expect(source).toContain("name: 'library_fuzzySearch'");
  });

  test('routes fuzzy search tool calls to handler', () => {
    expect(source).toContain("case 'library_fuzzySearch':");
    expect(source).toContain('libraryTools.fuzzySearchLibrary');
  });
});
