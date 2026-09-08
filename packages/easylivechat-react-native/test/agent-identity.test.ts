import { describe, expect, it } from 'vitest';

import { parseChatMessage, withIdentityFrom } from '../src/models/chat-message';

/**
 * Port of `agent_identity_test.dart`.
 *
 * A bare `message:updated` must not blank the sender's name/avatar. The server
 * resolves those per viewer on the way out and only on some paths, so the raw
 * row a delivery receipt fans out carries none of them — and clients replace
 * by id. The visitor's own read receipt fires that update seconds after every
 * reply lands, so the agent's face appeared and then vanished.
 */
describe('withIdentityFrom', () => {
  const withFace = parseChatMessage({
    id: 'm1',
    conversationId: 'c1',
    body: 'Hi, how can I help?',
    senderType: 'AGENT',
    senderName: 'Ava',
    senderAvatarUrl: '/uploads/ava.png',
    senderJobTitle: 'Support Lead',
    createdAt: '2026-09-01T10:00:00.000Z',
  });

  const bareUpdate = parseChatMessage({
    id: 'm1',
    conversationId: 'c1',
    body: 'Hi, how can I help?',
    senderType: 'AGENT',
    readByAgentAt: '2026-09-01T10:00:05.000Z',
    createdAt: '2026-09-01T10:00:00.000Z',
  });

  it('inherits name, avatar and job title from the row it replaces', () => {
    const merged = withIdentityFrom(bareUpdate, withFace);
    expect(merged.senderName).toBe('Ava');
    expect(merged.senderAvatarUrl).toBe('/uploads/ava.png');
    expect(merged.senderJobTitle).toBe('Support Lead');
    // Everything else still comes from the update.
    expect(merged.readByAgent).toBe(true);
  });

  it('keeps its own identity when the update carries one', () => {
    const renamed = parseChatMessage({
      id: 'm1',
      conversationId: 'c1',
      senderType: 'AGENT',
      senderName: 'Sam',
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    expect(withIdentityFrom(renamed, withFace).senderName).toBe('Sam');
  });

  it('is a no-op when the previous row had no identity either', () => {
    const merged = withIdentityFrom(bareUpdate, bareUpdate);
    expect(merged.senderName).toBeUndefined();
    expect(merged).toBe(bareUpdate);
  });

  it('adopts a senderAgentId only when it has none of its own', () => {
    const previous = { ...withFace, senderAgentId: 'a1' };
    expect(withIdentityFrom(bareUpdate, previous).senderAgentId).toBe('a1');
    const withOwnId = { ...bareUpdate, senderAgentId: 'a2' };
    expect(withIdentityFrom(withOwnId, previous).senderAgentId).toBe('a2');
  });
});

describe('parseChatMessage leniency', () => {
  it('accepts the raw Prisma row and the trimmed REST row alike', () => {
    const raw = parseChatMessage({
      id: 'm1',
      conversation_id: 'c1',
      agentId: 'a1',
      agentName: 'Ava',
      agentAvatarUrl: '/uploads/ava.png',
      status: 'READ',
      readByAgentAt: '2026-09-01T10:00:05.000Z',
      created_at: '2026-09-01T10:00:00.000Z',
      senderType: 'AGENT',
    });
    expect(raw.conversationId).toBe('c1');
    expect(raw.senderAgentId).toBe('a1');
    expect(raw.senderName).toBe('Ava');
    expect(raw.deliveryStatus).toBe('read');
    expect(raw.readByAgent).toBe(true);

    const trimmed = parseChatMessage({
      id: 'm2',
      conversationId: 'c1',
      read: true,
      senderType: 'CUSTOMER',
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    expect(trimmed.readByAgent).toBe(true);
  });

  it('degrades an unknown enum value rather than throwing', () => {
    const m = parseChatMessage({
      id: 'm1',
      conversationId: 'c1',
      senderType: 'PARTNER_BOT',
      contentType: 'HOLOGRAM',
      deliveryStatus: 'TELEPORTED',
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    expect(m.senderType).toBe('unknown');
    expect(m.contentType).toBe('unknown');
    expect(m.deliveryStatus).toBe('unknown');
  });

  it('never falls back to now() for a malformed timestamp', () => {
    // Epoch 0 is deterministic: it sorts to the top and STAYS PUT on re-parse.
    // `Date.now()` would re-order the row on every message:updated.
    expect(parseChatMessage({ id: 'm', createdAt: 'not-a-date' }).createdAt.getTime()).toBe(0);
    expect(parseChatMessage({ id: 'm' }).createdAt.getTime()).toBe(0);
  });
});
