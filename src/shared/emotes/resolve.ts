/**
 * Resolves a chat comment plus its optional emote metadata into render
 * segments and TTS-safe text.
 *
 * Resolution priority (highest first):
 *   1. explicit shortcode metadata or a unique, validated protobuf index hit;
 *   2. the verified shortcode catalog;
 *   3. plain text — the original shortcode, never a fabricated image.
 *
 * The signer preserves `EmoteWithIndex.index` without choosing a unit. The UI
 * tries UTF-8, Unicode code point, and UTF-16 offsets, and uses the index only
 * when exactly one interpretation lands on a complete bracket token. It
 * never slices or rewrites the comment, so ambiguous offsets fall back to
 * shortcode/catalog matching and the original text stays intact.
 */

import {
  MAX_EMOTE_TOKEN_LENGTH,
  catalogEmoteById,
} from './catalog.ts';
import type { ChatSegment, LiveEmote } from './types.ts';

/** Upper bound on emotes considered for one event. */
export const MAX_EMOTES_PER_EVENT = 64;

/** Longest image URL that will be accepted. */
export const MAX_EMOTE_URL_LENGTH = 2048;
const MAX_EMOTE_ID_LENGTH = 128;

type NormalizedEmote = {
  id: string;
  shortcode?: string;
  imageUrl?: string;
  index?: number;
};

/**
 * `true` only for absolute HTTPS URLs. Rejects `javascript:`, `data:`,
 * `file:`, `http:`, and anything unparseable, so untrusted LIVE metadata can
 * never introduce a privileged or plaintext image source.
 */
export function isSafeEmoteImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url || url.length > MAX_EMOTE_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname.length > 0 && !parsed.username && !parsed.password;
}

/** Normalizes a `[...]` token, or `undefined` when it is not a valid shape. */
function normalizeShortcode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  if (token.length < 3 || token[0] !== '[' || token[token.length - 1] !== ']') return undefined;
  const inner = token.slice(1, -1);
  if (!inner || inner.length > MAX_EMOTE_TOKEN_LENGTH) return undefined;
  return token;
}

/**
 * Validates and indexes the event's emotes. Invalid entries are dropped, the
 * count is bounded, and unsafe image URLs are discarded rather than rejected
 * wholesale so a bad URL only costs the image, not the emote.
 */
export function normalizeEmotes(
  emotes: readonly LiveEmote[] | undefined,
): Map<string, NormalizedEmote> {
  const byToken = new Map<string, NormalizedEmote>();
  for (const entry of normalizeEmoteList(emotes)) {
    const keys = new Set<string>();
    if (entry.shortcode) keys.add(entry.shortcode.slice(1, -1).toLowerCase());
    // Some signer events have opaque numeric ids and no shortcode. The
    // catalog is the only authority for treating a bare id as a token name.
    const catalogEntry = catalogEmoteById(entry.id);
    if (catalogEntry) keys.add(catalogEntry.id);
    for (const key of keys) {
      const catalogShortcode = catalogEntry?.shortcode;
      const normalized = catalogShortcode
        ? { ...entry, shortcode: catalogShortcode }
        : entry;
      if (!byToken.has(key)) byToken.set(key, normalized);
    }
  }
  return byToken;
}

function normalizeEmoteList(emotes: readonly LiveEmote[] | undefined): NormalizedEmote[] {
  if (!emotes?.length) return [];
  const normalized: NormalizedEmote[] = [];
  for (const emote of emotes) {
    if (normalized.length >= MAX_EMOTES_PER_EVENT) break;
    if (!emote || typeof emote.id !== 'string') continue;
    const rawId = emote.id.trim();
    const shortcode = normalizeShortcode(emote.shortcode);
    const imageUrl = isSafeEmoteImageUrl(emote.imageUrl) ? emote.imageUrl.trim() : undefined;
    if (!rawId && !shortcode && !imageUrl) continue;
    if (rawId.length > MAX_EMOTE_ID_LENGTH) continue;
    normalized.push({
      id: rawId || shortcode?.slice(1, -1) || 'emote',
      shortcode,
      imageUrl,
      ...(Number.isInteger(emote.index) && (emote.index ?? -1) >= 0
        ? { index: emote.index }
        : {}),
    });
  }
  return normalized;
}

function possibleOffsets(comment: string, index: number): Set<number> {
  const offsets = new Set<number>();
  if (index <= comment.length) offsets.add(index); // UTF-16 code units.

  let codePointOffset = 0;
  let codePointCount = 0;
  let utf8Offset = 0;
  for (const character of comment) {
    if (codePointCount === index) offsets.add(codePointOffset);
    if (utf8Offset === index) offsets.add(codePointOffset);
    codePointOffset += character.length;
    utf8Offset += utf8ByteLength(character.codePointAt(0) ?? 0);
    codePointCount += 1;
  }
  if (codePointCount === index) offsets.add(codePointOffset);
  if (utf8Offset === index) offsets.add(codePointOffset);
  return offsets;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function bracketTokenAt(comment: string, offset: number): string | undefined {
  if (comment[offset] !== '[') return undefined;
  const close = comment.indexOf(']', offset + 1);
  if (close < 0) return undefined;
  return normalizeShortcode(comment.slice(offset, close + 1));
}

function indexMatches(
  comment: string,
  emotes: readonly NormalizedEmote[],
): Map<number, NormalizedEmote> {
  const byOffset = new Map<number, NormalizedEmote>();
  const ambiguous = new Set<number>();
  for (const emote of emotes) {
    if (emote.index === undefined) continue;
    const matches = [...possibleOffsets(comment, emote.index)].filter((offset) => {
      const token = bracketTokenAt(comment, offset);
      return Boolean(token && (!emote.shortcode || token.toLowerCase() === emote.shortcode.toLowerCase()));
    });
    if (matches.length !== 1) continue;
    const offset = matches[0];
    if (offset === undefined) continue;
    if (ambiguous.has(offset)) continue;
    const existing = byOffset.get(offset);
    if (existing && existing.id !== emote.id) {
      byOffset.delete(offset);
      ambiguous.add(offset);
      continue;
    }
    byOffset.set(offset, emote);
  }
  return byOffset;
}

function lookupEmote(
  inner: string,
  metadata: Map<string, NormalizedEmote>,
): NormalizedEmote | undefined {
  if (!inner || inner.length > MAX_EMOTE_TOKEN_LENGTH) return undefined;
  const key = inner.toLowerCase();
  const fromEvent = metadata.get(key);
  if (fromEvent) return fromEvent;
  const fromCatalog = catalogEmoteById(key);
  if (!fromCatalog) return undefined;
  return { id: fromCatalog.id, shortcode: fromCatalog.shortcode, imageUrl: fromCatalog.imageUrl };
}

/**
 * Splits a comment into text and emote segments. Unknown bracketed text
 * (`[debug]`, `[1,2,3]`) stays literal text, and adjacent text runs are
 * coalesced so the renderer does not create extra nodes.
 */
export function resolveChatSegments(
  comment: string,
  emotes?: readonly LiveEmote[],
): ChatSegment[] {
  const emoteList = normalizeEmoteList(emotes);
  if (!comment) {
    return emoteList.flatMap((emote) => {
      return [{
        type: 'emote' as const,
        id: emote.id,
        shortcode: emote.shortcode,
        imageUrl: emote.imageUrl,
        fallbackText: emote.shortcode ?? '',
      }];
    });
  }
  const metadata = normalizeEmotes(emotes);
  const byIndex = indexMatches(comment, emoteList);
  const segments: ChatSegment[] = [];
  const consumed = new Set<number>();
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer) {
      segments.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < comment.length) {
    const open = comment.indexOf('[', index);
    if (open === -1) {
      buffer += comment.slice(index);
      break;
    }
    buffer += comment.slice(index, open);
    const close = comment.indexOf(']', open + 1);
    if (close === -1) {
      buffer += comment.slice(open);
      break;
    }
    const token = comment.slice(open, close + 1);
    const match = byIndex.get(open) ?? lookupEmote(comment.slice(open + 1, close), metadata);
    if (match) {
      const occurrence = emoteList.findIndex((entry, i) => !consumed.has(i) && entry.id === match.id && entry.imageUrl === match.imageUrl);
      if (occurrence >= 0) consumed.add(occurrence);
      flush();
      segments.push({
        type: 'emote',
        id: match.id,
        shortcode: match.shortcode,
        imageUrl: match.imageUrl,
        fallbackText: token,
      });
    } else {
      buffer += token;
    }
    index = close + 1;
  }
  flush();
  // Raw protobuf positions are not guaranteed to identify textual tokens.
  // Preserve all text and show unmatched metadata in wire order afterwards.
  for (const [occurrence, emote] of emoteList.entries()) {
    if (consumed.has(occurrence)) continue;
    segments.push({ type: 'emote', id: emote.id, shortcode: emote.shortcode, imageUrl: emote.imageUrl, fallbackText: '' });
  }
  return segments;
}

/**
 * Flattens segments back to text for `title`/`aria-label`/search. Emotes
 * contribute their `fallbackText`, so the flattened form always contains the
 * original comment.
 */
export function segmentsToPlainText(segments: readonly ChatSegment[]): string {
  let out = '';
  for (const segment of segments) {
    out += segment.type === 'text' ? segment.value : segment.fallbackText;
  }
  return out;
}

/** `true` when at least one segment carries a usable image. */
export function hasRenderableEmote(segments: readonly ChatSegment[]): boolean {
  return segments.some((segment) => segment.type === 'emote' && Boolean(segment.imageUrl));
}
