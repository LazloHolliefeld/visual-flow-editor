# Visual Flow Editor

A visual programming environment inspired by Unreal Engine 5 Blueprints. Design logic using flowchart-style diagrams that generate portable Go code.

## Current Status

**Version:** 2.0 (Canvas Navigation Update)

### Implemented Features
- ✅ Two-level canvas navigation (Project → Service drill-down)
- ✅ Breadcrumb navigation bar
- ✅ Database node with table/schema designer
- ✅ API Service nodes with internal flow logic
- ✅ Auto-generated DataGateway (REST/gRPC/GraphQL) from databases
- ✅ Per-service GitHub repository pushing
- ✅ Project persistence (auto-save)
- ✅ New Project / Delete functionality with confirmation dialogs

### In Progress
- 🔄 Code generation refinement
- 🔄 Testing full workflow

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
2. Configure host, port, database name
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

## Troubleshooting

### "npm is not recognized"
Node.js PATH may not be set. Either:
- Restart VS Code / your terminal after Node.js installation
- Use the `start-dev.bat` file which sets the PATH automatically

### PowerShell script execution blocked
The workspace is configured to use Command Prompt instead. If you need PowerShell:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

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
