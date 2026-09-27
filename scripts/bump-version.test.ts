import { describe, expect, test } from 'bun:test';
import {
  normalizeVersion,
  readPackageName,
  readWorkspaceMembers,
  readWorkspaceVersion,
  setCargoLockVersions,
  setPackageJsonVersion,
  setWorkspaceVersion,
  usesWorkspaceVersion,
} from './bump-version.ts';

describe('normalizeVersion', () => {
  test('accepts plain semver', () => {
    expect(normalizeVersion('0.3.1')).toBe('0.3.1');
  });

  test('strips a leading v', () => {
    expect(normalizeVersion('v0.3.1')).toBe('0.3.1');
  });

  test('accepts prerelease versions', () => {
    expect(normalizeVersion('v1.0.0-beta.1')).toBe('1.0.0-beta.1');
  });

  test('rejects non-semver input', () => {
    expect(() => normalizeVersion('0.3')).toThrow();
    expect(() => normalizeVersion('release')).toThrow();
    expect(() => normalizeVersion('')).toThrow();
  });
});

describe('cargo manifest helpers', () => {
  const cargoToml = `[workspace]
members = [
    "crates/foo",
    "crates/bar",
]
resolver = "2"

[workspace.package]
version = "0.2.0"
edition = "2021"

[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
`;

  test('readWorkspaceVersion reads the workspace version', () => {
    expect(readWorkspaceVersion(cargoToml)).toBe('0.2.0');
  });

  test('readWorkspaceMembers lists member directories', () => {
    expect(readWorkspaceMembers(cargoToml)).toEqual(['crates/foo', 'crates/bar']);
  });

  test('readPackageName reads the member crate name', () => {
    expect(readPackageName('[package]\nname = "tiktools-foo"\nversion.workspace = true\n')).toBe(
      'tiktools-foo',
    );
  });

  test('setWorkspaceVersion only touches the workspace version', () => {
    const updated = setWorkspaceVersion(cargoToml, '0.3.1');
    expect(updated).toContain('[workspace.package]\nversion = "0.3.1"');
    expect(updated).toContain('serde = { version = "1.0", features = ["derive"] }');
    expect(readWorkspaceVersion(updated)).toBe('0.3.1');
  });

  test('setWorkspaceVersion throws when the version is missing', () => {
    expect(() => setWorkspaceVersion('[workspace.package]\nedition = "2021"\n', '0.3.1')).toThrow();
  });

  test('usesWorkspaceVersion detects inherited vs independent versions', () => {
    expect(usesWorkspaceVersion('[package]\nname = "a"\nversion.workspace = true\n')).toBe(true);
    expect(usesWorkspaceVersion('[package]\nname = "b"\nversion = "1.0.0"\n')).toBe(false);
  });
});

describe('setPackageJsonVersion', () => {
  test('updates the version key preserving the rest', () => {
    const updated = setPackageJsonVersion(
      JSON.stringify({ name: 'app', version: '0.2.0', private: true }, null, 2),
      '0.3.1',
    );
    expect(JSON.parse(updated)).toEqual({ name: 'app', version: '0.3.1', private: true });
  });
});

describe('setCargoLockVersions', () => {
  const lock = `[[package]]
name = "tiktools-desktop"
version = "0.2.0"
dependencies = [
 "gtk",
]

[[package]]
name = "third-party"
version = "0.2.0"

[[package]]
name = "tiktools-core"
version = "0.2.0"
`;

  test('bumps only the listed workspace packages', () => {
    const result = setCargoLockVersions(lock, ['tiktools-desktop', 'tiktools-core'], '0.2.0', '0.3.1');
    expect(result.updated).toEqual(['tiktools-desktop', 'tiktools-core']);
    expect(result.missing).toEqual([]);
    expect(result.text).toContain('name = "tiktools-desktop"\nversion = "0.3.1"');
    expect(result.text).toContain('name = "third-party"\nversion = "0.2.0"');
  });

  test('reports packages without a matching entry', () => {
    const result = setCargoLockVersions(lock, ['tiktools-desktop', 'tiktools-missing'], '0.2.0', '0.3.1');
    expect(result.updated).toEqual(['tiktools-desktop']);
    expect(result.missing).toEqual(['tiktools-missing']);
  });

  test('does not touch entries already at another version', () => {
    const result = setCargoLockVersions(lock, ['tiktools-desktop'], '9.9.9', '0.3.1');
    expect(result.text).toBe(lock);
    expect(result.missing).toEqual(['tiktools-desktop']);
  });
});
