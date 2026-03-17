# Visual Flow Editor

A visual programming environment inspired by Unreal Engine 5 Blueprints. Design logic using flowchart-style diagrams that generate portable Go code.

## Current Status

**Version:** 2.1 (Local API Runner)

### Implemented Features
- ✅ Two-level canvas navigation (Project → Service drill-down)
- ✅ Breadcrumb navigation bar
- ✅ Database node with table/schema designer
- ✅ Composite primary keys supported (select multiple PK columns per table)
- ✅ API Service nodes with internal flow logic
- ✅ Auto-generated DataGateway (REST/gRPC/GraphQL) from databases
- ✅ Per-service GitHub repository pushing
- ✅ Project persistence (auto-save)
- ✅ New Project / Delete functionality with confirmation dialogs
- ✅ **Run DataGateway locally** - Start/stop API with live URL display

### In Progress
- 🔄 Run API Service nodes locally
- 🔄 Code generation refinement

### Pending
- ⏳ Real-time code preview
- ⏳ More node types for service logic
- ⏳ Enhanced GraphQL/gRPC code generation

## Architecture

```
Project Level (Main Canvas)
├── Database nodes (⛁) → Define PostgreSQL databases/tables
├── API Service nodes (🔌) → Your custom services  
└── DataGateway node (🗄️) → Auto-generated, read-only

Service Level (Drill-down Canvas)
├── Start/End nodes (⬭)
├── Action nodes (▭)
├── Decision nodes (◇)
├── Loop nodes (⬡)
└── API Call nodes (▱)
```

## Generated Repositories

When you click "Generate & Push", separate repos are created:

| Repo | Contents |
|------|----------|
| `datagateway` | Auto-generated CRUD API (REST/gRPC/GraphQL) + DB schemas |
| `{service-name}` | Each API service you create gets its own repo |

## Maintainability Rule

- Keep responsibilities separated by module.
- Prefer small focused services/utilities over growing monolith files.
- Reuse existing service functions before adding new inline logic in route/UI layers.
- When a file starts owning multiple domains (for example DB ops + generation + process management), split by domain.

## Quick Start

### Option 1: VS Code Task (Recommended)
Press `Ctrl+Shift+B` to run the dev server task.

### Option 2: Batch File
Double-click `start-dev.bat` in the workspace root.

### Option 3: Command Line
```bash
cd visual-flow-editor
npm run dev
```

Then open http://localhost:5173 in your browser.

## Usage

### Creating a Database
1. Click "⛁ Database" in the left panel
2. Configure host, port, postgres password, and database name
3. Add tables with column definitions
4. Click "Create Database" to provision in PostgreSQL

### Creating an API Service
1. Click "🔌 API Service" in the left panel
2. Enter service name and description
3. Double-click the node to drill down into its flow
4. Add flow nodes (Action, Decision, Loop, API Call)
5. Click "📁 Project" breadcrumb to go back

### DataGateway (Auto-Generated)
- Appears automatically when you add databases
- Shows 🔒 AUTO badge (cannot be edited directly)
- Double-click to view generated endpoints
- Provides REST, gRPC, and GraphQL access to all tables

### Publishing
Click "🚀 Generate & Push" to:
- Generate Go code for all services
- Generate DataGateway with database schemas
- Push each service to its own GitHub repo

### New Project Behavior
- Clicking `🗑️ New Project` now uses the same node delete pipeline as single-node deletion
- Database node deletes trigger PostgreSQL drop (`POST /api/db/drop`) via node-type side effects
- Then canvas/project state is cleared

### Running DataGateway Locally
1. Add at least one database to your project
2. DataGateway node appears automatically
3. Click **▶ Run** on the DataGateway node
4. When running, shows green LIVE badge
5. Click **⬇ URLs** to see REST/gRPC/GraphQL endpoints
6. Click **⏹ Stop** to shut down the server
7. Saving DB configuration or creating DB tables while running will auto-restart DataGateway to apply schema changes

## Testing / Reset

### Reset Everything (PowerShell)
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/reset-all" -Method POST -ContentType "application/json" -Body '{}'
```
This drops all user databases, clears project state, and stops any running servers.

## Troubleshooting

- **DataGateway auth failed (`password authentication failed for user postgres`)**:
  - Set the Database node password in Configure Database.
  - DataGateway uses, in order: `PGPASSWORD` env var, then node-configured password, then `postgres` fallback.
  - If password is unknown, reset the postgres user password and update the node config.

### Module export error on refresh
```
"does not provide an export named 'default'"
```
This is usually a stale Vite cache. Fix:
1. Hard refresh browser: `Ctrl+Shift+R`
2. Or clear Vite cache: Delete `node_modules/.vite/` folder
3. Restart the dev server

### Nodes disappear after refresh
This was caused by canvas state only syncing on context change. The fix syncs canvas state when `projectData` updates after load.
If you still see this once, refresh again after the backend confirms data exists via `GET /api/project/load`.

### Database name resets after using Create Database
`Create Database` now persists the current modal form to the node state before provisioning in PostgreSQL.
If this appears again, confirm `GET /api/project/load` contains the database node `data.database` value.

### "npm is not recognized"
Node.js PATH may not be set. Either:
- Restart VS Code / your terminal after Node.js installation
- Use the `start-dev.bat` file which sets the PATH automatically

### PowerShell script execution blocked
The workspace is configured to use Command Prompt instead. If you need PowerShell:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Port already in use
If ports 5173 or 3001 are in use:
```bash
# Windows - find and kill process on port
netstat -ano | findstr :5173
taskkill /PID <pid> /F
```

## Quick Start / Running the GUI

### Easiest Way (Recommended)
From the workspace root, double-click **`start-dev.bat`** to launch the dev server.

The batch script will:
1. Enable PowerShell script execution (one-time setup)
2. Kill any existing Node processes on ports 3001 and 5173
3. Start the frontend on `http://localhost:5173` (or 5174 if 5173 is taken)
4. Start the backend API on `http://localhost:3001`

### Manual Method

**If `start-dev.bat` doesn't work:**

1. Open Command Prompt or PowerShell in the `visual-flow-editor` folder
2. Run: `npm run dev`
3. Frontend: `http://localhost:5173`
4. Backend: `http://localhost:3001`

**PowerShell Note:** If you see "execution policy" error, run this once:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

### Troubleshooting
- **Port 5173/5174 in use:** Vite will automatically try the next available port
- **Port 3001 in use:** Kill Node processes with `taskkill /IM node.exe /F`
- **Module not found:** Run `npm install` in both root and `server/` folder

## Available Scripts

- `npm run dev` - Start frontend + backend servers (ports 5173 + 3001)
- `npm run dev:frontend` - Start only the Vite frontend
- `npm run dev:server` - Start only the backend API server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Project Structure

```
visual-flow-editor/
├── src/
│   ├── App.tsx              # Main app with canvas navigation
│   ├── App.css              # All styles
│   ├── nodes/               # Custom React Flow nodes
│   │   ├── DatabaseNode.tsx
│   │   ├── ServiceNode.tsx
│   │   ├── DataGatewayNode.tsx
│   │   ├── ActionNode.tsx
│   │   ├── DecisionNode.tsx
│   │   ├── LoopNode.tsx
│   │   ├── ApiCallNode.tsx
│   │   └── StartEndNode.tsx
│   └── components/          # Modals and dialogs
│       ├── DatabaseConfigModal.tsx
│       ├── ServiceConfigModal.tsx
│       ├── DataGatewayViewModal.tsx
│       └── ConfirmDialog.tsx
├── server/
│   ├── index.js             # Express API server
│   └── project.json         # Persisted project state
└── package.json
```

## File Responsibilities (Debug Guide)

### Frontend (`src/`)

| File | Purpose | Key Features |
|------|---------|--------------|
| `App.tsx` | **Main orchestrator** | Canvas navigation, state management, node creation, all callbacks |
| `App.css` | All styling | Node styles, modals, animations, running states |
| `services/nodeLifecycle.ts` | Shared node lifecycle utilities | Default data, project node factory creation, callback binding, callback stripping, delete-safe project updates |
| `nodes/DatabaseNode.tsx` | Database node UI | Configure button, delete button, table count display |
| `nodes/ServiceNode.tsx` | Service node UI | Configure, drill-down, delete buttons |
| `nodes/DataGatewayNode.tsx` | DataGateway node UI | **Run/Stop buttons**, URLs dropdown, LIVE badge when running |
| `nodes/ActionNode.tsx` | Action node in flows | Code execution block |
| `nodes/DecisionNode.tsx` | IF/ELSE branching | Two outputs (true/false) |
| `nodes/LoopNode.tsx` | Iteration node | For/while loops |
| `nodes/ApiCallNode.tsx` | External API calls | HTTP method, URL config |
| `nodes/StartEndNode.tsx` | Flow entry/exit | Start/End markers |
| `components/DatabaseConfigModal.tsx` | DB config form | Host, port, tables, columns with types |
| `components/ServiceConfigModal.tsx` | Service config form | Name, description |
| `components/DataGatewayViewModal.tsx` | View auto-generated endpoints | Read-only display |
| `components/ConfirmDialog.tsx` | Delete confirmations | Reusable dialog |

### Backend (`server/`)

| File | Purpose |
|------|---------|
| `index.js` | Express API composition/root routes, persistence, generation orchestration, local server lifecycle |
| `services/databaseService.js` | PostgreSQL responsibilities (connect/test/create/drop/list/reset/execute) |
| `services/datagatewayGenerator.js` | DataGateway code generation templates and README generation |
| `services/serviceCodeGenerator.js` | Service-level and project-level Go code generation helpers |
| `services/githubService.js` | GitHub repository helpers plus push API orchestration |
| `services/serverProcessService.js` | Local generated-server process lifecycle management |
| `services/projectService.js` | Project state persistence (save/load/clear + migration handling) |
| `project.json` | Auto-saved project state (stripped of callbacks) |

## API Endpoints Reference

### Database Operations
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/db/create` | POST | Create PostgreSQL database + tables |
| `/api/db/drop` | POST | Drop a database |
| `/api/db/list-databases` | POST | List all PostgreSQL databases |
| `/api/reset-all` | POST | **Drop ALL user databases + clear project + stop servers** |

### Project Persistence
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/project/load` | GET | Load saved project state |
| `/api/project/save` | POST | Save current project state |

### Code Generation
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/generate/push-all` | POST | Generate Go code & push to GitHub |

### Local Server Management (NEW)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/server/start-datagateway` | POST | Generate code & run DataGateway locally |
| `/api/server/stop-datagateway` | POST | Stop running DataGateway server |
| `/api/server/status-datagateway` | GET | Check if DataGateway is running |

## State Management (App.tsx)

Key state variables for debugging:
```typescript
// Canvas navigation
canvasContext: { type: 'project' } | { type: 'service', serviceId, serviceName }

// Project data (persisted)
projectData: {
  projectNodes: Node[],      // Database, Service, DataGateway nodes
  projectEdges: Edge[],      // Project-level connections
  serviceFlows: { [serviceId]: { nodes, edges } }  // Per-service flows
}

// DataGateway running state
isDataGatewayRunning: boolean
dataGatewayUrls: { rest?: string, grpc?: string, graphql?: string } | null
```

## Technical Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Diagram Library:** React Flow (@xyflow/react v12)
- **Backend:** Express.js + pg (PostgreSQL client)
- **Database:** PostgreSQL 17
- **Version Control:** Git + GitHub CLI (gh)
- **Generated Code:** Go 1.21+

## Requirements

- Node.js 18+
- PostgreSQL 17 (running locally)
- Git + GitHub CLI (for repo pushing)
- GitHub account authenticated via `gh auth login`

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.9 | Mar 2026 | Fixed multi-key DB creation by generating composite PRIMARY KEY constraints when multiple PK columns are selected |
| 2.8 | Mar 2026 | DataGateway generation moved to body-driven query endpoints (`/api/query/fetch|insert|update|delete`) with joins/operators/order/paging |
| 2.7 | Mar 2026 | Unified delete pipeline: single delete and New Project share node-type side effects (DB drop) |
| 2.6 | Mar 2026 | New Project now triggers backend reset-all so DB nodes deletion also drops PostgreSQL databases |
| 2.5 | Mar 2026 | Fixed database modal so Create Database also saves node config (name/tables) |
| 2.4 | Mar 2026 | Extracted project node creation into lifecycle service factory to reduce add-node coupling |
| 2.3 | Mar 2026 | Node lifecycle refactor: centralized defaults/callback stripping/callback binding/delete-safe updates |
| 2.2 | Mar 2026 | Fixed refresh sync bug where nodes could disappear after page reload |
| 2.1 | Mar 2026 | Local API runner for DataGateway (Run/Stop buttons, URL display) |
| 2.0 | Mar 2026 | Two-level canvas navigation, breadcrumb nav, DataGateway auto-generation |
| 1.5 | Mar 2026 | Project persistence, per-service repos, node callbacks fix |
| 1.0 | Mar 2026 | Initial release with Database/Service/Flow nodes |

## Known Limitations

- DataGateway "Run" currently requires Go to be installed on PATH
- Only one DataGateway can run at a time
- Generated Go code is functional but minimal
- GraphQL/gRPC generation is basic placeholder
