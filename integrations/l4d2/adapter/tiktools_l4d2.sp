#pragma semicolon 1
#pragma newdecls required

#include <sourcemod>
#include <sdktools>
// REQUIRE_PLUGIN is defined by default: undef it so both game includes
// mark their natives optional. Missing game dependencies must fail
// individual tt_* commands with TT_ERR (NO_NATIVES), not prevent loading.
#if defined REQUIRE_PLUGIN
#undef REQUIRE_PLUGIN
#endif
#include <left4dhooks>
#include <spawn_infected_nolimit>

// ---------------------------------------------------------------------------
// TikTools L4D2 adapter (live-fire status: see integrations/l4d2/README.md
// gate table; tt_status/tt_spawn_common/tt_spawn_item verified in game).
//
// Console-safe RCON surface for the l4d2.interactive TikTools plugin.
// Upstream All4Dead rejects console callers (client == 0) in every spawn
// handler, so RCON cannot drive it; these RegServerCmd commands are
// console-only by construction and safe to invoke over RCON.
//
// Every command prints exactly one machine-readable line to the server
// console (captured in the RCON response):
//   TT_OK|<reqid>|key=value|...
//   TT_ERR|<reqid>|CODE|detail
//
// Dependencies (runtime, all optional-marked; missing natives fail commands
// with TT_ERR NO_NATIVES instead of crashing):
//   SourceMod 1.11+ / SDKTools (bundled)
//   Left4DHooks (L4D_GetHighestFlowSurvivor, L4D_GetRandomPZSpawnPosition)
//     https://github.com/SilvDev/Left4DHooks
//   spawn_infected_nolimit (NoLimit_CreateInfected)
//     https://github.com/fbef0102/L4D1_2-Plugins/tree/master/spawn_infected_nolimit
// No sv_cheats, no cheat-flag stripping, no client-side commands.
// ---------------------------------------------------------------------------

public Plugin myinfo =
{
	name = "TikTools L4D2 adapter",
	author = "TikTools",
	description = "Console-safe RCON spawn commands for the l4d2.interactive plugin",
	version = "0.1.1",
	url = "https://github.com/nglmercer/TikTools-app"
};

#define TT_MAX_REQID 32
#define TT_MAX_SEGMENT 96
#define TT_POS_TRIES 6

ConVar g_cvMaxCommon;
ConVar g_cvMaxSpecial;
ConVar g_cvMaxItem;
ConVar g_cvTankCooldown;
ConVar g_cvCmdCooldownMs;
ConVar g_cvMaxEntities;
ConVar g_cvDebug;

float g_lastCmdAt = 0.0;
float g_lastTankAt = -1000000.0;

public APLRes AskPluginLoad2(Handle myself, bool late, char[] error, int err_max)
{
	if (GetEngineVersion() != Engine_Left4Dead2)
	{
		strcopy(error, err_max, "TikTools L4D2 adapter only supports Left 4 Dead 2.");
		return APLRes_SilentFailure;
	}
	return APLRes_Success;
}

public void OnPluginStart()
{
	g_cvMaxCommon = CreateConVar("tt_max_common", "10", "Max common infected per tt_spawn_common call.", _, true, 1.0, true, 25.0);
	g_cvMaxSpecial = CreateConVar("tt_max_special", "8", "Max special infected per tt_spawn_infected call.", _, true, 1.0, true, 8.0);
	g_cvMaxItem = CreateConVar("tt_max_item", "5", "Max items per tt_spawn_item call.", _, true, 1.0, true, 5.0);
	g_cvTankCooldown = CreateConVar("tt_tank_cooldown_s", "120", "Seconds between successful tank spawns.", _, true, 0.0, true, 3600.0);
	g_cvCmdCooldownMs = CreateConVar("tt_cmd_cooldown_ms", "500", "Minimum milliseconds between spawn commands (tt_status is exempt).", _, true, 0.0, true, 60000.0);
	g_cvMaxEntities = CreateConVar("tt_max_entities", "1900", "Refuse spawns once the entity count reaches this.", _, true, 500.0, true, 2000.0);
	g_cvDebug = CreateConVar("tt_debug", "0", "Log each tt_* invocation to the server log.", _, true, 0.0, true, 1.0);
	AutoExecConfig(true, "tiktools_l4d2");

	RegServerCmd("tt_status", Cmd_Status, "TikTools health/state probe: tt_status <reqid>");
	RegServerCmd("tt_spawn_common", Cmd_SpawnCommon, "TikTools common horde: tt_spawn_common <reqid> <count>");
	RegServerCmd("tt_spawn_infected", Cmd_SpawnInfected, "TikTools special spawn: tt_spawn_infected <reqid> <class> <count>");
	RegServerCmd("tt_spawn_item", Cmd_SpawnItem, "TikTools item drop: tt_spawn_item <reqid> <item> <count>");
}

// ---------------------------------------------------------------- output ---

void TT_Ok(const char[] reqid, const char[] payload)
{
	PrintToServer("TT_OK|%s|%s", reqid, payload);
}

void TT_Err(const char[] reqid, const char[] code, const char[] detail)
{
	PrintToServer("TT_ERR|%s|%s|%s", reqid, code, detail);
}

// ------------------------------------------------------------- validation ---

bool ValidReqId(const char[] reqid)
{
	int len = strlen(reqid);
	if (len < 1 || len > TT_MAX_REQID)
	{
		return false;
	}
	for (int i = 0; i < len; i++)
	{
		int c = reqid[i];
		bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
			|| (c >= '0' && c <= '9') || c == '_' || c == '-';
		if (!ok)
		{
			return false;
		}
	}
	return true;
}

// Strict digits-only parse; StringToInt alone would accept "12abc" as 12.
bool ParseBoundedInt(const char[] text, int min, int max, int &value)
{
	int len = strlen(text);
	if (len < 1 || len > 6)
	{
		return false;
	}
	for (int i = 0; i < len; i++)
	{
		if (text[i] < '0' || text[i] > '9')
		{
			return false;
		}
	}
	value = StringToInt(text);
	return value >= min && value <= max;
}

// Replace anything outside a safe segment alphabet so echoed dynamic values
// (map names) can never break the line protocol.
void SanitizeSegment(const char[] input, char[] output, int maxlen)
{
	int len = strlen(input);
	int out = 0;
	for (int i = 0; i < len && out < maxlen - 1; i++)
	{
		int c = input[i];
		bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
			|| (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.';
		output[out++] = ok ? c : '_';
	}
	output[out] = '\0';
}

bool ReadReqId(char[] reqid, int maxlen)
{
	GetCmdArg(1, reqid, maxlen);
	if (!ValidReqId(reqid))
	{
		// The reqid itself is unusable; still emit a parseable line.
		PrintToServer("TT_ERR|-|BAD_REQID|reqid must match [A-Za-z0-9_-]{1,32}");
		return false;
	}
	return true;
}

bool NativesAvailable(const char[] reqid)
{
	bool positions = GetFeatureStatus(FeatureType_Native, "L4D_GetRandomPZSpawnPosition") == FeatureStatus_Available;
	bool flow = GetFeatureStatus(FeatureType_Native, "L4D_GetHighestFlowSurvivor") == FeatureStatus_Available;
	bool nolimit = GetFeatureStatus(FeatureType_Native, "NoLimit_CreateInfected") == FeatureStatus_Available;
	if (!positions || !flow || !nolimit)
	{
		char detail[TT_MAX_SEGMENT];
		Format(detail, sizeof(detail), "positions=%d flow=%d nolimit=%d", positions, flow, nolimit);
		TT_Err(reqid, "NO_NATIVES", detail);
		return false;
	}
	return true;
}

bool GlobalCooldownOk(const char[] reqid)
{
	// Engine time, not game time: cooldowns must keep working even if the
	// server hibernates (empty server with default cvars freezes game time).
	float window = float(g_cvCmdCooldownMs.IntValue) / 1000.0;
	float elapsed = GetEngineTime() - g_lastCmdAt;
	if (elapsed < window)
	{
		char detail[TT_MAX_SEGMENT];
		Format(detail, sizeof(detail), "retry_in_ms=%d", RoundToNearest((window - elapsed) * 1000.0));
		TT_Err(reqid, "COOLDOWN", detail);
		return false;
	}
	g_lastCmdAt = GetEngineTime();
	return true;
}

bool EntityBudgetOk(const char[] reqid)
{
	if (GetEntityCount() >= g_cvMaxEntities.IntValue)
	{
		char detail[TT_MAX_SEGMENT];
		Format(detail, sizeof(detail), "entities=%d max=%d", GetEntityCount(), g_cvMaxEntities.IntValue);
		TT_Err(reqid, "ENTITY_CAP", detail);
		return false;
	}
	return true;
}

void DebugLog(const char[] line)
{
	if (g_cvDebug.BoolValue)
	{
		LogMessage("[tiktools_l4d2] %s", line);
	}
}

// ------------------------------------------------------------------ state ---

int AliveTeamCount(int team)
{
	int count = 0;
	for (int client = 1; client <= MaxClients; client++)
	{
		if (IsClientInGame(client) && !IsClientSourceTV(client) && GetClientTeam(client) == team && IsPlayerAlive(client))
		{
			count++;
		}
	}
	return count;
}

int EntityClassCount(const char[] classname)
{
	int count = 0;
	int ent = -1;
	while ((ent = FindEntityByClassname(ent, classname)) != -1)
	{
		count++;
	}
	return count;
}

// Highest-flow survivor, falling back to any alive survivor (bots included);
// 0 when nobody is alive to anchor a spawn.
int AnchorSurvivor()
{
	int anchor = L4D_GetHighestFlowSurvivor();
	if (anchor >= 1 && anchor <= MaxClients && IsClientInGame(anchor) && IsPlayerAlive(anchor))
	{
		return anchor;
	}
	for (int client = 1; client <= MaxClients; client++)
	{
		if (IsClientInGame(client) && GetClientTeam(client) == 2 && IsPlayerAlive(client))
		{
			return client;
		}
	}
	return 0;
}

// Trace filter for fallback positioning: ignore players, hit the world.
public bool TraceNoPlayers(int entity, int contentsMask)
{
	return entity > MaxClients;
}

// Last-resort spawn position when the director has no spawn areas ready
// (empty/hibernating server: L4D_GetRandomPZSpawnPosition returns false).
// Drops a point ~160 units in front of the anchor survivor onto the ground.
bool FallbackSpawnPos(int anchor, float pos[3])
{
	float origin[3];
	float angles[3];
	float fwd[3];
	GetClientAbsOrigin(anchor, origin);
	GetClientAbsAngles(anchor, angles);
	GetAngleVectors(angles, fwd, NULL_VECTOR, NULL_VECTOR);
	float start[3];
	float end[3];
	start[0] = origin[0] + fwd[0] * 160.0;
	start[1] = origin[1] + fwd[1] * 160.0;
	start[2] = origin[2] + 80.0;
	end[0] = start[0];
	end[1] = start[1];
	end[2] = start[2] - 512.0;
	TR_TraceRayFilter(start, end, MASK_SOLID, RayType_EndPoint, TraceNoPlayers);
	if (!TR_DidHit())
	{
		return false;
	}
	TR_GetEndPosition(pos);
	pos[2] += 10.0;
	return true;
}

public Action Cmd_Status(int args)
{
	char reqid[TT_MAX_REQID + 1];
	if (args < 1 || !ReadReqId(reqid, sizeof(reqid)))
	{
		return Plugin_Handled;
	}
	char map[TT_MAX_SEGMENT];
	char cleanMap[TT_MAX_SEGMENT];
	GetCurrentMap(map, sizeof(map));
	SanitizeSegment(map, cleanMap, sizeof(cleanMap));
	bool positions = GetFeatureStatus(FeatureType_Native, "L4D_GetRandomPZSpawnPosition") == FeatureStatus_Available;
	bool flow = GetFeatureStatus(FeatureType_Native, "L4D_GetHighestFlowSurvivor") == FeatureStatus_Available;
	bool nolimit = GetFeatureStatus(FeatureType_Native, "NoLimit_CreateInfected") == FeatureStatus_Available;
	// Raw flow-anchor reading (-1 when the native is missing): distinguishes
	// "Left4DHooks flow data is empty" from "Left4DHooks is absent".
	// gametime vs engtime deltas across two probes reveal hibernation
	// (frozen game time while engine time advances).
	int rawAnchor = -1;
	if (flow)
	{
		rawAnchor = L4D_GetHighestFlowSurvivor();
	}
	char payload[320];
	Format(payload, sizeof(payload),
		"adapter=0.1.1|map=%s|survivors=%d|specials=%d|commons=%d|witches=%d|entities=%d|entities_max=%d|positions=%d|flow=%d|nolimit=%d|anchor=%d|gametime=%d|engtime=%d",
		cleanMap, AliveTeamCount(2), AliveTeamCount(3),
		EntityClassCount("infected"), EntityClassCount("witch"), GetEntityCount(), GetMaxEntities(),
		positions, flow, nolimit,
		rawAnchor, RoundToNearest(GetGameTime()), RoundToNearest(GetEngineTime()));
	TT_Ok(reqid, payload);
	return Plugin_Handled;
}

// ----------------------------------------------------------------- common ---

public Action Cmd_SpawnCommon(int args)
{
	char reqid[TT_MAX_REQID + 1];
	if (args < 2 || !ReadReqId(reqid, sizeof(reqid)))
	{
		return Plugin_Handled;
	}
	char countText[16];
	GetCmdArg(2, countText, sizeof(countText));
	int count = 0;
	if (!ParseBoundedInt(countText, 1, g_cvMaxCommon.IntValue, count))
	{
		char detail[TT_MAX_SEGMENT];
		Format(detail, sizeof(detail), "max=%d", g_cvMaxCommon.IntValue);
		TT_Err(reqid, "COMMON_CAP", detail);
		return Plugin_Handled;
	}
	if (!GlobalCooldownOk(reqid) || !NativesAvailable(reqid) || !EntityBudgetOk(reqid))
	{
		return Plugin_Handled;
	}
	int anchor = AnchorSurvivor();
	if (anchor == 0)
	{
		TT_Err(reqid, "NO_SURVIVOR", "no alive survivor to anchor the horde");
		return Plugin_Handled;
	}
	float origin[3];
	GetClientAbsOrigin(anchor, origin);
	int spawned = 0;
	for (int i = 0; i < count; i++)
	{
		if (GetEntityCount() >= g_cvMaxEntities.IntValue)
		{
			break;
		}
		int zombie = CreateEntityByName("infected");
		if (zombie == -1)
		{
			break;
		}
		// Same wake-up sequence battle-tested upstream: schedule the first
		// think a few ticks out, then spawn/activate/teleport.
		int ticktime = RoundToNearest(GetGameTime() / GetTickInterval()) + 5;
		SetEntProp(zombie, Prop_Data, "m_nNextThinkTick", ticktime);
		DispatchSpawn(zombie);
		ActivateEntity(zombie);
		float pos[3];
		pos[0] = origin[0] + ((i % 2 == 0) ? 90.0 : -90.0) + float(i / 2) * 12.0;
		pos[1] = origin[1] + ((i % 4 < 2) ? 70.0 : -70.0);
		pos[2] = origin[2] + 12.0;
		TeleportEntity(zombie, pos, NULL_VECTOR, NULL_VECTOR);
		if (IsValidEntity(zombie))
		{
			spawned++;
		}
	}
	char log[TT_MAX_SEGMENT];
	Format(log, sizeof(log), "%s common requested=%d spawned=%d", reqid, count, spawned);
	DebugLog(log);
	LogMessage("[tiktools_l4d2] %s", log);
	if (spawned == 0)
	{
		TT_Err(reqid, "SPAWN_FAILED", "no common infected spawned");
		return Plugin_Handled;
	}
	char payload[TT_MAX_SEGMENT];
	Format(payload, sizeof(payload), "spawned=%d|requested=%d", spawned, count);
	TT_Ok(reqid, payload);
	return Plugin_Handled;
}

// ---------------------------------------------------------------- special ---

// ZombieClass values for L4D_GetRandomPZSpawnPosition (1..6 documented in
// left4dhooks.inc; 7/8 follow upstream All4Dead usage for witch/tank).
int ClassNumber(const char[] class)
{
	if (StrEqual(class, "smoker")) return 1;
	if (StrEqual(class, "boomer")) return 2;
	if (StrEqual(class, "hunter")) return 3;
	if (StrEqual(class, "spitter")) return 4;
	if (StrEqual(class, "jockey")) return 5;
	if (StrEqual(class, "charger")) return 6;
	if (StrEqual(class, "witch")) return 7;
	if (StrEqual(class, "tank")) return 8;
	return 0;
}

public Action Cmd_SpawnInfected(int args)
{
	char reqid[TT_MAX_REQID + 1];
	if (args < 3 || !ReadReqId(reqid, sizeof(reqid)))
	{
		return Plugin_Handled;
	}
	char class[16];
	GetCmdArg(2, class, sizeof(class));
	int classnum = ClassNumber(class);
	if (classnum == 0)
	{
		TT_Err(reqid, "BAD_CLASS", "tank witch smoker boomer hunter spitter jockey charger");
		return Plugin_Handled;
	}
	char countText[16];
	GetCmdArg(3, countText, sizeof(countText));
	int count = 0;
	if (!ParseBoundedInt(countText, 1, g_cvMaxSpecial.IntValue, count))
	{
		char detail[TT_MAX_SEGMENT];
		Format(detail, sizeof(detail), "max=%d", g_cvMaxSpecial.IntValue);
		TT_Err(reqid, "SPECIAL_CAP", detail);
		return Plugin_Handled;
	}
	if (classnum == 8)
	{
		if (count != 1)
		{
			TT_Err(reqid, "TANK_CAP", "tank count is always 1");
			return Plugin_Handled;
		}
		float since = GetEngineTime() - g_lastTankAt;
		if (since < float(g_cvTankCooldown.IntValue))
		{
			char detail[TT_MAX_SEGMENT];
			Format(detail, sizeof(detail), "retry_in_s=%d", RoundToNearest(float(g_cvTankCooldown.IntValue) - since));
			TT_Err(reqid, "TANK_COOLDOWN", detail);
			return Plugin_Handled;
		}
	}
	if (!GlobalCooldownOk(reqid) || !NativesAvailable(reqid) || !EntityBudgetOk(reqid))
	{
		return Plugin_Handled;
	}
	int anchor = AnchorSurvivor();
	if (anchor == 0)
	{
		TT_Err(reqid, "NO_SURVIVOR", "no alive survivor to anchor the spawn");
		return Plugin_Handled;
	}
	int spawned = 0;
	int pos_ok = 0;
	int fb_ok = 0;
	for (int i = 0; i < count; i++)
	{
		if (GetEntityCount() >= g_cvMaxEntities.IntValue)
		{
			break;
		}
		float pos[3];
		if (L4D_GetRandomPZSpawnPosition(anchor, classnum, TT_POS_TRIES, pos)
			|| L4D_GetRandomPZSpawnPosition(0, classnum, TT_POS_TRIES, pos))
		{
			pos_ok++;
		}
		else if (FallbackSpawnPos(anchor, pos))
		{
			// Director positioning unavailable (hibernating/empty server);
			// spawn near the anchor instead of failing the whole request.
			// Reported honestly via the fallback= field below.
			fb_ok++;
		}
		else
		{
			continue;
		}
		// Per the spawn_infected_nolimit docs, -1 means failure; anything
		// above 0 is the spawned client/entity index. VERIFY in game: witch
		// returns an entity index, player-bots return client indices.
		int result = NoLimit_CreateInfected(class, pos, NULL_VECTOR);
		if (result > 0)
		{
			spawned++;
		}
	}
	if (classnum == 8 && spawned > 0)
	{
		g_lastTankAt = GetEngineTime();
	}
	char log[TT_MAX_SEGMENT];
	Format(log, sizeof(log), "%s special class=%s requested=%d pos_ok=%d fb_ok=%d spawned=%d", reqid, class, count, pos_ok, fb_ok, spawned);
	DebugLog(log);
	LogMessage("[tiktools_l4d2] %s", log);
	if (spawned == 0)
	{
		char detail[TT_MAX_SEGMENT];
		Format(detail, sizeof(detail), "pos_ok=%d fb_ok=%d requested=%d", pos_ok, fb_ok, count);
		TT_Err(reqid, "SPAWN_FAILED", detail);
		return Plugin_Handled;
	}
	char payload[TT_MAX_SEGMENT];
	Format(payload, sizeof(payload), "class=%s|spawned=%d|requested=%d|fallback=%d", class, spawned, count, fb_ok);
	TT_Ok(reqid, payload);
	return Plugin_Handled;
}

// ------------------------------------------------------------------- item ---

bool ItemEntity(const char[] item, char[] entity, int maxlen)
{
	if (StrEqual(item, "first_aid_kit")) strcopy(entity, maxlen, "weapon_first_aid_kit");
	else if (StrEqual(item, "pain_pills")) strcopy(entity, maxlen, "weapon_pain_pills");
	else if (StrEqual(item, "adrenaline")) strcopy(entity, maxlen, "weapon_adrenaline");
	else if (StrEqual(item, "pipe_bomb")) strcopy(entity, maxlen, "weapon_pipe_bomb");
	else if (StrEqual(item, "molotov")) strcopy(entity, maxlen, "weapon_molotov");
	else if (StrEqual(item, "defibrillator")) strcopy(entity, maxlen, "weapon_defibrillator");
	else return false;
	return true;
}

public Action Cmd_SpawnItem(int args)
{
	char reqid[TT_MAX_REQID + 1];
	if (args < 3 || !ReadReqId(reqid, sizeof(reqid)))
	{
		return Plugin_Handled;
	}
	char item[32];
	GetCmdArg(2, item, sizeof(item));
	char entity[32];
	if (!ItemEntity(item, entity, sizeof(entity)))
	{
		TT_Err(reqid, "BAD_ITEM", "first_aid_kit pain_pills adrenaline pipe_bomb molotov defibrillator");
		return Plugin_Handled;
	}
	char countText[16];
	GetCmdArg(3, countText, sizeof(countText));
	int count = 0;
	if (!ParseBoundedInt(countText, 1, g_cvMaxItem.IntValue, count))
	{
		char detail[TT_MAX_SEGMENT];
		Format(detail, sizeof(detail), "max=%d", g_cvMaxItem.IntValue);
		TT_Err(reqid, "ITEM_CAP", detail);
		return Plugin_Handled;
	}
	// Items spawn as world entities (upstream uses a client-only `give`,
	// unusable from the console), so only the flow native is required.
	bool flow = GetFeatureStatus(FeatureType_Native, "L4D_GetHighestFlowSurvivor") == FeatureStatus_Available;
	if (!flow)
	{
		TT_Err(reqid, "NO_NATIVES", "positions=1 flow=0 nolimit=1");
		return Plugin_Handled;
	}
	if (!GlobalCooldownOk(reqid) || !EntityBudgetOk(reqid))
	{
		return Plugin_Handled;
	}
	int anchor = AnchorSurvivor();
	if (anchor == 0)
	{
		TT_Err(reqid, "NO_SURVIVOR", "no alive survivor to anchor the drop");
		return Plugin_Handled;
	}
	float origin[3];
	GetClientAbsOrigin(anchor, origin);
	int spawned = 0;
	for (int i = 0; i < count; i++)
	{
		if (GetEntityCount() >= g_cvMaxEntities.IntValue)
		{
			break;
		}
		int pickup = CreateEntityByName(entity);
		if (pickup == -1)
		{
			break;
		}
		DispatchSpawn(pickup);
		float pos[3];
		pos[0] = origin[0] + ((i % 2 == 0) ? 40.0 : -40.0);
		pos[1] = origin[1] + ((i % 4 < 2) ? 40.0 : -40.0);
		pos[2] = origin[2] + 24.0;
		TeleportEntity(pickup, pos, NULL_VECTOR, NULL_VECTOR);
		if (IsValidEntity(pickup))
		{
			spawned++;
		}
	}
	char log[TT_MAX_SEGMENT];
	Format(log, sizeof(log), "%s item=%s requested=%d spawned=%d", reqid, item, count, spawned);
	DebugLog(log);
	LogMessage("[tiktools_l4d2] %s", log);
	if (spawned == 0)
	{
		TT_Err(reqid, "SPAWN_FAILED", "no item spawned");
		return Plugin_Handled;
	}
	char payload[TT_MAX_SEGMENT];
	Format(payload, sizeof(payload), "item=%s|spawned=%d|requested=%d", item, spawned, count);
	TT_Ok(reqid, payload);
	return Plugin_Handled;
}
