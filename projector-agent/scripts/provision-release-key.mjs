// Run once in the release operator's environment. Never include the private file in an app or repository.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
const [privatePath, publicTrustPath, repository, keyId] = process.argv.slice(2);
if (!privatePath || !publicTrustPath || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^[A-Za-z0-9_.-]{1,80}$/.test(keyId ?? '')) {
  throw new Error('Usage: node provision-release-key.mjs PRIVATE.pem PUBLIC-TRUST.json OWNER/REPOSITORY KEY_ID');
}
let key;
if (existsSync(privatePath)) key = createPrivateKey(readFileSync(privatePath));
else {
  if (existsSync(publicTrustPath)) {
    const existing = JSON.parse(readFileSync(publicTrustPath, 'utf8'));
    if (Object.keys(existing.keys ?? {}).length) throw new Error('A public trust anchor exists without this private key. Restore the release key; do not silently rotate it.');
  }
  mkdirSync(dirname(privatePath), { recursive: true, mode: 0o700 });
  key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  writeFileSync(privatePath, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
}
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('Expected P-256 release key');
chmodSync(privatePath, 0o600);
const spki = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
const trust = existsSync(publicTrustPath) ? JSON.parse(readFileSync(publicTrustPath, 'utf8')) : { repository, keys: {} };
if (trust.repository && trust.repository !== repository) throw new Error('Trust repository mismatch');
if (trust.keys?.[keyId] && trust.keys[keyId] !== spki) throw new Error('Existing key ID has a different key; use the documented rotation flow');
trust.repository = repository;
trust.keys = { ...trust.keys, [keyId]: spki };
mkdirSync(dirname(publicTrustPath), { recursive: true });
writeFileSync(publicTrustPath, JSON.stringify(trust, null, 2) + '\n', { mode: 0o644 });
console.log('Public update trust provisioned. Private release key remains outside the app and repository.');
