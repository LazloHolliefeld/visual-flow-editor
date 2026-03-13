import express from 'express';
import cors from 'cors';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;
const app = express();
const PORT = 3001;

// Project persistence file
const PROJECT_FILE = path.join(__dirname, 'project.json');
const GENERATED_CODE_DIR = path.join(__dirname, '..', '..', 'flow-generated-code');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Store connections
const connections = new Map();

// Helper to get admin connection (connects to postgres db to create databases)
async function getAdminClient(host, port, password = '') {
  const client = new Client({
    host,
    port,
    database: 'postgres',
    user: 'postgres',
    password: password || process.env.PGPASSWORD || 'postgres',
  });
  await client.connect();
  return client;
}

// Helper to get connection to specific database
async function getDatabaseClient(host, port, database, password = '') {
  const client = new Client({
    host,
    port,
    database,
    user: 'postgres',
    password: password || process.env.PGPASSWORD || 'postgres',
  });
  await client.connect();
  return client;
}

// Test database connection
app.post('/api/db/test-connection', async (req, res) => {
  const { host, port, database } = req.body;
  
  try {
    const client = database 
      ? await getDatabaseClient(host, port, database)
      : await getAdminClient(host, port);
    await client.query('SELECT 1');
    await client.end();
    res.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Create database and tables
app.post('/api/db/create', async (req, res) => {
  const { host, port, database, schema, tables, password } = req.body;
  
  if (!database) {
    return res.json({ success: false, message: 'Database name is required' });
  }
  
  let adminClient;
  let dbClient;
  
  try {
    // Connect to postgres to create database
    adminClient = await getAdminClient(host, port, password);
    
    // Check if database exists
    const dbCheck = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database]
    );
    
    if (dbCheck.rows.length === 0) {
      // Create database
      await adminClient.query(`CREATE DATABASE "${database}"`);
      console.log(`Created database: ${database}`);
    } else {
      console.log(`Database ${database} already exists`);
    }
    
    await adminClient.end();
    
    // Connect to new database to create schema and tables
    dbClient = await getDatabaseClient(host, port, database, password);
    
    // Create schema if not public
    if (schema && schema !== 'public') {
      await dbClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      console.log(`Created schema: ${schema}`);
    }
    
    const schemaPrefix = schema && schema !== 'public' ? `"${schema}".` : '';
    
    // Create tables
    if (tables && tables.length > 0) {
      for (const table of tables) {
        if (!table.name || !table.columns || table.columns.length === 0) {
          continue;
        }
        
        const columnDefs = table.columns
          .filter(col => col.name)
          .map(col => {
            let def = `"${col.name}" ${col.type}`;
            if (col.isPrimaryKey) def += ' PRIMARY KEY';
            if (!col.isNullable && !col.isPrimaryKey) def += ' NOT NULL';
            if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
            return def;
          })
          .join(', ');
        
        if (columnDefs) {
          const createSQL = `CREATE TABLE IF NOT EXISTS ${schemaPrefix}"${table.name}" (${columnDefs})`;
          console.log('Executing:', createSQL);
          await dbClient.query(createSQL);
          console.log(`Created table: ${table.name}`);
        }
      }
    }
    
    await dbClient.end();
    
    const tableCount = tables?.length || 0;
    res.json({ 
      success: true, 
      message: `Database "${database}" created successfully with ${tableCount} table(s)` 
    });
    
  } catch (error) {
    console.error('Database creation error:', error);
    
    if (adminClient) {
      try { await adminClient.end(); } catch (e) {}
    }
    if (dbClient) {
      try { await dbClient.end(); } catch (e) {}
    }
    
    res.json({ success: false, message: error.message });
  }
});

// List databases
app.post('/api/db/list-databases', async (req, res) => {
  const { host, port, password } = req.body;
  
  try {
    const client = await getAdminClient(host, port, password);
    const result = await client.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
    );
    await client.end();
    
    res.json({ 
      success: true, 
      databases: result.rows.map(r => r.datname) 
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// List tables in a database
app.post('/api/db/list-tables', async (req, res) => {
  const { host, port, database, schema, password } = req.body;
  
  try {
    const client = await getDatabaseClient(host, port, database, password);
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema || 'public']
    );
    await client.end();
    
    res.json({ 
      success: true, 
      tables: result.rows.map(r => r.table_name) 
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Execute arbitrary SQL (for generated code testing)
app.post('/api/db/execute', async (req, res) => {
  const { host, port, database, sql, password } = req.body;
  
  try {
    const client = await getDatabaseClient(host, port, database, password);
    const result = await client.query(sql);
    await client.end();
    
    res.json({ 
      success: true, 
      rowCount: result.rowCount,
      rows: result.rows
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ===== PROJECT PERSISTENCE =====

// Save project state
app.post('/api/project/save', async (req, res) => {
  const { nodes, edges } = req.body;
  
  try {
    const projectData = {
      version: '1.0',
      savedAt: new Date().toISOString(),
      nodes,
      edges,
    };
    
    fs.writeFileSync(PROJECT_FILE, JSON.stringify(projectData, null, 2));
    res.json({ success: true, message: 'Project saved successfully' });
  } catch (error) {
    console.error('Save error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Load project state
app.get('/api/project/load', async (req, res) => {
  try {
    if (fs.existsSync(PROJECT_FILE)) {
      const data = fs.readFileSync(PROJECT_FILE, 'utf-8');
      const projectData = JSON.parse(data);
      res.json({ success: true, ...projectData });
    } else {
      res.json({ success: false, message: 'No saved project found' });
    }
  } catch (error) {
    console.error('Load error:', error);
    res.json({ success: false, message: error.message });
  }
});

// ===== CODE GENERATION =====

// Generate Go code from flow
app.post('/api/generate/go', async (req, res) => {
  const { nodes, edges } = req.body;
  
  try {
    const goCode = generateGoCode(nodes, edges);
    const dbSchemas = extractDatabaseSchemas(nodes);
    
    res.json({ 
      success: true, 
      code: goCode,
      schemas: dbSchemas,
    });
  } catch (error) {
    console.error('Code generation error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Generate and push to GitHub
app.post('/api/generate/push-to-github', async (req, res) => {
  const { nodes, edges, repoUrl, commitMessage } = req.body;
  
  try {
    // Create output directory
    if (!fs.existsSync(GENERATED_CODE_DIR)) {
      fs.mkdirSync(GENERATED_CODE_DIR, { recursive: true });
    }
    
    // Generate Go code
    const goCode = generateGoCode(nodes, edges);
    const dbSchemas = extractDatabaseSchemas(nodes);
    
    // Write main.go
    fs.writeFileSync(path.join(GENERATED_CODE_DIR, 'main.go'), goCode);
    
    // Write database schema SQL files
    const schemaDir = path.join(GENERATED_CODE_DIR, 'database');
    if (dbSchemas.length > 0) {
      if (!fs.existsSync(schemaDir)) {
        fs.mkdirSync(schemaDir, { recursive: true });
      }
      
      // Write individual schema files
      for (const schema of dbSchemas) {
        const filename = `${schema.database}_schema.sql`;
        fs.writeFileSync(path.join(schemaDir, filename), schema.sql);
      }
      
      // Write combined setup script
      const setupSql = dbSchemas.map(s => s.sql).join('\n\n');
      fs.writeFileSync(path.join(schemaDir, 'setup.sql'), setupSql);
    }
    
    // Write go.mod
    const goMod = `module flow-generated-code

go 1.21

require (
	github.com/lib/pq v1.10.9
)
`;
    fs.writeFileSync(path.join(GENERATED_CODE_DIR, 'go.mod'), goMod);
    
    // Write README
    const readme = generateReadme(nodes, dbSchemas);
    fs.writeFileSync(path.join(GENERATED_CODE_DIR, 'README.md'), readme);
    
    // Write project metadata
    const metadata = {
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      databases: dbSchemas.map(s => s.database),
    };
    fs.writeFileSync(path.join(GENERATED_CODE_DIR, 'flow-metadata.json'), JSON.stringify(metadata, null, 2));
    
    // Initialize git repo if needed and push
    const gitResult = await pushToGitHub(GENERATED_CODE_DIR, repoUrl, commitMessage || 'Update generated code');
    
    res.json({ 
      success: true, 
      message: 'Code generated and pushed to GitHub',
      files: ['main.go', 'go.mod', 'README.md', 'flow-metadata.json', ...dbSchemas.map(s => `database/${s.database}_schema.sql`)],
      gitOutput: gitResult,
    });
  } catch (error) {
    console.error('Push to GitHub error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Helper: Generate Go code from flow nodes
function generateGoCode(nodes, edges) {
  const dbNodes = nodes.filter(n => n.type === 'database' && n.data?.database);
  const actionNodes = nodes.filter(n => n.type === 'action');
  const decisionNodes = nodes.filter(n => n.type === 'decision');
  const loopNodes = nodes.filter(n => n.type === 'loop');
  const apiNodes = nodes.filter(n => n.type === 'apiCall');
  
  // Build adjacency map for flow traversal
  const adjacency = {};
  for (const edge of edges) {
    if (!adjacency[edge.source]) adjacency[edge.source] = [];
    adjacency[edge.source].push({ target: edge.target, label: edge.label, sourceHandle: edge.sourceHandle });
  }
  
  const nodeMap = {};
  for (const node of nodes) {
    nodeMap[node.id] = node;
  }
  
  let code = `package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	_ "github.com/lib/pq"
)

`;

  // Generate database connection helpers
  if (dbNodes.length > 0) {
    code += `// Database connections\nvar dbConnections = make(map[string]*sql.DB)\n\n`;
    
    code += `func initDatabases() {\n`;
    for (const dbNode of dbNodes) {
      const d = dbNode.data;
      const connName = sanitizeIdentifier(d.database);
      code += `	// Connect to ${d.database}\n`;
      code += `	connStr := fmt.Sprintf("host=%s port=%d dbname=%s user=postgres sslmode=disable", "${d.host}", ${d.port}, "${d.database}")\n`;
      code += `	db, err := sql.Open("postgres", connStr)\n`;
      code += `	if err != nil {\n		log.Fatalf("Failed to connect to ${d.database}: %v", err)\n	}\n`;
      code += `	dbConnections["${connName}"] = db\n\n`;
    }
    code += `}\n\n`;
  }
  
  // Generate API call helpers
  if (apiNodes.length > 0) {
    code += `// API call helper\nfunc callAPI(method, url string, body io.Reader) ([]byte, error) {\n`;
    code += `	req, err := http.NewRequest(method, url, body)\n`;
    code += `	if err != nil {\n		return nil, err\n	}\n`;
    code += `	req.Header.Set("Content-Type", "application/json")\n`;
    code += `	\n	client := &http.Client{}\n`;
    code += `	resp, err := client.Do(req)\n`;
    code += `	if err != nil {\n		return nil, err\n	}\n`;
    code += `	defer resp.Body.Close()\n`;
    code += `	return io.ReadAll(resp.Body)\n}\n\n`;
  }
  
  // Find start node
  const startNode = nodes.find(n => n.type === 'startEnd' && n.data?.type === 'start');
  
  // Generate main function with flow logic
  code += `func main() {\n`;
  code += `	fmt.Println("Starting flow execution...")\n\n`;
  
  if (dbNodes.length > 0) {
    code += `	// Initialize database connections\n`;
    code += `	initDatabases()\n`;
    code += `	defer func() {\n		for _, db := range dbConnections {\n			db.Close()\n		}\n	}()\n\n`;
  }
  
  // Generate flow execution code by traversing from start
  if (startNode) {
    code += generateFlowCode(startNode.id, adjacency, nodeMap, new Set(), 1);
  }
  
  code += `\n	fmt.Println("Flow execution completed.")\n`;
  code += `}\n`;
  
  return code;
}

// Helper: Generate code for flow traversal
function generateFlowCode(nodeId, adjacency, nodeMap, visited, indent) {
  if (visited.has(nodeId)) return '';
  visited.add(nodeId);
  
  const node = nodeMap[nodeId];
  if (!node) return '';
  
  const tabs = '\t'.repeat(indent);
  let code = '';
  
  switch (node.type) {
    case 'startEnd':
      if (node.data?.type === 'start') {
        code += `${tabs}// Start\n`;
      } else {
        code += `${tabs}// End\n`;
        return code;
      }
      break;
      
    case 'action':
      code += `${tabs}// Action: ${node.data?.label || 'Unnamed'}\n`;
      if (node.data?.code) {
        // Convert simple assignments to Go syntax
        const goCode = convertToGoSyntax(node.data.code);
        code += `${tabs}${goCode}\n`;
      }
      break;
      
    case 'decision':
      const condition = node.data?.condition || 'true';
      code += `${tabs}// Decision: ${node.data?.label || 'IF'}\n`;
      code += `${tabs}if ${condition} {\n`;
      
      // Find true branch
      const trueBranch = (adjacency[nodeId] || []).find(e => e.sourceHandle === 'true' || e.label === 'Yes');
      if (trueBranch) {
        code += generateFlowCode(trueBranch.target, adjacency, nodeMap, new Set(visited), indent + 1);
      }
      code += `${tabs}}`;
      
      // Find false branch
      const falseBranch = (adjacency[nodeId] || []).find(e => e.sourceHandle === 'false' || e.label === 'No');
      if (falseBranch) {
        code += ` else {\n`;
        code += generateFlowCode(falseBranch.target, adjacency, nodeMap, new Set(visited), indent + 1);
        code += `${tabs}}`;
      }
      code += '\n';
      return code; // Don't continue normal flow after decision
      
    case 'loop':
      const loopCondition = node.data?.condition || 'i := 0; i < 10; i++';
      code += `${tabs}// Loop: ${node.data?.label || 'Loop'}\n`;
      
      // Check if it's a range-based loop
      if (loopCondition.includes(' in ')) {
        const [item, collection] = loopCondition.split(' in ').map(s => s.trim());
        code += `${tabs}for _, ${item} := range ${collection} {\n`;
      } else {
        code += `${tabs}for ${loopCondition} {\n`;
      }
      
      // Loop body would be connected nodes
      const loopBody = (adjacency[nodeId] || []).find(e => e.sourceHandle === 'loop');
      if (loopBody) {
        code += generateFlowCode(loopBody.target, adjacency, nodeMap, new Set(visited), indent + 1);
      }
      code += `${tabs}}\n`;
      break;
      
    case 'apiCall':
      code += `${tabs}// API Call: ${node.data?.label || 'API'}\n`;
      code += `${tabs}apiResp, err := callAPI("${node.data?.method || 'GET'}", "${node.data?.url || ''}", nil)\n`;
      code += `${tabs}if err != nil {\n${tabs}\tlog.Printf("API call failed: %v", err)\n${tabs}} else {\n`;
      code += `${tabs}\tlog.Printf("API response: %s", string(apiResp))\n${tabs}}\n`;
      break;
      
    case 'database':
      code += `${tabs}// Database: ${node.data?.database || 'Unknown'}\n`;
      code += `${tabs}db := dbConnections["${sanitizeIdentifier(node.data?.database || '')}"]\n`;
      code += `${tabs}_ = db // Database ready for queries\n`;
      break;
  }
  
  // Continue to next node(s)
  const nextEdges = adjacency[nodeId] || [];
  for (const edge of nextEdges) {
    if (!edge.sourceHandle || (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false' && edge.sourceHandle !== 'loop')) {
      code += generateFlowCode(edge.target, adjacency, nodeMap, visited, indent);
    }
  }
  
  return code;
}

// Helper: Convert pseudo-code to Go syntax
function convertToGoSyntax(code) {
  // Handle simple variable assignments
  return code.replace(/=/g, ':=').replace(/:=:=/g, '==');
}

// Helper: Sanitize identifier for Go
function sanitizeIdentifier(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

// Helper: Extract database schemas from nodes
function extractDatabaseSchemas(nodes) {
  const schemas = [];
  const dbNodes = nodes.filter(n => n.type === 'database' && n.data?.database);
  
  for (const node of dbNodes) {
    const d = node.data;
    let sql = `-- Database: ${d.database}\n`;
    sql += `-- Generated from Visual Flow Editor\n`;
    sql += `-- Host: ${d.host}:${d.port}\n\n`;
    
    sql += `-- Create database (run as superuser)\n`;
    sql += `-- CREATE DATABASE "${d.database}";\n\n`;
    
    sql += `\\connect "${d.database}"\n\n`;
    
    if (d.schema && d.schema !== 'public') {
      sql += `CREATE SCHEMA IF NOT EXISTS "${d.schema}";\n\n`;
    }
    
    const schemaPrefix = d.schema && d.schema !== 'public' ? `"${d.schema}".` : '';
    
    if (d.tables && d.tables.length > 0) {
      for (const table of d.tables) {
        if (!table.name || !table.columns || table.columns.length === 0) continue;
        
        sql += `-- Table: ${table.name}\n`;
        sql += `CREATE TABLE IF NOT EXISTS ${schemaPrefix}"${table.name}" (\n`;
        
        const columnDefs = table.columns
          .filter(col => col.name)
          .map(col => {
            let def = `  "${col.name}" ${col.type}`;
            if (col.isPrimaryKey) def += ' PRIMARY KEY';
            if (!col.isNullable && !col.isPrimaryKey) def += ' NOT NULL';
            if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
            return def;
          });
        
        sql += columnDefs.join(',\n');
        sql += `\n);\n\n`;
      }
    }
    
    schemas.push({
      database: d.database,
      schema: d.schema || 'public',
      host: d.host,
      port: d.port,
      sql,
    });
  }
  
  return schemas;
}

// Helper: Generate README
function generateReadme(nodes, dbSchemas) {
  let readme = `# Generated Flow Code

This code was automatically generated from the Visual Flow Editor.

## Overview

- **Generated:** ${new Date().toISOString()}
- **Total Nodes:** ${nodes.length}
- **Database Connections:** ${dbSchemas.length}

## Running the Code

1. Install dependencies:
   \`\`\`bash
   go mod tidy
   \`\`\`

2. Set up databases (if any):
   \`\`\`bash
   # Run the setup script for each database
   psql -U postgres -f database/setup.sql
   \`\`\`

3. Run the application:
   \`\`\`bash
   go run main.go
   \`\`\`

## Databases

`;

  if (dbSchemas.length > 0) {
    for (const schema of dbSchemas) {
      readme += `### ${schema.database}\n\n`;
      readme += `- **Host:** ${schema.host}:${schema.port}\n`;
      readme += `- **Schema:** ${schema.schema}\n`;
      readme += `- **Setup file:** \`database/${schema.database}_schema.sql\`\n\n`;
    }
  } else {
    readme += `No database connections configured.\n\n`;
  }

  readme += `## Node Types Used

`;

  const nodeTypeCounts = {};
  for (const node of nodes) {
    nodeTypeCounts[node.type] = (nodeTypeCounts[node.type] || 0) + 1;
  }
  
  for (const [type, count] of Object.entries(nodeTypeCounts)) {
    readme += `- **${type}:** ${count}\n`;
  }

  return readme;
}

// Helper: Push to GitHub
async function pushToGitHub(dir, repoUrl, message) {
  return new Promise((resolve, reject) => {
    const commands = [];
    
    // Initialize git if needed
    if (!fs.existsSync(path.join(dir, '.git'))) {
      commands.push(`cd "${dir}" && git init`);
      commands.push(`cd "${dir}" && git remote add origin ${repoUrl}`);
    }
    
    commands.push(`cd "${dir}" && git add -A`);
    commands.push(`cd "${dir}" && git commit -m "${message}" --allow-empty`);
    commands.push(`cd "${dir}" && git push -u origin master --force`);
    
    const fullCommand = commands.join(' && ');
    
    exec(fullCommand, { shell: 'cmd.exe' }, (error, stdout, stderr) => {
      if (error) {
        // Check if it's just "nothing to commit"
        if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
          resolve('No changes to commit');
        } else {
          reject(new Error(stderr || error.message));
        }
      } else {
        resolve(stdout + stderr);
      }
    });
  });
}

app.listen(PORT, () => {
  console.log(`Visual Flow Editor API server running on http://localhost:${PORT}`);
});
