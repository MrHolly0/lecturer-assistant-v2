// Offline/operator tooling. This file never runs in an installed agent or backend.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
const [payloadPath, keyPath, keyId, outputPath] = process.argv.slice(2);
if (!payloadPath || !keyPath || !keyId || !outputPath) {
  console.error('Usage: node sign-release.mjs payload.json private-key.pem key-id envelope.json');
  process.exit(2);
}
const payload = readFileSync(payloadPath);
if (payload.length > 49152) throw new Error('Payload too large');
JSON.parse(payload.toString('utf8'));
const key = createPrivateKey(readFileSync(keyPath));
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('Expected P-256 signing key');
const signature = sign('sha256', payload, { key, dsaEncoding: 'ieee-p1363' });
writeFileSync(outputPath, JSON.stringify({ keyId, payload: payload.toString('base64'), signature: signature.toString('base64') }) + '\n', { mode: 0o600 });
console.log('Signed metadata written. Private key and payload were not printed.');
