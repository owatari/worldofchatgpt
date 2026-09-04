import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ClassId, ClientMessage, CombatEvent, MonsterSnapshot, PlayerSnapshot, ServerMessage, Vec3 } from '@worldofchatgpt/shared';
import { clientMessageSchema } from '@worldofchatgpt/shared';
import {
  TRAINING_SLIME,
  applyDamage,
  applyHeal,
  calculateDamage,
  calculateHeal,
  canUseCooldown,
  getAbility,
  getClassAbilities,
  getClassDefinition,
  grantXp,
  isInRange,
  type AbilityDefinition,
  type Stats,
} from '@worldofchatgpt/game-core';
import { db } from '../database/index.js';
import { getCharacterForUser } from '../database/queries.js';
import { characters } from '../database/schema.js';

const TICK_MS = 50;
const ARENA_LIMIT = 14;
const PLAYER_SPAWN: Vec3 = { x: 0, y: 0, z: 8 };
const SLIME_SPAWN: Vec3 = { x: 0, y: 0, z: -3 };
const SLIME_ID = 'monster:training-slime';

interface RuntimePlayer {
  entityId: string;
  userId: string;
  characterId: string;
  socket: WebSocket;
  name: string;
  classId: ClassId;
  level: number;
  xp: number;
  stats: Stats;
  position: Vec3;
  rotation: number;
  hp: number;
  dead: boolean;
  inputX: number;
  inputZ: number;
  targetId: string | null;
  cooldowns: Map<string, number>;
}

interface RuntimeSlime {
  position: Vec3;
  rotation: number;
  hp: number;
  dead: boolean;
  state: 'IDLE' | 'CHASE' | 'ATTACK' | 'DEAD';
  targetId: string | null;
  attackReadyAt: number;
  respawnAt: number;
}

const slimeAttack: AbilityDefinition = {
  id: 'slime-basic',
  name: 'Slime Bash',
  kind: 'melee',
  damageType: 'physical',
  basePower: 4,
  range: TRAINING_SLIME.attackRange,
  cooldownMs: TRAINING_SLIME.attackCooldownMs,
  castTimeMs: 0,
  targetType: 'enemy',
};

export class GameWorld {
  private readonly players = new Map<string, RuntimePlayer>();
  private readonly slime: RuntimeSlime = {
    position: { ...SLIME_SPAWN },
    rotation: 0,
    hp: TRAINING_SLIME.stats.maxHp,
    dead: false,
    state: 'IDLE',
    targetId: null,
    attackReadyAt: 0,
    respawnAt: 0,
  };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly app: FastifyInstance) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(Date.now()), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async connect(socket: WebSocket, request: FastifyRequest): Promise<void> {
    try {
      const token = new URL(request.url, 'http://localhost').searchParams.get('token');
      if (!token) throw new Error('Missing token');
      const payload = this.app.jwt.verify<{ sub: string }>(token);
      const character = await getCharacterForUser(payload.sub);
      if (!character) throw new Error('Character required');

      const classId = character.classId as ClassId;
      const definition = getClassDefinition(classId);
      const entityId = `player:${character.id}`;
      const existing = this.players.get(entityId);
      if (existing) existing.socket.close(4001, 'Reconnected elsewhere');

      const player: RuntimePlayer = {
        entityId,
        userId: payload.sub,
        characterId: character.id,
        socket,
        name: character.name,
        classId,
        level: character.level,
        xp: character.xp,
        stats: definition.baseStats,
        position: { ...PLAYER_SPAWN },
        rotation: Math.PI,
        hp: definition.baseStats.maxHp,
        dead: false,
        inputX: 0,
        inputZ: 0,
        targetId: null,
        cooldowns: new Map(),
      };
      this.players.set(entityId, player);
      this.send(player, this.welcomeMessage(player));

      socket.on('message', (raw) => {
        void this.handleRawMessage(player, raw.toString());
      });
      socket.on('close', () => {
        if (this.players.get(entityId)?.socket === socket) this.players.delete(entityId);
      });
    } catch {
      socket.close(4003, 'Unauthorized');
    }
  }

  private async handleRawMessage(player: RuntimePlayer, raw: string): Promise<void> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return this.sendError(player, 'BAD_MESSAGE', 'Message must be valid JSON.');
    }
    const parsed = clientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) return this.sendError(player, 'BAD_MESSAGE', 'Invalid gameplay message.');
    await this.handleMessage(player, parsed.data);
  }

  private async handleMessage(player: RuntimePlayer, message: ClientMessage): Promise<void> {
    if (message.type === 'move') {
      if (player.dead) return;
      const length = Math.hypot(message.x, message.z);
      const scale = length > 1 ? 1 / length : 1;
      player.inputX = message.x * scale;
      player.inputZ = message.z * scale;
      return;
    }
    if (message.type === 'target') {
      player.targetId = message.targetId === SLIME_ID && !this.slime.dead ? SLIME_ID : null;
      return;
    }
    if (message.type === 'respawn') {
      if (!player.dead) return;
      player.dead = false;
      player.hp = player.stats.maxHp;
      player.position = { ...PLAYER_SPAWN };
      player.inputX = 0;
      player.inputZ = 0;
      return;
    }
    await this.cast(player, message.abilityId, message.targetId);
  }

  private async cast(player: RuntimePlayer, abilityId: string, targetId: string | null): Promise<void> {
    if (player.dead) return this.sendError(player, 'DEAD', 'You cannot cast while dead.');
    const ability = getAbility(player.classId, abilityId);
    if (!ability) return this.sendError(player, 'ABILITY', 'Unknown ability.');
    const now = Date.now();
    const readyAt = player.cooldowns.get(ability.id) ?? 0;
    if (!canUseCooldown(now, readyAt)) return this.sendError(player, 'COOLDOWN', 'Ability is on cooldown.');

    if (ability.targetType === 'self') {
      player.cooldowns.set(ability.id, now + ability.cooldownMs);
      const amount = calculateHeal(ability, player.stats);
      const before = player.hp;
      player.hp = applyHeal(player.hp, player.stats.maxHp, amount);
      const actual = player.hp - before;
      this.broadcastCombat({ kind: 'cast', sourceId: player.entityId, targetId: player.entityId, abilityId: ability.id, at: { ...player.position } });
      if (actual > 0) this.broadcastCombat({ kind: 'heal', sourceId: player.entityId, targetId: player.entityId, amount: actual, at: { ...player.position } });
      return;
    }

    const resolvedTarget = targetId ?? player.targetId;
    if (resolvedTarget !== SLIME_ID || this.slime.dead) return this.sendError(player, 'TARGET', 'Select a living target.');
    if (!isInRange(player.position, this.slime.position, ability.range)) return this.sendError(player, 'RANGE', 'Target is out of range.');

    player.targetId = SLIME_ID;
    player.cooldowns.set(ability.id, now + ability.cooldownMs);
    this.broadcastCombat({ kind: 'cast', sourceId: player.entityId, targetId: SLIME_ID, abilityId: ability.id, at: { ...player.position } });

    const amount = calculateDamage(ability, player.stats, TRAINING_SLIME.stats);
    const result = applyDamage(this.slime.hp, amount);
    this.slime.hp = result.hp;
    this.broadcastCombat({ kind: 'damage', sourceId: player.entityId, targetId: SLIME_ID, amount, at: { ...this.slime.position } });
    if (result.dead) await this.killSlime(player, now);
  }

  private async killSlime(killer: RuntimePlayer, now: number): Promise<void> {
    if (this.slime.dead) return;
    this.slime.dead = true;
    this.slime.state = 'DEAD';
    this.slime.targetId = null;
    this.slime.respawnAt = now + TRAINING_SLIME.respawnMs;
    for (const player of this.players.values()) if (player.targetId === SLIME_ID) player.targetId = null;
    this.broadcastCombat({ kind: 'death', sourceId: killer.entityId, targetId: SLIME_ID, at: { ...this.slime.position } });

    const next = grantXp(killer.level, killer.xp, TRAINING_SLIME.xpReward);
    killer.level = next.level;
    killer.xp = next.xp;
    await db.update(characters).set({ level: killer.level, xp: killer.xp }).where(eq(characters.id, killer.characterId));
    this.broadcastCombat({ kind: 'xp', sourceId: killer.entityId, amount: TRAINING_SLIME.xpReward, level: killer.level, xp: killer.xp, at: { ...killer.position } });
  }

  private tick(now: number): void {
    const dt = TICK_MS / 1000;
    for (const player of this.players.values()) {
      if (player.dead) continue;
      const dx = player.inputX * player.stats.moveSpeed * dt;
      const dz = player.inputZ * player.stats.moveSpeed * dt;
      player.position.x = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, player.position.x + dx));
      player.position.z = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, player.position.z + dz));
      if (Math.abs(dx) + Math.abs(dz) > 0.0001) player.rotation = Math.atan2(dx, dz);
    }

    this.tickSlime(now, dt);
    for (const player of this.players.values()) this.send(player, this.stateMessage(player, now));
  }

  private tickSlime(now: number, dt: number): void {
    if (this.slime.dead) {
      if (now >= this.slime.respawnAt) this.respawnSlime();
      return;
    }

    let target = this.slime.targetId ? this.players.get(this.slime.targetId) ?? null : null;
    if (!target || target.dead || !isInRange(this.slime.position, target.position, TRAINING_SLIME.aggroRange * 1.4)) {
      target = this.closestAggroPlayer();
      this.slime.targetId = target?.entityId ?? null;
    }
    if (!target) {
      this.slime.state = 'IDLE';
      return;
    }

    const distance = Math.hypot(target.position.x - this.slime.position.x, target.position.z - this.slime.position.z);
    const dx = target.position.x - this.slime.position.x;
    const dz = target.position.z - this.slime.position.z;
    this.slime.rotation = Math.atan2(dx, dz);

    if (distance > TRAINING_SLIME.attackRange) {
      this.slime.state = 'CHASE';
      const inv = distance > 0 ? 1 / distance : 0;
      this.slime.position.x += dx * inv * TRAINING_SLIME.stats.moveSpeed * dt;
      this.slime.position.z += dz * inv * TRAINING_SLIME.stats.moveSpeed * dt;
      return;
    }

    this.slime.state = 'ATTACK';
    if (now < this.slime.attackReadyAt) return;
    this.slime.attackReadyAt = now + TRAINING_SLIME.attackCooldownMs;
    const amount = calculateDamage(slimeAttack, TRAINING_SLIME.stats, target.stats);
    const result = applyDamage(target.hp, amount);
    target.hp = result.hp;
    this.broadcastCombat({ kind: 'cast', sourceId: SLIME_ID, targetId: target.entityId, abilityId: slimeAttack.id, at: { ...this.slime.position } });
    this.broadcastCombat({ kind: 'damage', sourceId: SLIME_ID, targetId: target.entityId, amount, at: { ...target.position } });
    if (result.dead) {
      target.dead = true;
      target.inputX = 0;
      target.inputZ = 0;
      this.slime.targetId = null;
      this.broadcastCombat({ kind: 'death', sourceId: SLIME_ID, targetId: target.entityId, at: { ...target.position } });
    }
  }

  private closestAggroPlayer(): RuntimePlayer | null {
    let best: RuntimePlayer | null = null;
    let bestDistance = Infinity;
    for (const player of this.players.values()) {
      if (player.dead) continue;
      const distance = Math.hypot(player.position.x - this.slime.position.x, player.position.z - this.slime.position.z);
      if (distance <= TRAINING_SLIME.aggroRange && distance < bestDistance) {
        best = player;
        bestDistance = distance;
      }
    }
    return best;
  }

  private respawnSlime(): void {
    this.slime.position = { ...SLIME_SPAWN };
    this.slime.hp = TRAINING_SLIME.stats.maxHp;
    this.slime.dead = false;
    this.slime.state = 'IDLE';
    this.slime.targetId = null;
    this.slime.attackReadyAt = 0;
  }

  private playerSnapshot(player: RuntimePlayer): PlayerSnapshot {
    return {
      entityId: player.entityId,
      id: player.characterId,
      name: player.name,
      classId: player.classId,
      level: player.level,
      xp: player.xp,
      position: { ...player.position },
      rotation: player.rotation,
      hp: player.hp,
      maxHp: player.stats.maxHp,
      dead: player.dead,
    };
  }

  private monsterSnapshot(): MonsterSnapshot {
    return {
      entityId: SLIME_ID,
      name: TRAINING_SLIME.name,
      position: { ...this.slime.position },
      rotation: this.slime.rotation,
      hp: this.slime.hp,
      maxHp: TRAINING_SLIME.stats.maxHp,
      dead: this.slime.dead,
    };
  }

  private abilityHud(player: RuntimePlayer) {
    return getClassAbilities(player.classId).map((ability) => ({
      id: ability.id,
      name: ability.name,
      cooldownMs: ability.cooldownMs,
      readyAt: player.cooldowns.get(ability.id) ?? 0,
    }));
  }

  private welcomeMessage(player: RuntimePlayer): ServerMessage {
    return { type: 'welcome', self: this.playerSnapshot(player), monster: this.monsterSnapshot(), abilities: this.abilityHud(player), selectedTargetId: player.targetId };
  }

  private stateMessage(player: RuntimePlayer, serverTime: number): ServerMessage {
    return {
      type: 'state',
      self: this.playerSnapshot(player),
      players: [...this.players.values()].filter((other) => other.entityId !== player.entityId).map((other) => this.playerSnapshot(other)),
      monster: this.monsterSnapshot(),
      selectedTargetId: player.targetId,
      abilities: this.abilityHud(player),
      serverTime,
    };
  }

  private broadcastCombat(event: CombatEvent): void {
    for (const player of this.players.values()) this.send(player, { type: 'combat', event });
  }

  private sendError(player: RuntimePlayer, code: string, message: string): void {
    this.send(player, { type: 'error', code, message });
  }

  private send(player: RuntimePlayer, message: ServerMessage): void {
    if (player.socket.readyState === WebSocket.OPEN) player.socket.send(JSON.stringify(message));
  }
}
