# Visual Flow Editor - Copilot Instructions

## Project Overview

This is a **visual programming environment** inspired by UE5 Blueprints. Users create flowchart-style diagrams representing code, which generates portable **Go** code and pushes to **GitHub repositories**.

## Architecture Summary

### Two-Level Canvas System
1. **Project Level** (main view): Contains Database nodes, API Service nodes, and auto-generated DataGateway
2. **Service Level** (drill-down): Contains flow logic nodes (Start/End, Action, Decision, Loop, API Call)

Navigation: Breadcrumb at top (`📁 Project > 🔌 ServiceName`)

### Key Components

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app, canvas navigation, state management |
| `src/nodes/*.tsx` | Custom React Flow node components |
| `src/components/*.tsx` | Modals and dialogs |
| `server/index.js` | Express API (DB operations, persistence, code generation) |
| `server/project.json` | Auto-saved project state |

### Node Types

**Project Level:**
- `database` (⛁) - PostgreSQL database with table designer
- `service` (🔌) - API service, drill-down to edit logic
- `dataGateway` (🗄️) - Auto-generated from databases, read-only

**Service Level:**
- `startEnd` (⬭) - Flow entry/exit points
- `action` (▭) - Execute code
- `decision` (◇) - IF/ELSE branching
- `loop` (⬡) - For/While iteration
- `apiCall` (▱) - Call other APIs/DataGateway

### Data Flow

```
User adds Database → DataGateway auto-created → 
User clicks "Generate & Push" →
  - DataGateway repo created with REST/gRPC/GraphQL
  - Each Service gets its own repo
  - Database schemas exported to SQL files
```

## Technical Stack

- **Frontend:** React 19 + TypeScript + Vite 8 + React Flow (@xyflow/react v12)
- **Backend:** Express.js (port 3001) + pg
- **Database:** PostgreSQL 17 (localhost:5432)
- **GitHub:** Authenticated as `LazloHolliefeld` via `gh` CLI

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/db/create` | Create database + tables |
| `POST /api/db/drop` | Drop database |
| `POST /api/db/list-databases` | List PostgreSQL databases |
| `GET /api/project/load` | Load saved project |
| `POST /api/project/save` | Save project state |
| `POST /api/generate/push-all` | Generate code & push to GitHub |

## Project State Format (v2.0)

```typescript
interface ProjectData {
  projectNodes: Node[];     // Database, Service, DataGateway nodes
  projectEdges: Edge[];     // Connections at project level
  serviceFlows: {           // Per-service flow definitions
    [serviceId: string]: {
      nodes: Node[];        // Flow nodes inside this service
      edges: Edge[];
    }
  }
}
```

## Development Commands

- Start dev server: `Ctrl+Shift+B` or `npm run dev`
- Frontend only: `npm run dev:frontend` (port 5173)
- Backend only: `npm run dev:server` (port 3001)

## Common Tasks

### Adding a new node type
1. Create `src/nodes/NewNode.tsx`
2. Export from `src/nodes/index.ts`
3. Add to `nodeTypes` object
4. Add button in `App.tsx` palette
5. Add styles in `App.css`

### Modifying code generation
Edit `server/index.js`:
- `generateGoCode()` - Flow-to-Go translation
- `generateDataGateway()` - DataGateway code
- `generateServiceCode()` - Per-service code

## Known Issues / Gotchas

1. **React Flow v12** exports `NodeProps` as type-only, not value - use `import type`
2. **PowerShell** may block npm - workspace configured to use Command Prompt
3. **Port conflicts** - kill processes on 5173/3001 if dev server fails
4. **Project persistence** - callbacks are stripped before save, restored on load

## GitHub Repositories

- **visual-flow-editor** - This codebase
- **datagateway** - Generated DataGateway service (created on Generate & Push)
- **{service-name}** - Each API service gets its own repo

## Future Development Areas

- [ ] Enhanced code generation (more complete Go code)
- [ ] Real-time code preview panel
- [ ] Sub-function drill-down (API → function → sub-function)
- [ ] Export to multiple languages
- [ ] Undo/redo system
- [ ] Copy/paste nodes
- [ ] Template library
