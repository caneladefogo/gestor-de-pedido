import { writeFile } from 'node:fs/promises';

const version = process.env.COMMIT_REF || process.env.DEPLOY_ID || `local-${Date.now()}`;
await writeFile('version.json', JSON.stringify({ version, generatedAt: new Date().toISOString() }));
console.log(`Versão publicada: ${version}`);
