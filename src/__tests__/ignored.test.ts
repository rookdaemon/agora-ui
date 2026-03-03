import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getIgnoredPeersPath, IgnoredPeersManager, IGNORED_FILE_NAME } from '@rookdaemon/agora';

const TEST_DIR = join(tmpdir(), 'agora-ui-ignored-test');
const TEST_FILE = join(TEST_DIR, IGNORED_FILE_NAME);

describe('ignored peers persistence', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('builds ignored path from storage dir', () => {
    expect(getIgnoredPeersPath(TEST_DIR)).toBe(TEST_FILE);
  });

  it('returns empty list when file is absent', () => {
    const manager = new IgnoredPeersManager(TEST_FILE);
    expect(manager.listIgnoredPeers()).toEqual([]);
  });

  it('persists unique sorted peers with header', () => {
    const manager = new IgnoredPeersManager(TEST_FILE);
    manager.ignorePeer('peer-b');
    manager.ignorePeer('peer-a');
    manager.ignorePeer('peer-b');
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('# Ignored peers');
    expect(manager.listIgnoredPeers()).toEqual(['peer-a', 'peer-b']);
  });

  it('ignores comments and blank lines on load', () => {
    writeFileSync(TEST_FILE, '# comment\n\npeer-a\npeer-b\n', 'utf-8');
    const manager = new IgnoredPeersManager(TEST_FILE);
    expect(manager.listIgnoredPeers()).toEqual(['peer-a', 'peer-b']);
  });
});
