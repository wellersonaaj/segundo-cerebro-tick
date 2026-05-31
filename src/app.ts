import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerClarificationsRoutes } from './api/clarifications.routes.js';
import { registerEntitiesRoutes } from './api/entities.routes.js';
import { registerHealthRoutes } from './api/health.routes.js';
import { registerInboxRoutes } from './api/inbox-items.routes.js';
import { registerMemoryRoutes } from './api/memory.routes.js';
import { registerTasksRoutes } from './api/tasks.routes.js';
import { getSupabase } from './db/supabase.js';
import { createOpenAiExtractor, type ExtractFn } from './openai/extractor.service.js';
import { EntitiesRepository } from './repositories/entities.repository.js';
import { EventsRepository } from './repositories/events.repository.js';
import { TasksRepository } from './repositories/tasks.repository.js';
import { ClarificationService } from './services/clarification.service.js';
import { ClarificationsRepository } from './repositories/clarifications.repository.js';
import { CorrectionService } from './services/correction.service.js';
import { InboxProcessorService } from './services/inbox-processor.service.js';
import { MemorySearchService } from './services/memory-search.service.js';
import { AssertionsRepository } from './repositories/assertions.repository.js';
import { EntityResolutionRepository } from './repositories/entity-resolution.repository.js';

export interface AppDeps {
  extract?: ExtractFn;
}

export async function buildApp(deps: AppDeps = {}) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const db = getSupabase();
  const extract = deps.extract ?? createOpenAiExtractor();
  const processor = new InboxProcessorService(db, extract);
  const corrections = new CorrectionService(db, extract);
  const clarifications = new ClarificationService(new ClarificationsRepository(db));
  const search = new MemorySearchService(
    new EntitiesRepository(db),
    new EventsRepository(db),
    new AssertionsRepository(db),
    new TasksRepository(db),
    new EntityResolutionRepository(db),
  );

  await registerHealthRoutes(app);
  await registerInboxRoutes(app, processor, corrections);
  await registerMemoryRoutes(app, search);
  await registerEntitiesRoutes(
    app,
    new EntitiesRepository(db),
    new EventsRepository(db),
    search,
  );
  await registerTasksRoutes(app, new TasksRepository(db));
  await registerClarificationsRoutes(app, clarifications);

  return app;
}
