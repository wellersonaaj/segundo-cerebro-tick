import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerAssistantRoutes } from './api/assistant.routes.js';
import { registerAuditRoutes } from './api/audit.routes.js';
import { registerClarificationsRoutes } from './api/clarifications.routes.js';
import { registerEntitiesRoutes } from './api/entities.routes.js';
import { registerHealthRoutes } from './api/health.routes.js';
import { registerInternalInboxRoutes } from './api/internal-inbox.routes.js';
import { registerInboxRoutes } from './api/inbox-items.routes.js';
import { registerMemoryRoutes } from './api/memory.routes.js';
import { registerTasksRoutes } from './api/tasks.routes.js';
import { registerTelegramWebhookRoutes } from './api/telegram-webhook.routes.js';
import { enforceInternalApiAccess } from './config/internal-api-access.js';
import { getSupabase } from './db/supabase.js';
import { createOpenAiExtractorV14 } from './openai/extractor-v1.4.service.js';
import { AssertionsRepository } from './repositories/assertions.repository.js';
import { AssertionsAuditRepository } from './repositories/assertions-audit.repository.js';
import { ClarificationsRepository } from './repositories/clarifications.repository.js';
import { CorrectionsRepository } from './repositories/corrections.repository.js';
import { EntitiesRepository } from './repositories/entities.repository.js';
import { EntityResolutionRepository } from './repositories/entity-resolution.repository.js';
import { EventsRepository } from './repositories/events.repository.js';
import { ExtractionRunsRepository } from './repositories/extraction-runs.repository.js';
import { InboxItemEntitiesRepository } from './repositories/inbox-item-entities.repository.js';
import { InboxItemsRepository } from './repositories/inbox-items.repository.js';
import { TasksRepository } from './repositories/tasks.repository.js';
import { TaskAuditRepository } from './repositories/task-audit.repository.js';
import { ExtractionRunsV2Repository } from './repositories/v2/extraction-runs-v2.repository.js';
import { AssistantSessionService } from './services/assistant-session.service.js';
import { AssistantTurnService } from './services/assistant-turn.service.js';
import { AuditService } from './services/audit.service.js';
import { ClarificationService } from './services/clarification.service.js';
import { CorrectionService, ReprocessService } from './services/correction.service.js';
import { ExtractionPipelineV14Service } from './services/extraction-pipeline-v14.service.js';
import { InboxItemProcessService } from './services/inbox-item-process.service.js';
import { MemorySearchService } from './services/memory-search.service.js';
import { TelegramInboxService } from './services/telegram-inbox.service.js';

export interface AppDeps {
  inboxItemProcess?: InboxItemProcessService;
  auditService?: AuditService;
  assistantTurn?: AssistantTurnService;
}

export async function buildApp(deps: AppDeps = {}) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.addHook('onRequest', async (req, reply) => {
    if (!enforceInternalApiAccess(req, reply)) {
      return reply;
    }
  });

  const db = getSupabase();
  const corrections = new CorrectionService(db);
  const reprocess = new ReprocessService(db);
  const v14Pipeline = new ExtractionPipelineV14Service(db, createOpenAiExtractorV14());
  const inboxItemProcess =
    deps.inboxItemProcess ??
    new InboxItemProcessService(new InboxItemsRepository(db), v14Pipeline);
  const inboxRepo = new InboxItemsRepository(db);
  const clarificationsRepo = new ClarificationsRepository(db);
  const tasksRepo = new TasksRepository(db);
  const clarifications = new ClarificationService(clarificationsRepo, v14Pipeline);
  const assistantSession = new AssistantSessionService(inboxRepo, clarificationsRepo, tasksRepo);
  const assistantTurn =
    deps.assistantTurn ??
    new AssistantTurnService(
      inboxRepo,
      inboxItemProcess,
      clarificationsRepo,
      clarifications,
      new TaskAuditRepository(db),
      new ExtractionRunsV2Repository(db),
    );
  const entitiesRepo = new EntitiesRepository(db);
  const search = new MemorySearchService(
    entitiesRepo,
    new EventsRepository(db),
    new AssertionsRepository(db),
    tasksRepo,
    new EntityResolutionRepository(db),
    new InboxItemEntitiesRepository(db),
  );

  await registerHealthRoutes(app);
  await registerInboxRoutes(app, {
    inboxItemProcess,
    corrections,
    reprocess,
    inboxRepo: inboxRepo,
    runsRepo: new ExtractionRunsRepository(db),
    inboxItemEntitiesRepo: new InboxItemEntitiesRepository(db),
    entitiesRepo,
  });
  await registerMemoryRoutes(app, search);
  await registerEntitiesRoutes(app, entitiesRepo, new EventsRepository(db), search);
  await registerTasksRoutes(app, tasksRepo);
  await registerClarificationsRoutes(app, clarifications);
  await registerAssistantRoutes(app, { assistantTurn, session: assistantSession });

  await registerInternalInboxRoutes(app, { inboxItemProcess });

  await registerTelegramWebhookRoutes(app, {
    telegramInbox: new TelegramInboxService(inboxRepo, assistantTurn, clarificationsRepo),
  });

  const auditService =
    deps.auditService ??
    new AuditService(
      new InboxItemsRepository(db),
      new ClarificationsRepository(db),
      new CorrectionsRepository(db),
      new ExtractionRunsRepository(db),
      new InboxItemEntitiesRepository(db),
      entitiesRepo,
      new EventsRepository(db),
      new AssertionsAuditRepository(db),
      new TaskAuditRepository(db),
    );
  await registerAuditRoutes(app, { auditService });

  return app;
}
