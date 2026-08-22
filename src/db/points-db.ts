import { Database } from 'sqlite-napi';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Typed row shapes that mirror the SQLite column names returned by sqlite-napi.
// These are internal to this module; callers always receive the public interfaces.
// ---------------------------------------------------------------------------

/** Shape of a row from `points_config`. */
interface ConfigRow {
  id: number;
  currency_name: string;
  points_per_coin: number;
  points_per_coin_enabled: number;
  points_per_share: number;
  points_per_share_enabled: number;
  points_per_chat: number;
  points_per_chat_enabled: number;
  points_per_like: number;
  points_per_like_enabled: number;
  points_per_follow: number;
  points_per_follow_enabled: number;
  points_per_join: number;
  points_per_join_enabled: number;
  sub_bonus_multiplier: number;
  points_per_level: number;
  updated_at: number;
}

/** Shape of a row from `viewers`. */
interface ViewerRow {
  unique_id: string;
  user_id: string | null;
  nickname: string | null;
  avatar_url: string | null;
  points: number;
  level: number;
  is_subscriber: number;
  total_chats: number;
  total_coins: number;
  total_likes: number;
  total_shares: number;
  first_seen: number;
  last_seen: number;
}

/** Shape of a row from `SELECT COUNT(*) …` */
interface CountRow {
  count: number;
}

export interface PointsConfig {
  currencyName: string;
  pointsPerCoin: number;
  pointsPerCoinEnabled: boolean;
  pointsPerShare: number;
  pointsPerShareEnabled: boolean;
  pointsPerChat: number;
  pointsPerChatEnabled: boolean;
  pointsPerLike: number;
  pointsPerLikeEnabled: boolean;
  pointsPerFollow: number;
  pointsPerFollowEnabled: boolean;
  pointsPerJoin: number;
  pointsPerJoinEnabled: boolean;
  subBonusMultiplier: number;
  pointsPerLevel: number;
}

export interface ViewerRecord {
  uniqueId: string;
  userId?: string;
  nickname?: string;
  avatarUrl?: string;
  points: number;
  level: number;
  isSubscriber: boolean;
  totalChats: number;
  totalCoins: number;
  totalLikes: number;
  totalShares: number;
  firstSeen: number;
  lastSeen: number;
}

export interface PointAwardResult {
  uniqueId: string;
  delta: number;
  totalPoints: number;
  level: number;
  currencyName: string;
}

export class PointsDatabase {
  private db: Database;

  constructor(dbPath?: string) {
    const defaultPath = join(process.cwd(), 'data', 'tiktok-points.db');
    const resolvedPath = dbPath || defaultPath;
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.initTables();
  }

  private initTables(): void {
    // Config table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS points_config (
        id INTEGER PRIMARY KEY,
        currency_name TEXT DEFAULT 'Points',
        points_per_coin REAL DEFAULT 1.0,
        points_per_coin_enabled INTEGER DEFAULT 1,
        points_per_share REAL DEFAULT 3.0,
        points_per_share_enabled INTEGER DEFAULT 1,
        points_per_chat REAL DEFAULT 1.0,
        points_per_chat_enabled INTEGER DEFAULT 1,
        points_per_like REAL DEFAULT 0.1,
        points_per_like_enabled INTEGER DEFAULT 1,
        points_per_follow REAL DEFAULT 5.0,
        points_per_follow_enabled INTEGER DEFAULT 1,
        points_per_join REAL DEFAULT 0.5,
        points_per_join_enabled INTEGER DEFAULT 0,
        sub_bonus_multiplier REAL DEFAULT 0.0,
        points_per_level INTEGER DEFAULT 100,
        updated_at INTEGER DEFAULT 0
      )
    `);

    // Insert default config if empty
    const countRow = this.db.query('SELECT COUNT(*) as count FROM points_config').get([]) as { count: number } | null;
    if (!countRow || countRow.count === 0) {
      this.db.run(`
        INSERT INTO points_config (
          id, currency_name, points_per_coin, points_per_coin_enabled,
          points_per_share, points_per_share_enabled,
          points_per_chat, points_per_chat_enabled,
          points_per_like, points_per_like_enabled,
          points_per_follow, points_per_follow_enabled,
          points_per_join, points_per_join_enabled,
          sub_bonus_multiplier, points_per_level, updated_at
        ) VALUES (
          1, 'Points', 1.0, 1,
          3.0, 1,
          1.0, 1,
          0.1, 1,
          5.0, 1,
          0.5, 0,
          0.0, 100, ${Date.now()}
        )
      `);
    }

    // Viewers table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS viewers (
        unique_id TEXT PRIMARY KEY,
        user_id TEXT,
        nickname TEXT,
        avatar_url TEXT,
        points REAL DEFAULT 0,
        level INTEGER DEFAULT 1,
        is_subscriber INTEGER DEFAULT 0,
        total_chats INTEGER DEFAULT 0,
        total_coins INTEGER DEFAULT 0,
        total_likes INTEGER DEFAULT 0,
        total_shares INTEGER DEFAULT 0,
        first_seen INTEGER,
        last_seen INTEGER
      )
    `);

    // Points Transactions history table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS points_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unique_id TEXT,
        amount REAL,
        reason TEXT,
        metadata TEXT,
        created_at INTEGER
      )
    `);
  }

  public getConfig(): PointsConfig {
    const row = this.db.query('SELECT * FROM points_config WHERE id = 1').get([]) as ConfigRow | null;
    if (!row) {
      return {
        currencyName: 'Points',
        pointsPerCoin: 1.0,
        pointsPerCoinEnabled: true,
        pointsPerShare: 3.0,
        pointsPerShareEnabled: true,
        pointsPerChat: 1.0,
        pointsPerChatEnabled: true,
        pointsPerLike: 0.1,
        pointsPerLikeEnabled: true,
        pointsPerFollow: 5.0,
        pointsPerFollowEnabled: true,
        pointsPerJoin: 0.5,
        pointsPerJoinEnabled: false,
        subBonusMultiplier: 0.0,
        pointsPerLevel: 100,
      };
    }

    return {
      currencyName: row.currency_name ?? 'Points',
      pointsPerCoin: Number(row.points_per_coin ?? 1.0),
      pointsPerCoinEnabled: Boolean(row.points_per_coin_enabled),
      pointsPerShare: Number(row.points_per_share ?? 3.0),
      pointsPerShareEnabled: Boolean(row.points_per_share_enabled),
      pointsPerChat: Number(row.points_per_chat ?? 1.0),
      pointsPerChatEnabled: Boolean(row.points_per_chat_enabled),
      pointsPerLike: Number(row.points_per_like ?? 0.1),
      pointsPerLikeEnabled: Boolean(row.points_per_like_enabled),
      pointsPerFollow: Number(row.points_per_follow ?? 5.0),
      pointsPerFollowEnabled: Boolean(row.points_per_follow_enabled),
      pointsPerJoin: Number(row.points_per_join ?? 0.5),
      pointsPerJoinEnabled: Boolean(row.points_per_join_enabled),
      subBonusMultiplier: Number(row.sub_bonus_multiplier ?? 0.0),
      pointsPerLevel: Number(row.points_per_level ?? 100),
    };
  }

  public updateConfig(config: Partial<PointsConfig>): PointsConfig {
    const current = this.getConfig();
    const updated: PointsConfig = { ...current, ...config };

    this.db.query(`
      UPDATE points_config SET
        currency_name = ?,
        points_per_coin = ?,
        points_per_coin_enabled = ?,
        points_per_share = ?,
        points_per_share_enabled = ?,
        points_per_chat = ?,
        points_per_chat_enabled = ?,
        points_per_like = ?,
        points_per_like_enabled = ?,
        points_per_follow = ?,
        points_per_follow_enabled = ?,
        points_per_join = ?,
        points_per_join_enabled = ?,
        sub_bonus_multiplier = ?,
        points_per_level = ?,
        updated_at = ?
      WHERE id = 1
    `).run([
      updated.currencyName,
      updated.pointsPerCoin,
      updated.pointsPerCoinEnabled ? 1 : 0,
      updated.pointsPerShare,
      updated.pointsPerShareEnabled ? 1 : 0,
      updated.pointsPerChat,
      updated.pointsPerChatEnabled ? 1 : 0,
      updated.pointsPerLike,
      updated.pointsPerLikeEnabled ? 1 : 0,
      updated.pointsPerFollow,
      updated.pointsPerFollowEnabled ? 1 : 0,
      updated.pointsPerJoin,
      updated.pointsPerJoinEnabled ? 1 : 0,
      updated.subBonusMultiplier,
      updated.pointsPerLevel,
      Date.now(),
    ]);

    return updated;
  }

  public getViewer(uniqueId: string): ViewerRecord | null {
    const cleanId = uniqueId.trim().replace(/^@/, '');
    const row = this.db.query('SELECT * FROM viewers WHERE unique_id = ?').get([cleanId]) as ViewerRow | null;
    if (!row) return null;

    return {
      uniqueId: row.unique_id,
      userId: row.user_id ?? undefined,
      nickname: row.nickname ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      points: Number(row.points ?? 0),
      level: Number(row.level ?? 1),
      isSubscriber: Boolean(row.is_subscriber),
      totalChats: Number(row.total_chats ?? 0),
      totalCoins: Number(row.total_coins ?? 0),
      totalLikes: Number(row.total_likes ?? 0),
      totalShares: Number(row.total_shares ?? 0),
      firstSeen: Number(row.first_seen ?? 0),
      lastSeen: Number(row.last_seen ?? 0),
    };
  }

  public awardPoints(
    uniqueId: string,
    action: 'chat' | 'gift' | 'like' | 'share' | 'follow' | 'join' | 'manual',
    options: {
      userId?: string;
      nickname?: string;
      avatarUrl?: string;
      count?: number;
      diamondCount?: number;
      isSubscriber?: boolean;
      customAmount?: number;
    } = {}
  ): PointAwardResult | null {
    const cleanId = uniqueId.trim().replace(/^@/, '');
    if (!cleanId) return null;

    const config = this.getConfig();
    let basePoints = 0;

    if (action === 'manual' && typeof options.customAmount === 'number') {
      basePoints = options.customAmount;
    } else if (action === 'chat' && config.pointsPerChatEnabled) {
      basePoints = config.pointsPerChat;
    } else if (action === 'gift' && config.pointsPerCoinEnabled) {
      const diamonds = options.diamondCount || options.count || 1;
      basePoints = diamonds * config.pointsPerCoin;
    } else if (action === 'like' && config.pointsPerLikeEnabled) {
      const likes = options.count || 1;
      basePoints = likes * config.pointsPerLike;
    } else if (action === 'share' && config.pointsPerShareEnabled) {
      basePoints = config.pointsPerShare;
    } else if (action === 'follow' && config.pointsPerFollowEnabled) {
      basePoints = config.pointsPerFollow;
    } else if (action === 'join' && config.pointsPerJoinEnabled) {
      basePoints = config.pointsPerJoin;
    }

    const now = Date.now();
    const existing = this.getViewer(cleanId);
    const isSub = options.isSubscriber ?? existing?.isSubscriber ?? false;

    // Apply subscriber bonus multiplier if applicable
    if (isSub && config.subBonusMultiplier > 0 && basePoints > 0) {
      basePoints += basePoints * (config.subBonusMultiplier / 100);
    }

    // Round to 2 decimal places
    const awarded = Math.round(basePoints * 100) / 100;
    const currentPoints = existing ? existing.points : 0;
    const newPoints = Math.max(0, Math.round((currentPoints + awarded) * 100) / 100);
    const pointsPerLvl = Math.max(10, config.pointsPerLevel);
    const newLevel = Math.floor(newPoints / pointsPerLvl) + 1;

    const chatInc = action === 'chat' ? 1 : 0;
    const coinInc = action === 'gift' ? (options.diamondCount || 1) : 0;
    const likeInc = action === 'like' ? (options.count || 1) : 0;
    const shareInc = action === 'share' ? 1 : 0;

    if (!existing) {
      this.db.query(`
        INSERT INTO viewers (
          unique_id, user_id, nickname, avatar_url, points, level,
          is_subscriber, total_chats, total_coins, total_likes, total_shares,
          first_seen, last_seen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run([
        cleanId,
        options.userId || null,
        options.nickname || cleanId,
        options.avatarUrl || null,
        newPoints,
        newLevel,
        isSub ? 1 : 0,
        chatInc,
        coinInc,
        likeInc,
        shareInc,
        now,
        now,
      ]);
    } else {
      this.db.query(`
        UPDATE viewers SET
          user_id = COALESCE(?, user_id),
          nickname = COALESCE(?, nickname),
          avatar_url = COALESCE(?, avatar_url),
          points = ?,
          level = ?,
          is_subscriber = ?,
          total_chats = total_chats + ?,
          total_coins = total_coins + ?,
          total_likes = total_likes + ?,
          total_shares = total_shares + ?,
          last_seen = ?
        WHERE unique_id = ?
      `).run([
        options.userId || null,
        options.nickname || null,
        options.avatarUrl || null,
        newPoints,
        newLevel,
        isSub ? 1 : 0,
        chatInc,
        coinInc,
        likeInc,
        shareInc,
        now,
        cleanId,
      ]);
    }

    if (awarded !== 0) {
      this.db.query(`
        INSERT INTO points_transactions (unique_id, amount, reason, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run([
        cleanId,
        awarded,
        action,
        JSON.stringify(options),
        now,
      ]);
    }

    return {
      uniqueId: cleanId,
      delta: awarded,
      totalPoints: newPoints,
      level: newLevel,
      currencyName: config.currencyName,
    };
  }

  public getLeaderboard(limit = 100): ViewerRecord[] {
    const rows = this.db.query(`
      SELECT * FROM viewers
      ORDER BY points DESC, total_coins DESC, total_chats DESC
      LIMIT ?
    `).all([limit]) as ViewerRow[];

    return rows.map((row) => ({
      uniqueId: row.unique_id,
      userId: row.user_id ?? undefined,
      nickname: row.nickname ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      points: Number(row.points ?? 0),
      level: Number(row.level ?? 1),
      isSubscriber: Boolean(row.is_subscriber),
      totalChats: Number(row.total_chats ?? 0),
      totalCoins: Number(row.total_coins ?? 0),
      totalLikes: Number(row.total_likes ?? 0),
      totalShares: Number(row.total_shares ?? 0),
      firstSeen: Number(row.first_seen ?? 0),
      lastSeen: Number(row.last_seen ?? 0),
    }));
  }

  public resetPoints(uniqueId?: string): void {
    if (uniqueId) {
      const clean = uniqueId.trim().replace(/^@/, '');
      this.db.query('UPDATE viewers SET points = 0, level = 1 WHERE unique_id = ?').run([clean]);
      this.db.query('INSERT INTO points_transactions (unique_id, amount, reason, created_at) VALUES (?, 0, ?, ?)')
        .run([clean, 'reset', Date.now()]);
    } else {
      this.db.query('UPDATE viewers SET points = 0, level = 1').run([]);
      this.db.query('DELETE FROM points_transactions').run([]);
    }
  }
}
