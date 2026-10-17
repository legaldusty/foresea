import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lanAddresses } from '../server/net';

const dir = path.resolve('certs');
fs.mkdirSync(dir, { recursive: true });
const ips = ['127.0.0.1', ...lanAddresses()];
const san = ['DNS:localhost', ...ips.map((ip) => `IP:${ip}`)].join(',');
const config = [
  '[req]', 'distinguished_name = dn', 'x509_extensions = ext', 'prompt = no',
  '[dn]', 'CN = GIVE WAY hub', 'O = GIVE WAY',
  '[ext]', `subjectAltName = ${san}`, 'basicConstraints = CA:FALSE', 'keyUsage = digitalSignature, keyEncipherment', 'extendedKeyUsage = serverAuth',
].join('\n');
const cnf = path.join(dir, 'openssl.cnf');
fs.writeFileSync(cnf, config);
const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-config', cnf], { stdio: 'inherit' });
if (r.status !== 0) { console.error('openssl failed'); process.exit(1); }
console.log(`Certificate for ${ips.join(', ')} written to certs/. The hub serves HTTPS on PORT+1 when it finds it.`);
console.log('Phones will warn about the certificate until it is trusted. For push on a judge phone, use npm run demo -- --tunnel.');
