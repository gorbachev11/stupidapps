# Stupid Apps

This repository includes a standalone browser prototype:

## Simeon Stylites — Low Poly Desert Service Game (prototype)

Location: `game/`

## How to run (full quickstart)

### 1) Prerequisites

You only need:
- A modern browser (Chrome/Edge/Firefox)
- Python 3 (for a local static file server)

Check Python:

```bash
python3 --version
```

### 2) Start the local server

From repo root:

```bash
cd /workspace/stupidapps
python3 -m http.server 4173
```

### 3) Open the game

Open this URL in your browser:

```text
http://localhost:4173/game/
```

### 4) Stop the server

In the terminal running the server, press:

```text
Ctrl+C
```

## Optional: quick health check from terminal

With the server running:

```bash
curl -I http://localhost:4173/game/
```

Expected: HTTP 200 response.

## Controls

- Click game window: lock mouse / start FPS input
- `WASD`: move
- Mouse: look around
- `Space`: jump
- `E`: interact / pick up / drop / deliver (context-sensitive)
- Hold `` ` `` (backtick) for ~1 second near editable flora: open prefab editor

## Sack and interaction basics

- Hover over small items (food/water) and interact to store in sack.
- Use HUD buttons:
  - **Dump Sack To Ground**: drops stored small items nearby.
  - **Offer To Bucket**: attempts delivery to Simeon from sack inventory.
- Large objects (slabs/logs/cacti/pampas) are carried one at a time; movement is reduced while carrying.

## If something looks broken

- Refresh the page after server start.
- Ensure you opened `/game/` not just repo root.
- If prefab edits look odd, clear local saved prefab state:
  - Browser DevTools → Application/Storage → Local Storage → remove `prefabDefs`.

## Implemented systems in this prototype

- FPS exploration over a larger low-poly desert terrain
- Tower placed at highest hill with collision-enabled raised base
- Bucket + rope delivery loop under tower
- Hunger / thirst / spiritual peace / wellbeing simulation
- Slower weather and day/night transitions
- Rain / scorching / dust / night effects and thirst modifiers
- Hover info labels for interactables
- Sack inventory (small items)
- Carryable slabs/logs/cacti/pampas with simple placement and balance checks
- Creek through canyon with animated water surface
- Rare palms near water, variable grass patches and pampas
- Cave entrance area for distant exploration
- Runtime prefab editor (basic) with local save + global instance updates
