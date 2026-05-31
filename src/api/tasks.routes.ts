import type { FastifyInstance } from 'fastify';
import { TasksRepository } from '../repositories/tasks.repository.js';

export async function registerTasksRoutes(
  app: FastifyInstance,
  tasksRepo: TasksRepository,
): Promise<void> {
  app.get('/tasks', async (req) => {
    const status = (req.query as { status?: string }).status;
    const query = (req.query as { q?: string }).q;
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    if (status === 'open') return tasksRepo.listOpen(query, limit);
    return tasksRepo.list(status as 'open' | 'done' | 'cancelled' | undefined, query, limit);
  });
}
