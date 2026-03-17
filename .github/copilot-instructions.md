# Visual Flow Editor - Copilot Instructions

## Project Overview

This is a **visual programming environment** inspired by UE5 Blueprints. Users create flowchart-style diagrams representing code, which generates portable **Go** code and pushes to **GitHub repositories**.

## IMPORTANT: Documentation Requirements

After making code changes, **always update documentation** if the change affects:

1. **README.md** (`visual-flow-editor/README.md`) - Update when:
   - Adding new features or UI elements
   - Adding/changing API endpoints
   - Changing file responsibilities
   - Adding troubleshooting info

2. **Copilot Instructions** (this file) - Update when:
   - Adding new node types
   - Changing architecture or data flow
   - Adding new API endpoints
   - Discovering new gotchas/issues

3. **Testing Reset** - For quick testing reset:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3001/api/reset-all" -Method POST -ContentType "application/json" -Body '{}'
   ```

## Maintainability Rule

- Prefer separation of responsibilities.
- Keep route wiring, database operations, code generation, and process management in separate modules/services.
- Reuse service utilities rather than duplicating domain logic inline.
- If one file starts owning multiple domains, split it before adding more features.

## Architecture Summary

### Two-Level Canvas System
1. **Project Level** (main view): Contains Database nodes, API Service nodes, and auto-generated DataGateway
2. **Service Level** (drill-down): Contains flow logic nodes (Start/End, Action, Decision, Loop, API Call)

Navigation: Breadcrumb at top (`📁 Project > 🔌 ServiceName`)

### Key Components

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app, canvas navigation, state management |
| `src/services/nodeLifecycle.ts` | Shared node lifecycle logic (defaults, callback binding, callback stripping, delete-safe updates) |
| `src/nodes/*.tsx` | Custom React Flow node components |
| `src/components/*.tsx` | Modals and dialogs |
| `server/index.js` | Express API composition and route orchestration |
| `server/services/databaseService.js` | PostgreSQL operations and reset logic |
| `server/services/datagatewayGenerator.js` | DataGateway code/README generation |
| `server/services/serviceCodeGenerator.js` | Flow/service Go code generation helpers |
| `server/services/githubService.js` | GitHub repo/create/push helpers and push route orchestration |
| `server/services/serverProcessService.js` | Start/stop/status lifecycle for generated local servers |
| `server/services/projectService.js` | Save/load/clear project persistence helpers |
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

### Local Server Running

DataGateway nodes have Run/Stop buttons:
- Click ▶ Run → Generates Go code, runs `go run .`
- Shows LIVE badge when running
- URLs dropdown shows REST (8080), gRPC (50051), GraphQL (8081)
- Click ⏹ Stop → Kills the server process

## Technical Stack

- **Frontend:** React 19 + TypeScript + Vite 8 + React Flow (@xyflow/react v12)
- **Backend:** Express.js (port 3001) + pg
- **Database:** PostgreSQL 17 (localhost:5432)
- **Generated Code:** Go 1.21+ (must be on PATH for local running)
- **GitHub:** Authenticated as `LazloHolliefeld` via `gh` CLI

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/db/create` | Create database + tables |
| `POST /api/db/drop` | Drop database |
| `POST /api/db/list-databases` | List PostgreSQL databases |
| `POST /api/reset-all` | **Drop ALL databases + clear project + stop servers** |
| `GET /api/project/load` | Load saved project |
| `POST /api/project/save` | Save project state |
| `POST /api/generate/push-all` | Generate code & push to GitHub |
| `POST /api/server/start-datagateway` | Run DataGateway locally |
| `POST /api/server/stop-datagateway` | Stop DataGateway server |
| `GET /api/server/status-datagateway` | Check if DataGateway is running |

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

## Running the GUI

**Easiest Method:**
- Double-click `start-dev.bat` from workspace root
- This handles PowerShell execution policy, kills conflicting ports, and starts both frontend + backend
- Frontend: `http://localhost:5173` (or 5174 if 5173 taken)
- Backend: `http://localhost:3001`

**Manual Method:**
```bash
cd visual-flow-editor
npm run dev
```

**PowerShell Execution Policy Issue:**
If you get "running scripts is disabled" error, enable it once:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

**Port Conflicts:**
- Vite auto-switches to next port (5174, 5175...) if 5173 is taken
- If port 3001 is in use: `taskkill /IM node.exe /F` to kill Node processes

## Development Commands

- Start dev server: `Ctrl+Shift+B` or `npm run dev`
- Frontend only: `npm run dev:frontend` (port 5173)
- Backend only: `npm run dev:server` (port 3001)

## Common Tasks

### Adding a new node type
1. Create `src/nodes/NewNode.tsx`
2. Export from `src/nodes/index.ts`
3. Add to `nodeTypes` object
4. Add default node data in `src/services/nodeLifecycle.ts`
5. Add project node factory creation handling in `src/services/nodeLifecycle.ts` if project-level
6. Add callback binding/stripping handling in `src/services/nodeLifecycle.ts` if needed
7. Add button in `App.tsx` palette
8. Add styles in `App.css`

### Modifying code generation
Edit `server/index.js`:
- `generateGoCode()` - Flow-to-Go translation
- `generateDataGateway()` - DataGateway code
: DataGateway REST contract now uses body-driven query endpoints (`/api/query/fetch|insert|update|delete`)
- `generateServiceCode()` - Per-service code

## Known Issues / Gotchas

1. **React Flow v12** exports `NodeProps` as type-only, not value - use `import type`
2. **PowerShell** may block npm - use `start-dev.bat` or enable execution policy once
3. **Port conflicts** - kill processes on 5173/3001 if dev server fails
4. **Project persistence** - callbacks are stripped before save, restored on load
5. **Go on PATH** - DataGateway "Run" requires Go installed and on PATH; restart terminals after install
6. **Refresh visibility** - if nodes appear missing after refresh, verify `GET /api/project/load` first to separate UI sync vs persistence issues
7. **New Project cleanup** - ✅ FIXED: Hitting "New Project" now properly drops all PostgreSQL databases via the unified delete pipeline
8. **Database modal persistence** - ✅ FIXED: Form data now saved immediately on "Create Database" click before provisioning
9. **Delete pipeline** - ✅ FIXED: Single-node delete and batch operations (New Project) unified; database nodes trigger `POST /api/db/drop`
10. **DataGateway query contract** - ✅ DONE: Generated gateway uses body-driven query endpoints (`/api/query/fetch|insert|update|delete`) with joins, operators, and validation
11. **Composite primary keys** - ✅ FIXED: Multiple PK checkboxes now generate a single table-level `PRIMARY KEY (col1, col2, ...)` constraint

## GitHub Repositories

- **visual-flow-editor** - This codebase
- **datagateway** - Generated DataGateway service (created on Generate & Push)
- **{service-name}** - Each API service gets its own repo

## Future Development Areas

- [x] Local API running (DataGateway)
- [ ] Local API running (Service nodes)
- [ ] Enhanced code generation (more complete Go code)
- [ ] Real-time code preview panel
- [ ] Sub-function drill-down (API → function → sub-function)
- [ ] Export to multiple languages
- [ ] Undo/redo system
- [ ] Copy/paste nodes
- [ ] Template library
