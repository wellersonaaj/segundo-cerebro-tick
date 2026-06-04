/**
 * Registra o webhook do bot no Telegram (URL aponta para o n8n ou endpoint público).
 * Uso: npm run telegram:set-webhook
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';
import { requireTelegramConfig } from '../src/config/telegram.js';
import { setTelegramWebhook } from '../src/telegram/telegram-bot.client.js';

loadDotEnv();

const config = requireTelegramConfig();

console.log('Registrando webhook Telegram…');
console.log('  URL:', config.webhookUrl);
console.log('  Usuário permitido (app):', config.allowedUserId);

await setTelegramWebhook(config);

console.log('OK: setWebhook concluído. Encaminhe o payload para POST /webhooks/telegram na API com o mesmo secret.');
