# Architecture

## Client

`apps/client` is a React + Vite application. React owns auth, character creation, HUD, hotbar, connection state, and death/respawn UI. `GameEngine` owns Three.js and does not contain authoritative gameplay rules.

Client inputs are intentions only:

- movement vector;
- target selection;
- ability cast request;
- respawn request.

## Server

`apps/server` is Fastify + WebSocket. REST handles registration/login/character creation. `GameWorld` owns the live map simulation and runs every 50 ms (20 ticks/second), independent from browser FPS.

The server validates and decides:

- movement speed and arena bounds;
- valid targets and attack range;
- cooldown readiness;
- damage and healing;
- player/monster HP and death;
- Training Slime AI;
- XP grants and level progression.

## Game Core

`packages/game-core` has no React, DOM, or Three.js dependency. It contains class definitions, stats, abilities, combat math, range/cooldown helpers, monster definitions, healing, and XP rules. It is intended to be reusable by tests, future dedicated simulation workers, admin tools, or combat simulators.

## Shared Protocol

`packages/shared` contains Zod input schemas and TypeScript contracts for REST DTOs, IDs, snapshots, combat events, and WebSocket messages. Client and server import the same contracts instead of maintaining parallel copies.

## Database

PostgreSQL is the source of truth for persistent account and character progression. Drizzle defines the schema and the server applies checked-in SQL migrations at startup.

Current persistent fields are account credentials (hashed), character identity/class, level, and XP. Position and current HP are runtime state only for this MVP.

## Server Authority

The client never sends a damage number, resulting HP value, XP amount, monster state, or cooldown result. It requests an action; the server validates the world state and emits snapshots/combat events.

## Game Tick

The world simulation runs at 20 Hz. Movement intentions are stored on connection state and integrated by the server tick. The Three.js renderer uses `requestAnimationFrame` separately.

## Rendering

The arena and placeholder characters are procedural low-poly Three.js meshes. Entity presentation is isolated behind `GameEngine`, so placeholder geometry can later be swapped for GLB/GLTF models without moving combat/networking logic into the renderer.

## Networking

One authenticated WebSocket connection represents one active character. Small MVP state snapshots carry player/monster state while discrete combat events drive visual feedback. The current world is intentionally tiny; future scaling can replace the broadcast strategy with interest management without changing the client intention protocol.
