import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Rekordbox Smart MCP core tool registration', () => {
  const indexPath = resolve(process.cwd(), 'src/index.ts');
  const source = readFileSync(indexPath, 'utf-8');

  test('registers mutation_history tool', () => {
    expect(source).toContain("name: 'mutation_history'");
  });

  test('registers mutation_rollback tool', () => {
    expect(source).toContain("name: 'mutation_rollback'");
  });

  test('routes mutation_history to handler', () => {
    expect(source).toContain("case 'mutation_history':");
    expect(source).toContain('mutationTools.mutationHistory');
  });

  test('routes mutation_rollback to handler', () => {
    expect(source).toContain("case 'mutation_rollback':");
    expect(source).toContain('mutationTools.mutationRollback');
  });

  test('does not register supermemory tools', () => {
    expect(source).not.toContain('supermemory_add');
    expect(source).not.toContain('supermemory_search');
    expect(source).not.toContain('supermemory_getDocument');
  });

  test('does not register natlang search', () => {
    expect(source).not.toContain('search_natlang');
  });

  test('does not register audio analysis tools', () => {
    expect(source).not.toContain('audio_getMetadata');
    expect(source).not.toContain('audio_detectKey');
    expect(source).not.toContain('audio_extractAlbumArt');
    expect(source).not.toContain('audio_bpmDetectAubio');
    expect(source).not.toContain('audio_convert');
    expect(source).not.toContain('audio_writeTags');
  });

  test('does not register tiered aliases', () => {
    expect(source).not.toContain('safe_');
    expect(source).not.toContain('write_');
    expect(source).not.toContain('danger_');
  });

  test('does not register UI dashboard resource', () => {
    expect(source).not.toContain('ui_dashboard');
  });
});
