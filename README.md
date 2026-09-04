# World of ChatGPT

A browser-native 3D online RPG vertical slice built as a server-authoritative TypeScript monorepo.

The MVP proves the complete loop: register/login, create a character, choose Warrior/Mage/Cleric, enter a Three.js arena, move with WASD, target and fight a server-controlled Training Slime, take damage, die/respawn, earn XP, and preserve character progression in PostgreSQL.

## Requirements

- Node.js 22+
- pnpm 10.15+
- Docker with Docker Compose
- A modern browser with WebGL support

## Installation

```bash
git clone https://github.com/owatari/worldofchatgpt.git
cd worldofchatgpt
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

Open `http://localhost:5174`.

`pnpm dev` builds the shared packages first, then starts the Fastify server and Vite client together. The server applies Drizzle SQL migrations automatically during startup.

## Local ports

The development defaults are intentionally isolated from common 3000-3003 app ports:

- Client: `5174`
- API/WebSocket server: `3101`
- PostgreSQL host port: `5433` (`5432` inside the container)

## Environment

Copy `.env.example` to `.env` for local development.

```env
DATABASE_URL=postgresql://worldofchatgpt:worldofchatgpt@localhost:5433/worldofchatgpt
JWT_SECRET=replace-with-a-long-random-secret
PORT=3101
CLIENT_ORIGIN=http://localhost:5174
VITE_API_URL=http://localhost:3101
VITE_WS_URL=ws://localhost:3101/ws
```

Do not commit real secrets. In production, use HTTPS/WSS and a strong JWT secret.

## Database

PostgreSQL runs from `docker-compose.yml` and is exposed on host port `5433`, while PostgreSQL remains on port `5432` inside the container.

Persistence currently stores:

- accounts and password hashes;
- one character per account;
- character name and class;
- level and XP.

HP and position intentionally reset when entering the world for the MVP.

Useful database scripts:

```bash
pnpm --filter @worldofchatgpt/server db:generate
pnpm --filter @worldofchatgpt/server db:migrate
```

Normal local startup does not require running either command manually because migrations run on server boot.

## Development

```bash
pnpm dev
```

Individual apps:

```bash
pnpm --filter @worldofchatgpt/shared build
pnpm --filter @worldofchatgpt/game-core build
pnpm --filter @worldofchatgpt/server dev
pnpm --filter @worldofchatgpt/client dev
```

Quality gates:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

The same gates run in `.github/workflows/quality.yml`.

## Architecture

### Client

React owns account/character screens and HUD. Three.js owns the 3D scene, entities, camera, raycasting, effects, and rendering. Gameplay messages go through a dedicated WebSocket client.

### Server

Fastify owns REST auth/character APIs and the WebSocket endpoint. `GameWorld` runs an independent 20 Hz simulation. The browser sends movement/target/cast/respawn intentions; the server owns position, range validation, cooldowns, HP, damage, death, monster AI, XP, and persistence.

### Game Core

`packages/game-core` contains reusable, browser-independent rules and data definitions for classes, stats, abilities, damage, cooldown/range checks, monsters, healing, and progression.

### Shared Protocol

`packages/shared` contains Zod schemas, IDs, DTOs, snapshots, and WebSocket message contracts shared by client and server.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the concise technical map.

## Controls

- **WASD** — move
- **Click Training Slime** — select it and perform the basic attack
- **1** — basic attack
- **2** — class Skill 1
- **3** — class Skill 2
- Hotbar buttons can also be clicked
- **Respawn** button appears after player death

## MVP Features

- Account registration and login with hashed passwords
- JWT-authenticated APIs and gameplay socket
- Persistent character creation
- Warrior, Mage, and Cleric data-driven class definitions
- Low-poly procedural Three.js arena
- Smooth top-down/3⁄4 camera
- Server-authoritative movement at 20 ticks/second
- Training Slime state-machine AI
- Targeting and target HP HUD
- Shared basic attack/ability architecture
- Melee, projectile, AoE, and self-heal abilities
- Server-side range and cooldown validation
- Damage/heal numbers and simple procedural VFX
- Player and monster death
- Player respawn and monster respawn
- XP rewards and level-up progression persisted to PostgreSQL
- Multiplayer-ready player snapshots within the single MVP world

## Project Structure

```text
apps/
  client/
    src/
      auth/
      character/
      game/
        engine/
        networking/
  server/
    drizzle/
    src/
      database/
      game/
      routes/
packages/
  game-core/
  shared/
docs/
  ARCHITECTURE.md
  MVP_STATUS.md
```

## Future Direction

The current code deliberately leaves inventory, equipment, quests, dungeons, multiple maps, guilds, parties, housing, crafting, commerce, PvP, matchmaking, and advanced animation/content pipelines out of the MVP. The separation between UI, rendering, protocol, simulation, core rules, and persistence is intended to let those systems be added without relocating combat authority into the browser or rebuilding the client renderer.
