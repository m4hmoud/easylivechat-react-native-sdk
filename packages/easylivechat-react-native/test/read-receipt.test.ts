import { describe, expect, it } from 'vitest';

import { type ChatMessage, optimisticMessage, parseChatMessage, receiptFor } from '../src/models/chat-message';

/**
 * Port of `read_receipt_test.dart` — the `receiptFor` truth table.
 *
 * There is deliberately NO `delivered` state: the other channels get that from
 * a provider webhook, but a message to an SDK visitor is stored by our own
 * server, so "stored" and "delivered" are the same instant and a third tick
 * would be a distinction the visitor could never observe.
 */

const T0 = new Date('2026-09-01T10:00:00.000Z');
const T1 = new Date('2026-09-01T10:01:00.000Z');

function customer(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    ...parseChatMessage({
      id: 'm1',
      conversationId: 'c1',
      body: 'hello',
      senderType: 'CUSTOMER',
      createdAt: T0.toISOString(),
    }),
    ...overrides,
  };
}

describe('receiptFor', () => {
  it('returns null for anything the visitor did not write', () => {
    const agent = parseChatMessage({ id: 'm', senderType: 'AGENT', createdAt: T0.toISOString() });
    const system = parseChatMessage({ id: 'm', senderType: 'SYSTEM', createdAt: T0.toISOString() });
    expect(receiptFor(agent, T1)).toBeNull();
    expect(receiptFor(system, T1)).toBeNull();
  });

  it('reports failed before anything else', () => {
    expect(receiptFor(customer({ failed: true, readByAgent: true }), T1)).toBe('failed');
    expect(receiptFor(customer({ deliveryStatus: 'failed' }), T1)).toBe('failed');
  });

  it('reports pending for an unacknowledged local send', () => {
    const optimistic = optimisticMessage({
      tempId: 'tmp-1',
      conversationId: 'c1',
      body: 'hi',
      createdAt: T0,
    });
    expect(receiptFor(optimistic, null)).toBe('pending');
    expect(receiptFor(customer({ deliveryStatus: 'pending' }), T1)).toBe('pending');
  });

  it('reports read from the per-message flag', () => {
    expect(receiptFor(customer({ readByAgent: true }), null)).toBe('read');
    expect(receiptFor(customer({ deliveryStatus: 'read' }), null)).toBe('read');
  });

  it('reports read from the conversation watermark', () => {
    expect(receiptFor(customer(), T1)).toBe('read');
    // Sent AFTER the watermark: not read yet.
    expect(receiptFor(customer({ createdAt: T1 }), T0)).toBe('sent');
    // Exactly at the watermark counts as read.
    expect(receiptFor(customer({ createdAt: T0 }), T0)).toBe('read');
  });

  it('NEVER applies the watermark to a tmp- row', () => {
    // Its timestamp came from the DEVICE clock while the watermark comes from
    // the SERVER's; comparing the two across even a few seconds of skew shows
    // a message as read that no one has opened.
    const ackedButIdless: ChatMessage = {
      ...customer({ id: 'tmp-abc', createdAt: T0 }),
      isOptimistic: false,
      deliveryStatus: 'sent',
    };
    expect(receiptFor(ackedButIdless, T1)).toBe('sent');
    // Once the server row replaces it, both sides are server time.
    expect(receiptFor({ ...ackedButIdless, id: 'm-server' }, T1)).toBe('read');
  });

  it('falls back to sent', () => {
    expect(receiptFor(customer(), null)).toBe('sent');
  });
});
