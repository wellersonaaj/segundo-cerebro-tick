import { describe, expect, it } from 'vitest';
import {
  ReferenceResolverService,
  type RegistryEntityFixture,
} from '../src/services/reference-resolver.service.js';

const GENIUS_HOTELS: RegistryEntityFixture = {
  id: 'a0000000-0000-4000-8000-000000000099',
  name: 'Genius Hotels',
  normalized_name: 'genius hotels',
  entity_type: 'company',
  aliases: ['Genius'],
};

const GENIUS_HOMONYM: RegistryEntityFixture = {
  id: 'rogue-genius-entity',
  name: 'Genius',
  normalized_name: 'genius',
  entity_type: 'other',
  aliases: [],
};

describe('ReferenceResolverService', () => {
  it('prefers global exact alias over homonym entity name', () => {
    const resolver = new ReferenceResolverService([GENIUS_HOMONYM, GENIUS_HOTELS]);
    const result = resolver.resolveOne('Genius');
    expect(result.status).toBe('resolved');
    expect(result.entity_id).toBe(GENIUS_HOTELS.id);
    expect(result.canonical_name).toBe('Genius Hotels');
  });

  it('resolves Bruno by exact name when unambiguous', () => {
    const resolver = new ReferenceResolverService([
      {
        id: 'bruno-id',
        name: 'Bruno Brant Gotschalg',
        normalized_name: 'bruno brant gotschalg',
        entity_type: 'person',
        aliases: ['Bruno'],
      },
    ]);
    const result = resolver.resolveOne('Bruno');
    expect(result.status).toBe('resolved');
    expect(result.entity_id).toBe('bruno-id');
  });

  it('returns unresolved for unknown reference', () => {
    const resolver = new ReferenceResolverService([GENIUS_HOTELS]);
    const result = resolver.resolveOne('Empresa Inexistente XYZ');
    expect(result.status).toBe('unresolved');
    expect(result.entity_id).toBeNull();
  });
});
