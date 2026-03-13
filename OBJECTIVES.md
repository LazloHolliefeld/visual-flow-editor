# Project Objectives

## Overview
A visual programming environment inspired by Unreal Engine 5's Blueprint system. Users design logic using flowchart-style diagram objects (similar to Lucidchart), where shapes and connections represent code constructs. The system generates portable, high-performance code from these visual definitions.

---

## Goals

### Primary Objectives
1. [x] Create a GUI for visual node-based programming
2. [x] Implement shape-based code representation (flowchart/Lucid diagram style)
3. [x] Generate portable, fast code from visual diagrams (Go)
4. [x] Support parameterized shapes with configurable properties

### Secondary Objectives
- [x] Save/load diagram projects (auto-persistence)
- [ ] Export to multiple target languages
- [ ] Provide a library of reusable diagram components
- [ ] Real-time code preview as diagrams are built

### New Objectives (v2.0)
- [x] Auto-generated DataGateway from databases (REST/gRPC/GraphQL)
- [x] Per-service GitHub repository publishing
- [x] Two-level canvas navigation (Project → Service drill-down)
- [x] Breadcrumb navigation
- [ ] Sub-function drill-down capability (deferred for later)

---

## Shape Definitions (Code Constructs)

| Shape | Code Construct | Status |
|-------|----------------|--------|
| Diamond | Decision (IF/ELSE) | ✅ Implemented |
| Rectangle | Statement/Action | ✅ Implemented |
| Parallelogram | API Call | ✅ Implemented |
| Oval | Start/End | ✅ Implemented |
| Line/Arrow | Flow/Call | ✅ Implemented |
| Hexagon | Loop | ✅ Implemented |
| Cylinder | Database | ✅ Implemented |
| Service Box | API Service | ✅ Implemented |
| DataGateway | Auto-generated CRUD | ✅ Implemented |
| Rounded Rectangle | Function/Subroutine | ⏳ Deferred |

---

## Technical Decisions ✓
- **GUI Framework:** Web-based (React 19 + TypeScript)
- **Diagram Library:** React Flow (@xyflow/react v12) with custom node types
- **Code Generation Target:** Go 1.21+ (portable single binaries, fast compilation)
- **Project File Format:** JSON (server/project.json, auto-saved)
- **Deployment Target:** Web (frontend on 5173, backend on 3001)
- **Build Tool:** Vite 8 (fast dev server and builds)
- **Database:** PostgreSQL 17
- **Version Control:** Git + GitHub CLI

---

## Architecture Decisions (v2.0)

### Canvas Levels
1. **Project Level:** Databases, API Services, DataGateway (auto-generated)
2. **Service Level:** Flow logic (Start, Action, Decision, Loop, API Call)

### Repository Strategy
- Each API service → Separate GitHub repo
- DataGateway → Its own repo
- This allows independent deployment and versioning

### DataGateway
- Auto-generated when databases exist
- Read-only (cannot edit directly)
- Supports REST, gRPC, GraphQL protocols
- CRUD for every table

---

## Constraints & Requirements

### Must Have
- [x] Portable generated code (minimal dependencies, cross-platform)
- [x] Fast execution of generated code (Go)
- [x] Intuitive drag-and-drop interface
- [x] Clear visual representation of program flow

### Performance Goals
- Generated code should be optimized (not naive translation)
- [x] GUI should handle diagrams with 100+ nodes smoothly (React Flow handles this)

---

## Success Criteria
- [x] User can create a complete program visually without writing code
- [x] Generated code compiles and runs on multiple platforms (Go)
- [ ] Generated code performance is comparable to hand-written code
- [ ] Non-programmers can understand and modify diagram logic

---

## Development Progress

### Completed (v1.0)
- Basic node types (Decision, Action, Loop, API Call, Start/End)
- Database node with table designer
- PostgreSQL integration
- Project persistence
- GitHub push integration

### Completed (v2.0)
- Two-level canvas navigation
- Breadcrumb navigation
- API Service nodes
- DataGateway auto-generation
- Per-service repositories
- Delete/New Project functionality
- Confirm dialogs

### In Progress
- Code generation refinement
- Full workflow testing

### Backlog
- Real-time code preview
- Sub-function drill-down
- Template library
- Undo/redo
- Copy/paste nodes
- Multi-language export

---

## Notes
- Inspiration: Unreal Engine 5 Blueprints, Lucidchart, Node-RED, Scratch
- GitHub user: LazloHolliefeld
- Database password: postgres (local dev only)

---

*Last updated: March 13, 2026*
