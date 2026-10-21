/**
 * Reactions on messages, as the visitor sees them — a port of the visitor's
 * half of `packages/shared/src/reactions.ts` and the widget's
 * `lib/reactions.ts`, so the web widget, the Flutter SDK and this one show
 * and take the same reactions.
 *
 * One reaction per person per message, the way WhatsApp, Messenger and
 * iMessage work: picking another emoji replaces yours, picking the same one
 * takes it back.
 *
 * The server sends the visitor's view only: on the team's messages the
 * visitor's own reaction, on the visitor's messages the team's — never a
 * colleague's reaction to a colleague, and never an agent's id or name. It
 * arrives on history, on `message:new` / `message:updated`, and live as
 * `message:reactions` with the message's whole list after the change.
 *
 * A reaction is not a message: it moves no unread count and plays no chime.
 */
import type { ChatMessage } from './chat-message';

/** The quick row, in this order, on every client. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** Who reacted: the visitor themselves, or someone on the team. */
export type ReactionBy = 'agent' | 'customer';

/** One reaction on a message, as the visitor may see it. */
export interface MessageReaction {
  emoji: string;
  by: ReactionBy;
}

/** The longest emoji the server accepts (UTF-16 units) — a flag of a region is 14. */
export const REACTION_EMOJI_MAX_LENGTH = 32;

/**
 * A wire list read defensively: well-formed entries only.
 *
 * `undefined` when the wire said nothing at all — an older server, or a
 * partial row — which is NOT the same as an empty list: a message whose last
 * reaction was taken back arrives as `[]`, while a row without the field
 * leaves the reactions on screen as they were.
 */
export function parseReactions(raw: unknown): MessageReaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MessageReaction[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.emoji !== 'string' || r.emoji.length === 0) continue;
    if (r.emoji.length > REACTION_EMOJI_MAX_LENGTH) continue;
    if (r.by !== 'agent' && r.by !== 'customer') continue;
    out.push({ emoji: r.emoji, by: r.by });
  }
  return out;
}

/** A message's reactions; none when the server sent none. */
export function reactionsOf(m: Pick<ChatMessage, 'reactions'>): readonly MessageReaction[] {
  return m.reactions ?? [];
}

const VS16 = /️/g;

/** The same emoji, with or without the emoji-presentation selector (❤ and ❤️). */
export function sameEmoji(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null || a.length === 0 || b.length === 0) return false;
  return a.replace(VS16, '') === b.replace(VS16, '');
}

/** The visitor's own reaction on a message, if any. */
export function myReaction(m: Pick<ChatMessage, 'reactions'>): string | null {
  return reactionsOf(m).find((r) => r.by === 'customer')?.emoji ?? null;
}

/** What a tap on `emoji` means: theirs already → take it back (`null`), else set it. */
export function toggledReaction(m: Pick<ChatMessage, 'reactions'>, emoji: string): string | null {
  return sameEmoji(myReaction(m), emoji) ? null : emoji;
}

/**
 * Whether the visitor may react to this message: the team's messages — an
 * agent's, the assistant's, an automated line's — once the server has them.
 * Not their own, and not a system notice. (An automated line — the greeting —
 * reaches the SDK as `unknown`: the server sends it as `AUTOMATED`, a sender
 * `SenderType` does not name. The server takes a reaction to it.)
 */
export function canReactTo(m: Pick<ChatMessage, 'senderType' | 'id'>): boolean {
  if (m.senderType === 'customer' || m.senderType === 'system') return false;
  return m.id.length > 0 && !m.id.startsWith('tmp-');
}

/** The list with the visitor's reaction set to `emoji`, or taken back (`null`); the team's stay. */
export function withMyReaction(
  list: readonly MessageReaction[] | undefined,
  emoji: string | null,
): MessageReaction[] {
  const others = (list ?? []).filter((r) => r.by !== 'customer');
  return emoji != null ? [...others, { emoji, by: 'customer' }] : others;
}

/** One chip under a bubble. */
export interface ReactionGroup {
  /** The emoji as first used (❤ and ❤️ count as one). */
  emoji: string;
  count: number;
  /** The visitor's own reaction is in it. */
  mine: boolean;
}

/** Chips under a bubble: one per emoji, in the order they were first used. */
export function groupReactions(list: readonly MessageReaction[]): ReactionGroup[] {
  const groups: ReactionGroup[] = [];
  for (const r of list) {
    let group = groups.find((g) => sameEmoji(g.emoji, r.emoji));
    if (group == null) {
      group = { emoji: r.emoji, count: 0, mine: false };
      groups.push(group);
    }
    group.count++;
    if (r.by === 'customer') group.mine = true;
  }
  return groups;
}

/** Two lists say the same thing (order counts: it is the order of reacting). */
export function sameReactions(
  a: readonly MessageReaction[] | undefined,
  b: readonly MessageReaction[] | undefined,
): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  return x.every((r, i) => r.emoji === y[i]!.emoji && r.by === y[i]!.by);
}
