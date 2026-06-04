import { describe, expect, it } from 'vitest';
import {
  isMvpAutoRegistryEntityType,
  isMvpBlockedGenericEntityTerm,
  isMvpRegistryEligibleReference,
  isReferenceCentralToTaskSignals,
  MVP_AUTO_REGISTRY_ENTITY_TYPES,
  MVP_BLOCKED_GENERIC_ENTITY_TERMS,
} from '../src/config/mvp-registry-policy.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';

function minimalOutput(
  mentions: ExtractorOutputV14['entity_mentions'],
): Pick<ExtractorOutputV14, 'entity_mentions'> {
  return { entity_mentions: mentions };
}

describe('mvp-registry-policy (S1)', () => {
  it('auto-registry allowlist is person, company, project, product only', () => {
    expect(MVP_AUTO_REGISTRY_ENTITY_TYPES).toEqual([
      'person',
      'company',
      'project',
      'product',
    ]);
    expect(isMvpAutoRegistryEntityType('person')).toBe(true);
    expect(isMvpAutoRegistryEntityType('meeting')).toBe(false);
    expect(isMvpAutoRegistryEntityType('topic')).toBe(false);
    expect(isMvpAutoRegistryEntityType('location')).toBe(false);
  });

  it('registry eligibility requires exact mention match on allowlisted type', () => {
    const output = minimalOutput([
      {
        mention_text: 'Marcelo',
        suggested_entity_type: 'person',
        source_excerpt: 'x',
        confidence: 0.9,
      },
      {
        mention_text: 'integração',
        suggested_entity_type: 'topic',
        source_excerpt: 'x',
        confidence: 0.5,
      },
    ]);
    expect(isMvpRegistryEligibleReference('Marcelo', output)).toBe(true);
    expect(isMvpRegistryEligibleReference('integração', output)).toBe(false);
    expect(isMvpRegistryEligibleReference('reunião sobre a integração', output)).toBe(
      false,
    );
  });

  it('S3.1: blocked generic/metalinguistic terms', () => {
    expect(MVP_BLOCKED_GENERIC_ENTITY_TERMS).toContain('cliente');
    expect(isMvpBlockedGenericEntityTerm('cliente')).toBe(true);
    expect(isMvpBlockedGenericEntityTerm('VELT')).toBe(false);
    expect(isMvpBlockedGenericEntityTerm('Bruno Brant')).toBe(false);
  });

  it('task-central reference matches target_reference or title', () => {
    const tasks = [
      {
        title: 'Descobrir se ir ao ESX será bom para a Velt',
        due_at: null,
        operation: 'create' as const,
        task_kind: 'follow_up' as const,
        confidence: 0.9,
        status_signal: 'open' as const,
        blocked_reason: null,
        source_excerpt: 'Preciso descobrir se ir ao ESX vai ser bom para nós da Velt',
        task_reference: null,
        target_reference: 'ESX',
        project_reference: null,
        assignee_reference: null,
        source_block_reference: '[SOURCE_BLOCK:raw]',
      },
    ];
    expect(isReferenceCentralToTaskSignals('ESX', tasks)).toBe(true);
    expect(isReferenceCentralToTaskSignals('reunião sobre a integração', tasks)).toBe(false);
    expect(isReferenceCentralToTaskSignals('ESX', [])).toBe(false);
  });
});
