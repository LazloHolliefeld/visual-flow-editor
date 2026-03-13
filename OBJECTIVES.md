# Project Objectives

## Overview
A visual programming environment inspired by Unreal Engine 5's Blueprint system. Users design logic using flowchart-style diagram objects (similar to Lucidchart), where shapes and connections represent code constructs. The system generates portable, high-performance code from these visual definitions.

---

## Goals

### Primary Objectives
1. [ ] Create a GUI for visual node-based programming
2. [ ] Implement shape-based code representation (flowchart/Lucid diagram style)
3. [ ] Generate portable, fast code from visual diagrams
4. [ ] Support parameterized shapes with configurable properties

### Secondary Objectives
- [ ] Save/load diagram projects
- [ ] Export to multiple target languages
- [ ] Provide a library of reusable diagram components
- [ ] Real-time code preview as diagrams are built

---

## Shape Definitions (Code Constructs)

| Shape | Code Construct | Description |
|-------|----------------|-------------|
| Diamond | Decision (IF/ELSE) | Conditional branching |
| Rectangle | Statement/Action | Execute code or assign values |
| Parallelogram | Input/Output | Read input or display output |
| Oval | Start/End | Entry and exit points |
| Line/Arrow | Flow/Call | Connect nodes, API calls, function invocations |
| Hexagon | Loop | For/While iteration |
| Rounded Rectangle | Function/Subroutine | Reusable code blocks |
| Cylinder | Database | Database connections, schema/table definitions |

*Additional shapes can be defined as needed*

---

## Technical Decisions ✓
- **GUI Framework:** Web-based (React + TypeScript)
- **Diagram Library:** React Flow (with custom node types for shapes)
- **Code Generation Target:** Go (portable single binaries, fast compilation)
- **Project File Format:** JSON (diagram state, exportable)
- **Deployment Target:** Web (deployable anywhere, code pushed to GitHub)
- **Build Tool:** Vite (fast dev server and builds)

---

## Constraints & Requirements

### Must Have
- Portable generated code (minimal dependencies, cross-platform)
- Fast execution of generated code
- Intuitive drag-and-drop interface
- Clear visual representation of program flow

### Performance Goals
- Generated code should be optimized (not naive translation)
- GUI should handle diagrams with 100+ nodes smoothly

---

## Success Criteria
- [ ] User can create a complete program visually without writing code
- [ ] Generated code compiles and runs on multiple platforms
- [ ] Generated code performance is comparable to hand-written code
- [ ] Non-programmers can understand and modify diagram logic

---

## Notes
- Inspiration: Unreal Engine 5 Blueprints, Lucidchart, Node-RED, Scratch
- Consider intermediate representation (IR) before final code generation
- May need type system for connections between nodes

---

*Last updated: March 13, 2026*
