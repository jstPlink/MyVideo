import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAsset, archOf, pickAssets } from '../src/downloads.js';

test('classificazione dei file di release', () => {
  assert.equal(classifyAsset('MyVideo-0.7.0.apk'), 'android');
  assert.equal(classifyAsset('MyVideo-Setup-0.7.0.exe'), 'windows');
  assert.equal(classifyAsset('MyVideo-0.7.0-mac-arm64.dmg'), 'mac');
  assert.equal(classifyAsset('MyVideo-0.7.0-linux-x86_64.AppImage'), 'linux');
  assert.equal(classifyAsset('MyVideo-Setup-0.7.0.exe.blockmap'), null);
  assert.equal(classifyAsset('notes.md'), null);
  assert.equal(archOf('MyVideo-0.7.0-mac-arm64.dmg'), 'arm64');
  assert.equal(archOf('MyVideo-Setup-0.7.0.exe'), null);
});

test('per ogni piattaforma vince la release piu recente che ha il file', () => {
  const rel = (tag, names, extra = {}) => ({
    tag_name: tag, published_at: '2026-11-01T00:00:00Z', draft: false, prerelease: false,
    assets: names.map((n) => ({ name: n, size: 1000, browser_download_url: `https://x/${tag}/${n}` })), ...extra,
  });
  // v0.8.0 e' ancora in compilazione (solo l'APK); l'installer Windows arriva dalla v0.7.0
  const picked = pickAssets([
    rel('v0.8.0', ['MyVideo-0.8.0.apk']),
    rel('v0.7.0', ['MyVideo-0.7.0.apk', 'MyVideo-Setup-0.7.0.exe', 'MyVideo-0.7.0-mac-arm64.dmg', 'MyVideo-0.7.0-mac-x64.dmg']),
    rel('v0.6.0', ['MyVideo-Setup-0.6.0.exe'], { draft: true }),
    rel('v0.5.0', ['MyVideo-Setup-0.5.0.exe', 'MyVideo-0.5.0-linux-x86_64.AppImage']),
  ]);
  const by = Object.fromEntries(picked.map((a) => [`${a.kind}:${a.arch || ''}`, a.version]));
  assert.equal(by['android:'], '0.8.0');
  assert.equal(by['windows:'], '0.7.0');
  assert.equal(by['mac:arm64'], '0.7.0');
  assert.equal(by['mac:x64'], '0.7.0');
  assert.equal(by['linux:x86_64'], '0.5.0');
  assert.equal(picked[0].kind, 'android');
});
