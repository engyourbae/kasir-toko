// Membuat js/config.js dari file .env (lokal) atau environment variable (CI/GitHub Actions).
// Pakai: node scripts/build-config.js     (tanpa dependency)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const env = { ...process.env };
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const fail = (msg) => { console.error('GAGAL: ' + msg); process.exit(1); };
const url = env.SUPABASE_URL, key = env.SUPABASE_ANON_KEY;
if (!url || !key) fail('SUPABASE_URL dan SUPABASE_ANON_KEY wajib diisi (di .env atau environment).');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) fail('SUPABASE_URL tidak valid.');
try {
  const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
  if (role !== 'anon') fail(`Key ini berperan "${role}", bukan "anon". JANGAN pakai service_role di aplikasi browser.`);
} catch (e) { if (e.message !== undefined && !/^process/.test(e.message)) fail('SUPABASE_ANON_KEY bukan JWT anon yang valid.'); }

const out = `// DIHASILKAN OTOMATIS oleh scripts/build-config.js dari .env -- jangan diedit & jangan di-commit.
window.APP_CONFIG = Object.freeze({
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)}
});
`;
fs.writeFileSync(path.join(root, 'js', 'config.js'), out);
console.log('js/config.js dibuat.');
