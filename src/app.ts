import cors from '@fastify/cors';
import Fastify from 'fastify';
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
import { createOpenAiExtractor, type ExtractFn } from './openai/extractor.service.js';
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
import { AuditService } from './services/audit.service.js';
import { ClarificationService } from './services/clarification.service.js';
import { CorrectionService, ReprocessService } from './services/correction.service.js';
import { ExtractionPipelineV14Service } from './services/extraction-pipeline-v14.service.js';
import { InboxItemProcessService } from './services/inbox-item-process.service.js';
import { InboxProcessorService } from './services/inbox-processor.service.js';
import { MemorySearchService } from './services/memory-search.service.js';
import { TelegramInboxService } from './services/telegram-inbox.service.js';

export interface AppDeps {
  extract?: ExtractFn;
  inboxItemProcess?: InboxItemProcessService;
  auditService?: AuditService;
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
  const extract = deps.extract ?? createOpenAiExtractor();
  const processor = new InboxProcessorService(db, extract);
  const corrections = new CorrectionService(db, extract);
  const reprocess = new ReprocessService(db, extract);
  const clarifications = new ClarificationService(new ClarificationsRepository(db));
  const entitiesRepo = new EntitiesRepository(db);
  const search = new MemorySearchService(
    entitiesRepo,
    new EventsRepository(db),
    new AssertionsRepository(db),
    new TasksRepository(db),
    new EntityResolutionRepository(db),
    new InboxItemEntitiesRepository(db),
  );

  await registerHealthRoutes(app);
  await registerInboxRoutes(app, {
    processor,
    corrections,
    reprocess,
    inboxRepo: new InboxItemsRepository(db),
    runsRepo: new ExtractionRunsRepository(db),
    inboxItemEntitiesRepo: new InboxItemEntitiesRepository(db),
    entitiesRepo,
  });
  await registerMemoryRoutes(app, search);
  await registerEntitiesRoutes(app, entitiesRepo, new EventsRepository(db), search);
  await registerTasksRoutes(app, new TasksRepository(db));
  await registerClarificationsRoutes(app, clarifications);

  await registerTelegramWebhookRoutes(app, {
    telegramInbox: new TelegramInboxService(processor),
  });

  const inboxItemProcess =
    deps.inboxItemProcess ??
    new InboxItemProcessService(
      new InboxItemsRepository(db),
      new ExtractionPipelineV14Service(db, createOpenAiExtractorV14()),
    );
  await registerInternalInboxRoutes(app, { inboxItemProcess });

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
