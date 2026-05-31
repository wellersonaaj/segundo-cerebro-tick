#!/usr/bin/env node
import '../config/load-dotenv.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadEnv } from '../config/env.js';
import { getSupabase } from '../db/supabase.js';
import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import { ClarificationService } from '../services/clarification.service.js';
import { MemorySearchService } from '../services/memory-search.service.js';
import { getEntityDetails, getEntityDetailsInputSchema } from './tools/get-entity-details.tool.js';
import {
  listPendingClarifications,
  listPendingClarificationsInputSchema,
} from './tools/list-pending-clarifications.tool.js';
import { listOpenTasks, listOpenTasksInputSchema } from './tools/list-open-tasks.tool.js';
import { searchEntities, searchEntitiesInputSchema } from './tools/search-entities.tool.js';
import { searchMemory, searchMemoryInputSchema } from './tools/search-memory.tool.js';
import {
  searchRecentMentions,
  searchRecentMentionsInputSchema,
} from './tools/search-recent-mentions.tool.js';

async function main() {
  loadEnv();
  const db = getSupabase();
  const search = new MemorySearchService(
    new EntitiesRepository(db),
    new EventsRepository(db),
    new AssertionsRepository(db),
    new TasksRepository(db),
    new EntityResolutionRepository(db),
  );
  const clarifications = new ClarificationService(new ClarificationsRepository(db));

  const server = new Server(
    { name: 'segundo-cerebro-memory', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_entities',
        description: 'Search entities by name or alias',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            entity_types: { type: 'array', items: { type: 'string' } },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_entity_details',
        description: 'Get entity with aliases, recent events and open tasks',
        inputSchema: {
          type: 'object',
          properties: { entity_id: { type: 'string' } },
          required: ['entity_id'],
        },
      },
      {
        name: 'search_recent_mentions',
        description: 'Search recent event mentions matching query',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            days: { type: 'number' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_memory',
        description: 'Search memory across entities, events, assertions and tasks',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
          required: ['query'],
        },
      },
      {
        name: 'list_open_tasks',
        description: 'List open tasks optionally filtered by query',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
        },
      },
      {
        name: 'list_pending_clarifications',
        description: 'List pending clarification requests',
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number' } },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      let result: unknown;
      switch (name) {
        case 'search_entities':
          result = await searchEntities(search, searchEntitiesInputSchema.parse(args ?? {}));
          break;
        case 'get_entity_details':
          result = await getEntityDetails(search, getEntityDetailsInputSchema.parse(args ?? {}));
          break;
        case 'search_recent_mentions':
          result = await searchRecentMentions(
            search,
            searchRecentMentionsInputSchema.parse(args ?? {}),
          );
          break;
        case 'search_memory':
          result = await searchMemory(search, searchMemoryInputSchema.parse(args ?? {}));
          break;
        case 'list_open_tasks':
          result = await listOpenTasks(search, listOpenTasksInputSchema.parse(args ?? {}));
          break;
        case 'list_pending_clarifications':
          result = await listPendingClarifications(
            clarifications,
            listPendingClarificationsInputSchema.parse(args ?? {}),
          );
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
