/**
 * Registra o webhook do bot no Telegram apontando para POST /webhooks/telegram desta API.
 * Uso: npm run telegram:set-webhook
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';
import { requireTelegramConfig } from '../src/config/telegram.js';
import { setTelegramWebhook } from '../src/telegram/telegram-bot.client.js';

loadDotEnv();

const config = requireTelegramConfig();

const expectedPath = '/webhooks/telegram';
if (!config.webhookUrl.includes(expectedPath)) {
  console.warn('');
  console.warn(`AVISO: TELEGRAM_WEBHOOK_URL deve apontar para ${expectedPath} nesta API.`);
  console.warn(`  Valor atual: ${config.webhookUrl}`);
  console.warn(`  Exemplo:     https://<sua-app>.up.railway.app/webhooks/telegram`);
  console.warn('');
}

console.log('Registrando webhook Telegram (direto na API)…');
console.log('  URL:', config.webhookUrl);
console.log('  Usuário permitido (app):', config.allowedUserId);

await setTelegramWebhook(config);

console.log('OK: setWebhook concluído.');
console.log('Fluxo: Telegram → POST /webhooks/telegram → assistente + Supabase + resposta no chat.');
