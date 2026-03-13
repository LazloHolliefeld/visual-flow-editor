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

// Drop database
app.post('/api/db/drop', async (req, res) => {
  const { host, port, database, password } = req.body;
  
  if (!database || database === 'postgres') {
    return res.json({ success: false, message: 'Cannot drop postgres or empty database name' });
  }
  
  try {
    const client = await getAdminClient(host, port, password);
    
    // Terminate active connections to this database
    await client.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()
    `, [database]);
    
    // Drop the database
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    await client.end();
    
    console.log(`Dropped database: ${database}`);
    res.json({ success: true, message: `Database "${database}" dropped successfully` });
  } catch (error) {
    console.error('Drop database error:', error);
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

// Save project state (new structure with serviceFlows)
app.post('/api/project/save', async (req, res) => {
  const { projectData } = req.body;
  
  try {
    const data = {
      version: '2.0',
      savedAt: new Date().toISOString(),
      projectData: projectData || { projectNodes: [], projectEdges: [], serviceFlows: {} },
    };
    
    fs.writeFileSync(PROJECT_FILE, JSON.stringify(data, null, 2));
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
      const saved = JSON.parse(data);
      
      // Handle both old and new formats
      if (saved.projectData) {
        res.json({ success: true, projectData: saved.projectData });
      } else if (saved.nodes) {
        // Migrate old format
        res.json({ 
          success: true, 
          projectData: {
            projectNodes: saved.nodes,
            projectEdges: saved.edges || [],
            serviceFlows: {},
          }
        });
      } else {
        res.json({ success: false, message: 'Invalid project format' });
      }
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

// ===== NEW: Generate and push to per-service repos =====
app.post('/api/generate/push-all', async (req, res) => {
  const { projectData, githubUsername } = req.body;
  
  if (!projectData) {
    return res.json({ success: false, message: 'No project data provided' });
  }
  
  const { projectNodes, projectEdges, serviceFlows } = projectData;
  const repos = [];
  
  try {
    // Get database nodes
    const dbNodes = projectNodes.filter(n => n.type === 'database' && n.data?.database);
    const serviceNodes = projectNodes.filter(n => n.type === 'service' && n.data?.name);
    
    // Generate DataGateway if there are databases
    if (dbNodes.length > 0) {
      const gatewayDir = path.join(__dirname, '..', '..', 'datagateway');
      if (!fs.existsSync(gatewayDir)) fs.mkdirSync(gatewayDir, { recursive: true });
      
      // Generate DataGateway code (REST, gRPC, GraphQL)
      const gatewayCode = generateDataGateway(dbNodes);
      const dbSchemas = extractDatabaseSchemas(projectNodes);
      
      // Write files
      fs.writeFileSync(path.join(gatewayDir, 'main.go'), gatewayCode.main);
      fs.writeFileSync(path.join(gatewayDir, 'handlers.go'), gatewayCode.handlers);
      fs.writeFileSync(path.join(gatewayDir, 'grpc_server.go'), gatewayCode.grpc);
      fs.writeFileSync(path.join(gatewayDir, 'graphql.go'), gatewayCode.graphql);
      fs.writeFileSync(path.join(gatewayDir, 'go.mod'), gatewayCode.goMod);
      fs.writeFileSync(path.join(gatewayDir, 'README.md'), generateDataGatewayReadme(dbNodes));
      
      // Database schemas
      const schemaDir = path.join(gatewayDir, 'database');
      if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true });
      for (const schema of dbSchemas) {
        fs.writeFileSync(path.join(schemaDir, `${schema.database}_schema.sql`), schema.sql);
      }
      
      // Push to GitHub
      const repoUrl = `https://github.com/${githubUsername}/datagateway.git`;
      await ensureGitHubRepo(githubUsername, 'datagateway');
      await pushToGitHub(gatewayDir, repoUrl, 'Update DataGateway');
      repos.push({ name: 'datagateway', url: repoUrl });
    }
    
    // Generate each service
    for (const serviceNode of serviceNodes) {
      const serviceName = sanitizeRepoName(serviceNode.data.name);
      const serviceDir = path.join(__dirname, '..', '..', serviceName);
      if (!fs.existsSync(serviceDir)) fs.mkdirSync(serviceDir, { recursive: true });
      
      // Get service flow
      const flow = serviceFlows[serviceNode.id] || { nodes: [], edges: [] };
      
      // Generate service code
      const serviceCode = generateServiceCode(serviceNode.data, flow.nodes, flow.edges, dbNodes.length > 0);
      
      // Write files
      fs.writeFileSync(path.join(serviceDir, 'main.go'), serviceCode.main);
      fs.writeFileSync(path.join(serviceDir, 'handlers.go'), serviceCode.handlers);
      fs.writeFileSync(path.join(serviceDir, 'go.mod'), serviceCode.goMod);
      fs.writeFileSync(path.join(serviceDir, 'README.md'), generateServiceReadme(serviceNode.data, flow));
      
      // Push to GitHub
      const repoUrl = `https://github.com/${githubUsername}/${serviceName}.git`;
      await ensureGitHubRepo(githubUsername, serviceName);
      await pushToGitHub(serviceDir, repoUrl, `Update ${serviceName}`);
      repos.push({ name: serviceName, url: repoUrl });
    }
    
    res.json({
      success: true,
      message: `Generated and pushed ${repos.length} repo(s)`,
      repos,
    });
  } catch (error) {
    console.error('Push all error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Helper: Ensure GitHub repo exists
async function ensureGitHubRepo(username, repoName) {
  return new Promise((resolve, reject) => {
    exec(`gh repo view ${username}/${repoName}`, { shell: 'cmd.exe' }, (error) => {
      if (error) {
        // Repo doesn't exist, create it
        exec(`gh repo create ${repoName} --public --confirm`, { shell: 'cmd.exe' }, (err, stdout, stderr) => {
          if (err && !stderr.includes('already exists')) {
            console.error(`Failed to create repo ${repoName}:`, stderr);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// Helper: Sanitize repo name
function sanitizeRepoName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed-service';
}

// Helper: Generate DataGateway code
function generateDataGateway(dbNodes) {
  const databases = dbNodes.map(n => n.data);
  
  const main = `package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	// Initialize database connections
	initDB()
	defer closeDB()
	
	// Start gRPC server in background
	go startGRPCServer()
	
	// Start GraphQL server
	go startGraphQLServer()
	
	// REST API routes
	mux := http.NewServeMux()
	registerRoutes(mux)
	
	fmt.Printf("DataGateway starting on :%s\\n", port)
	fmt.Printf("  REST:    http://localhost:%s/api/\\n", port)
	fmt.Printf("  gRPC:    localhost:50051\\n")
	fmt.Printf("  GraphQL: http://localhost:8081/graphql\\n")
	
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
`;

  const handlers = `package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	
	_ "github.com/lib/pq"
)

var dbConnections = make(map[string]*sql.DB)

func initDB() {
${databases.map(db => `
	// Connect to ${db.database}
	connStr${sanitizeIdentifier(db.database)} := fmt.Sprintf("host=${db.host} port=${db.port} dbname=${db.database} user=postgres sslmode=disable")
	db${sanitizeIdentifier(db.database)}, err := sql.Open("postgres", connStr${sanitizeIdentifier(db.database)})
	if err != nil {
		log.Printf("Warning: Failed to connect to ${db.database}: %v", err)
	} else {
		dbConnections["${db.database}"] = db${sanitizeIdentifier(db.database)}
	}
`).join('')}
}

func closeDB() {
	for _, db := range dbConnections {
		db.Close()
	}
}

func registerRoutes(mux *http.ServeMux) {
${databases.flatMap(db => (db.tables || []).map(table => `
	// ${db.database}.${table.name} CRUD
	mux.HandleFunc("/api/${db.database}/${table.name}", handle${sanitizeIdentifier(db.database)}${sanitizeIdentifier(table.name)})
	mux.HandleFunc("/api/${db.database}/${table.name}/", handle${sanitizeIdentifier(db.database)}${sanitizeIdentifier(table.name)}ByID)
`)).join('')}
}

${databases.flatMap(db => (db.tables || []).map(table => {
  const tableName = table.name;
  const dbName = db.database;
  const funcName = sanitizeIdentifier(dbName) + sanitizeIdentifier(tableName);
  const columns = (table.columns || []).filter(c => c.name);
  
  return `
// Handle ${dbName}.${tableName}
func handle${funcName}(w http.ResponseWriter, r *http.Request) {
	db := dbConnections["${dbName}"]
	if db == nil {
		http.Error(w, "Database not connected", http.StatusServiceUnavailable)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	
	switch r.Method {
	case "GET":
		rows, err := db.Query("SELECT ${columns.map(c => '"' + c.name + '"').join(', ')} FROM ${tableName}")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		
		var results []map[string]interface{}
		cols, _ := rows.Columns()
		for rows.Next() {
			columns := make([]interface{}, len(cols))
			columnPointers := make([]interface{}, len(cols))
			for i := range columns {
				columnPointers[i] = &columns[i]
			}
			rows.Scan(columnPointers...)
			m := make(map[string]interface{})
			for i, colName := range cols {
				m[colName] = columns[i]
			}
			results = append(results, m)
		}
		json.NewEncoder(w).Encode(results)
		
	case "POST":
		var data map[string]interface{}
		json.NewDecoder(r.Body).Decode(&data)
		
		columns := []string{}
		values := []interface{}{}
		placeholders := []string{}
		i := 1
		for k, v := range data {
			columns = append(columns, "\\""+k+"\\"")
			values = append(values, v)
			placeholders = append(placeholders, fmt.Sprintf("$%d", i))
			i++
		}
		
		query := fmt.Sprintf("INSERT INTO ${tableName} (%s) VALUES (%s) RETURNING *",
			strings.Join(columns, ","), strings.Join(placeholders, ","))
		
		row := db.QueryRow(query, values...)
		result := make(map[string]interface{})
		// Simplified - real impl would scan properly
		json.NewEncoder(w).Encode(map[string]string{"status": "created"})
		_ = row
		_ = result
		
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handle${funcName}ByID(w http.ResponseWriter, r *http.Request) {
	db := dbConnections["${dbName}"]
	if db == nil {
		http.Error(w, "Database not connected", http.StatusServiceUnavailable)
		return
	}
	
	// Extract ID from path
	parts := strings.Split(r.URL.Path, "/")
	id := parts[len(parts)-1]
	
	w.Header().Set("Content-Type", "application/json")
	
	switch r.Method {
	case "GET":
		row := db.QueryRow("SELECT ${columns.map(c => '"' + c.name + '"').join(', ')} FROM ${tableName} WHERE id = $1", id)
		result := make(map[string]interface{})
		// Scan row...
		json.NewEncoder(w).Encode(result)
		_ = row
		
	case "PUT":
		var data map[string]interface{}
		json.NewDecoder(r.Body).Decode(&data)
		// Update logic...
		json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
		
	case "DELETE":
		db.Exec("DELETE FROM ${tableName} WHERE id = $1", id)
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
		
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
`;
})).join('')}
`;

  const grpc = `package main

import (
	"log"
	"net"
	
	"google.golang.org/grpc"
)

func startGRPCServer() {
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Printf("Failed to start gRPC server: %v", err)
		return
	}
	
	server := grpc.NewServer()
	// Register services here
	
	log.Printf("gRPC server listening on :50051")
	if err := server.Serve(lis); err != nil {
		log.Printf("gRPC server error: %v", err)
	}
}
`;

  const graphql = `package main

import (
	"encoding/json"
	"log"
	"net/http"
	
	"github.com/graphql-go/graphql"
)

func startGraphQLServer() {
	schema, err := graphql.NewSchema(graphql.SchemaConfig{
		Query: graphql.NewObject(graphql.ObjectConfig{
			Name: "Query",
			Fields: graphql.Fields{
				"health": &graphql.Field{
					Type: graphql.String,
					Resolve: func(p graphql.ResolveParams) (interface{}, error) {
						return "ok", nil
					},
				},
				// Add more query fields for each table
			},
		}),
	})
	
	if err != nil {
		log.Printf("Failed to create GraphQL schema: %v", err)
		return
	}
	
	http.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
		var params struct {
			Query string \`json:"query"\`
		}
		json.NewDecoder(r.Body).Decode(&params)
		
		result := graphql.Do(graphql.Params{
			Schema:        schema,
			RequestString: params.Query,
		})
		
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})
	
	log.Printf("GraphQL server listening on :8081")
	http.ListenAndServe(":8081", nil)
}
`;

  const goMod = `module datagateway

go 1.21

require (
	github.com/lib/pq v1.10.9
	github.com/graphql-go/graphql v0.8.1
	google.golang.org/grpc v1.59.0
)
`;

  return { main, handlers, grpc, graphql, goMod };
}

// Helper: Generate DataGateway README
function generateDataGatewayReadme(dbNodes) {
  return `# DataGateway

Auto-generated data access layer with REST, gRPC, and GraphQL support.

## Databases

${dbNodes.map(n => `- **${n.data.database}** (${n.data.host}:${n.data.port})`).join('\n')}

## Running

\`\`\`bash
go mod tidy
go run .
\`\`\`

## Endpoints

- REST: http://localhost:8080/api/
- gRPC: localhost:50051
- GraphQL: http://localhost:8081/graphql

## REST API

${dbNodes.flatMap(n => (n.data.tables || []).map(t => `
### ${t.name}
- GET /api/${n.data.database}/${t.name} - List all
- GET /api/${n.data.database}/${t.name}/:id - Get by ID
- POST /api/${n.data.database}/${t.name} - Create
- PUT /api/${n.data.database}/${t.name}/:id - Update
- DELETE /api/${n.data.database}/${t.name}/:id - Delete
`)).join('')}
`;
}

// Helper: Generate service code
function generateServiceCode(serviceData, flowNodes, flowEdges, hasDataGateway) {
  const serviceName = serviceData.name || 'service';
  
  const main = `package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	mux := http.NewServeMux()
	registerHandlers(mux)
	
	fmt.Printf("${serviceName} starting on :%s\\n", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
`;

  const handlers = `package main

import (
	"encoding/json"
	"io"
	"net/http"
)

${hasDataGateway ? `
const dataGatewayURL = "http://localhost:8080"

func callDataGateway(method, path string, body io.Reader) ([]byte, error) {
	req, err := http.NewRequest(method, dataGatewayURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
` : ''}

func registerHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/", mainHandler)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func mainHandler(w http.ResponseWriter, r *http.Request) {
	// Generated from flow
	w.Header().Set("Content-Type", "application/json")
	
${generateFlowHandlerCode(flowNodes, flowEdges)}
}
`;

  const goMod = `module ${sanitizeRepoName(serviceName)}

go 1.21
`;

  return { main, handlers, goMod };
}

// Helper: Generate flow handler code
function generateFlowHandlerCode(nodes, edges) {
  if (!nodes || nodes.length === 0) {
    return '\tjson.NewEncoder(w).Encode(map[string]string{"message": "Service ready"})';
  }
  
  // Simple flow translation
  let code = '';
  for (const node of nodes) {
    if (node.type === 'action' && node.data?.code) {
      code += `\t// ${node.data.label || 'Action'}\n`;
      code += `\t${node.data.code.replace(/=/g, ':=')}\n\n`;
    }
  }
  code += '\tjson.NewEncoder(w).Encode(map[string]string{"message": "Flow executed"})';
  return code;
}

// Helper: Generate service README
function generateServiceReadme(serviceData, flow) {
  return `# ${serviceData.name || 'Service'}

${serviceData.description || 'Auto-generated API service.'}

## Running

\`\`\`bash
go mod tidy
go run .
\`\`\`

## Endpoints

- GET /health - Health check
- * / - Main handler

## Flow

- Nodes: ${flow.nodes?.length || 0}
- Edges: ${flow.edges?.length || 0}
`;
}

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
