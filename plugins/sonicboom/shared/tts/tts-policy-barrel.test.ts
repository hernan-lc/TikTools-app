import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TtsDeduper } from './deduper.ts';
import { decideTts } from './eligibility.ts';
import { EMOTE_CATALOG, emoteById } from './emote-catalog.ts';
import { sanitizeTtsText } from './sanitizer.ts';
import { defaultTtsSettings } from './settings.ts';
import * as barrel from './tts-policy.ts';
import type {
  EmoteCatalogEntry,
  SpecialTtsUser,
  TtsAuthor,
  TtsAuthorRoles,
  TtsCommentDecision,
  TtsCommentMode,
  TtsDecision,
  TtsDeduperOptions,
  TtsEligibility,
  TtsEmoteSpeechMode,
  TtsLogEntry,
  TtsRequest,
  TtsSettings,
  TtsTextSanitizerSettings,
} from './tts-policy.ts';
import { chooseVoice } from './voice.ts';

/**
 * The compatibility barrel must keep exporting the exact pre-split
 * `tts-policy.ts` API plus the emote/sanitizer additions (39 values + 14
 * types). Value parity is checked at runtime below; every type import above is
 * referenced by `BarrelTypeParity`, so removing a type export fails
 * `bun x vue-tsc --noEmit`.
 */
export type BarrelTypeParity = {
  author: TtsAuthor;
  comment: TtsCommentDecision;
  decision: TtsDecision;
  deduperOptions: TtsDeduperOptions;
  eligibility: TtsEligibility;
  emoteEntry: EmoteCatalogEntry;
  emoteSpeechMode: TtsEmoteSpeechMode;
  log: TtsLogEntry;
  mode: TtsCommentMode;
  request: TtsRequest;
  roles: TtsAuthorRoles;
  sanitizerSettings: TtsTextSanitizerSettings;
  settings: TtsSettings;
  special: SpecialTtsUser;
};

const EXPECTED_VALUES = [
  'DEFAULT_TTS_BUDGET_MS',
  'EMOTE_CATALOG',
  'EMOTE_CATALOG_VERSION',
  'MAX_EMOTE_TOKEN_LENGTH',
  'MAX_TTS_BUDGET_MS',
  'PROVIDER_TTS_BUDGETS_MS',
  'TTS_LIMITS',
  'TTS_SPEED_PITCH_UNSUPPORTED',
  'TtsDeduper',
  'canAffordTts',
  'chooseVoice',
  'clampNumber',
  'classifyTtsOutcomeOrigin',
  'collapseTtsWhitespace',
  'decideTts',
  'defaultTtsSanitizerSettings',
  'defaultTtsSettings',
  'emoteById',
  'evaluateCommentFilter',
  'evaluateUserEligibility',
  'findSpecialUser',
  'firstAvailableVoice',
  'formatBudgetMs',
  'isBlankTtsText',
  'isEmojiGrapheme',
  'isKnownEmoteId',
  'isTtsWhitespace',
  'isUnwantedInvisible',
  'normalizeHandle',
  'parseTtsSettings',
  'sanitizeTtsSettings',
  'sanitizeTtsText',
  'serializeTtsSettings',
  'stripKnownEmotes',
  'stripUnicodeEmoji',
  'stripUnwantedInvisible',
  'ttsBudgetMs',
  'ttsFingerprint',
  'ttsSettingsKey',
];

const EXPECTED_TYPES = [
  'EmoteCatalogEntry',
  'SpecialTtsUser',
  'TtsAuthor',
  'TtsAuthorRoles',
  'TtsCommentDecision',
  'TtsCommentMode',
  'TtsDecision',
  'TtsDeduperOptions',
  'TtsEligibility',
  'TtsEmoteSpeechMode',
  'TtsLogEntry',
  'TtsRequest',
  'TtsSettings',
  'TtsTextSanitizerSettings',
];

/** Type names re-exported via `export type {…}` or inline `type X` items. */
function typeExportsOf(source: string): string[] {
  const names: string[] = [];
  for (const block of source.matchAll(/^export\s+(type\s+)?\{([^}]*)\}/gm)) {
    const wholeBlockIsType = (block[1] ?? '').trim() === 'type';
    for (const part of (block[2] ?? '').split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const isType = wholeBlockIsType || trimmed.startsWith('type ');
      if (!isType) continue;
      const name = trimmed.split(/\s+as\s+/).pop()?.replace(/^type\s+/, '').trim() ?? '';
      if (name) names.push(name);
    }
  }
  return names.sort();
}

test('barrel exports the exact pre-split value API', () => {
  expect(Object.keys(barrel).sort()).toEqual([...EXPECTED_VALUES].sort());
});

test('barrel re-exports the exact pre-split type API', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tts-policy.ts'), 'utf8');
  expect(typeExportsOf(source)).toEqual([...EXPECTED_TYPES].sort());
});

test('split-module exports are the same bindings (no barrel drift)', () => {
  expect(barrel.decideTts).toBe(decideTts);
  expect(barrel.defaultTtsSettings).toBe(defaultTtsSettings);
  expect(barrel.chooseVoice).toBe(chooseVoice);
  expect(barrel.TtsDeduper).toBe(TtsDeduper);
  expect(barrel.sanitizeTtsText).toBe(sanitizeTtsText);
  expect(barrel.EMOTE_CATALOG).toBe(EMOTE_CATALOG);
  expect(barrel.emoteById).toBe(emoteById);
});
