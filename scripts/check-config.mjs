import { loadConfig } from '../lib/config.js';
import { validateConfig } from '../lib/security.js';
const c = loadConfig();
try {
  validateConfig(c);
  const missing = [];
  if (new URL(c.publicBase).hostname === 'example.com') missing.push('PUBLIC_BASE');
  if (!c.appSecret && !c.parentAppSecret) missing.push('META_APP_SECRET or META_PARENT_APP_SECRET');
  if (c.verifyToken.length < 24) missing.push('WEBHOOK_VERIFY_TOKEN (24+ characters)');
  if (missing.length) throw new Error('Configure: ' + missing.join(', '));
  console.log('Configuration structure OK. This does not verify Meta permissions, token validity or delivery.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
