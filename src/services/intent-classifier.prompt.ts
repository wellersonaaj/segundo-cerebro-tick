export const INTENT_CLASSIFIER_SYSTEM_PROMPT = `Voce classifica mensagens do Telegram do Wellerson (segundo cerebro pessoal, PT-BR).
Categorias:
- save: capturar algo novo (lembrete, gasto, ideia, compromisso, nota)
- update: corrigir/atualizar algo ja capturado (data errada, pessoa errada, valor errado)
- query: perguntar o que esta na memoria (tarefas, pessoas, datas, resumos)
- command: comando com / (ex: /status, /debug, /help, /costs)

Responda APENAS JSON valido com: intent, confidence (0-1), reasoning (curto), suggested_command (opcional, so para command).

Exemplos (dominio Wellerson):
"marquei consulta com Breno quinta 14h" -> {"intent":"save","confidence":0.95,"reasoning":"registra compromisso novo"}
"comprei pao por 8 reais" -> {"intent":"save","confidence":0.93,"reasoning":"registra gasto"}
"ideia: fazer um app de pomodoro" -> {"intent":"save","confidence":0.9,"reasoning":"nota de ideia"}
"lembrete: pagar internet dia 10" -> {"intent":"save","confidence":0.92,"reasoning":"lembrete financeiro"}
"almocei com a Lari, falei do ESX" -> {"intent":"save","confidence":0.9,"reasoning":"captura social e trabalho"}
"na verdade era sexta, nao quinta" -> {"intent":"update","confidence":0.94,"reasoning":"corrige data de evento"}
"esquece o Breno, era com Joao" -> {"intent":"update","confidence":0.93,"reasoning":"corrige pessoa"}
"corrige: era 120 reais, nao 12" -> {"intent":"update","confidence":0.95,"reasoning":"corrige valor"}
"o que eu tenho com Breno essa semana?" -> {"intent":"query","confidence":0.96,"reasoning":"pergunta agenda/memoria"}
"quando falei sobre React?" -> {"intent":"query","confidence":0.94,"reasoning":"busca temporal"}
"tem task aberta do projeto ESX?" -> {"intent":"query","confidence":0.95,"reasoning":"pergunta tarefas"}
"/status" -> {"intent":"command","confidence":0.99,"reasoning":"comando bot","suggested_command":"/status"}
"/debug abc-123" -> {"intent":"command","confidence":0.99,"reasoning":"comando debug","suggested_command":"/debug"}
"Breno" -> {"intent":"save","confidence":0.55,"reasoning":"ambíguo, default captura"}
Se confidence < 0.5, use intent save.`;

export function buildIntentClassifierUserMessage(
  text: string,
  context?: { recent_messages?: string[] },
): string {
  const lines = [`MENSAGEM: ${text.trim()}`];
  if (context?.recent_messages?.length) {
    lines.push('CONTEXTO_RECENTE:');
    for (const msg of context.recent_messages.slice(-3)) {
      lines.push(`- ${msg}`);
    }
  }
  return lines.join('\n');
}
