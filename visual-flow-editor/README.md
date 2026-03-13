# Visual Flow Editor

A visual programming environment inspired by Unreal Engine 5 Blueprints. Design logic using flowchart-style diagrams that generate portable Go code.

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

- `npm run dev` - Start frontend + backend servers
- `npm run dev:frontend` - Start only the Vite frontend
- `npm run dev:server` - Start only the backend API server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Node Types

| Shape | Type | Purpose |
|-------|------|---------|
| Oval | Start/End | Entry and exit points |
| Rectangle | Action | Execute code statements |
| Diamond | Decision | IF/ELSE branching |
| Hexagon | Loop | For/While iteration |
| Parallelogram | API Call | External API requests |
| Cylinder | Database | PostgreSQL database connections |

## Database Node

The Database node allows you to:
1. Configure PostgreSQL connection settings (host, port)
2. Define database name and schema
3. Design tables with columns (name, type, primary key, nullable)
4. Create the database and tables directly from the GUI

### Requirements
- PostgreSQL 17 installed and running
- Default credentials: postgres/postgres (configure in server/index.js)

### Usage
1. Click "⛁ Database" in the node palette
2. Configure connection settings
3. Add tables and define columns
4. Click "Create Database" to provision the schema
