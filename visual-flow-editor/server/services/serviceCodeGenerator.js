// Service and flow code generation helpers.

export function generateServiceCode(serviceData, flowNodes, flowEdges, hasDataGateway) {
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

function generateFlowHandlerCode(nodes, edges) {
  if (!nodes || nodes.length === 0) {
    return '\tjson.NewEncoder(w).Encode(map[string]string{"message": "Service ready"})';
  }

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

export function generateServiceReadme(serviceData, flow) {
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

export function generateGoCode(nodes, edges) {
  const dbNodes = nodes.filter((n) => n.type === 'database' && n.data?.database);
  const apiNodes = nodes.filter((n) => n.type === 'apiCall');

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

  if (dbNodes.length > 0) {
    code += '// Database connections\nvar dbConnections = make(map[string]*sql.DB)\n\n';

    code += 'func initDatabases() {\n';
    for (const dbNode of dbNodes) {
      const d = dbNode.data;
      const connName = sanitizeIdentifier(d.database);
      code += `\t// Connect to ${d.database}\n`;
      code += `\tconnStr := fmt.Sprintf("host=%s port=%d dbname=%s user=postgres sslmode=disable", "${d.host}", ${d.port}, "${d.database}")\n`;
      code += '\tdb, err := sql.Open("postgres", connStr)\n';
      code += `\tif err != nil {\n\t\tlog.Fatalf("Failed to connect to ${d.database}: %v", err)\n\t}\n`;
      code += `\tdbConnections["${connName}"] = db\n\n`;
    }
    code += '}\n\n';
  }

  if (apiNodes.length > 0) {
    code += '// API call helper\nfunc callAPI(method, url string, body io.Reader) ([]byte, error) {\n';
    code += '\treq, err := http.NewRequest(method, url, body)\n';
    code += '\tif err != nil {\n\t\treturn nil, err\n\t}\n';
    code += '\treq.Header.Set("Content-Type", "application/json")\n';
    code += '\t\n\tclient := &http.Client{}\n';
    code += '\tresp, err := client.Do(req)\n';
    code += '\tif err != nil {\n\t\treturn nil, err\n\t}\n';
    code += '\tdefer resp.Body.Close()\n';
    code += '\treturn io.ReadAll(resp.Body)\n}\n\n';
  }

  const startNode = nodes.find((n) => n.type === 'startEnd' && n.data?.type === 'start');

  code += 'func main() {\n';
  code += '\tfmt.Println("Starting flow execution...")\n\n';

  if (dbNodes.length > 0) {
    code += '\t// Initialize database connections\n';
    code += '\tinitDatabases()\n';
    code += '\tdefer func() {\n\t\tfor _, db := range dbConnections {\n\t\t\tdb.Close()\n\t\t}\n\t}()\n\n';
  }

  if (startNode) {
    code += generateFlowCode(startNode.id, adjacency, nodeMap, new Set(), 1);
  }

  code += '\n\tfmt.Println("Flow execution completed.")\n';
  code += '}\n';

  return code;
}

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
        const goCode = convertToGoSyntax(node.data.code);
        code += `${tabs}${goCode}\n`;
      }
      break;

    case 'decision': {
      const condition = node.data?.condition || 'true';
      code += `${tabs}// Decision: ${node.data?.label || 'IF'}\n`;
      code += `${tabs}if ${condition} {\n`;

      const trueBranch = (adjacency[nodeId] || []).find((e) => e.sourceHandle === 'true' || e.label === 'Yes');
      if (trueBranch) {
        code += generateFlowCode(trueBranch.target, adjacency, nodeMap, new Set(visited), indent + 1);
      }
      code += `${tabs}}`;

      const falseBranch = (adjacency[nodeId] || []).find((e) => e.sourceHandle === 'false' || e.label === 'No');
      if (falseBranch) {
        code += ' else {\n';
        code += generateFlowCode(falseBranch.target, adjacency, nodeMap, new Set(visited), indent + 1);
        code += `${tabs}}`;
      }
      code += '\n';
      return code;
    }

    case 'loop': {
      const loopCondition = node.data?.condition || 'i := 0; i < 10; i++';
      code += `${tabs}// Loop: ${node.data?.label || 'Loop'}\n`;

      if (loopCondition.includes(' in ')) {
        const [item, collection] = loopCondition.split(' in ').map((s) => s.trim());
        code += `${tabs}for _, ${item} := range ${collection} {\n`;
      } else {
        code += `${tabs}for ${loopCondition} {\n`;
      }

      const loopBody = (adjacency[nodeId] || []).find((e) => e.sourceHandle === 'loop');
      if (loopBody) {
        code += generateFlowCode(loopBody.target, adjacency, nodeMap, new Set(visited), indent + 1);
      }
      code += `${tabs}}\n`;
      break;
    }

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

  const nextEdges = adjacency[nodeId] || [];
  for (const edge of nextEdges) {
    if (!edge.sourceHandle || (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false' && edge.sourceHandle !== 'loop')) {
      code += generateFlowCode(edge.target, adjacency, nodeMap, visited, indent);
    }
  }

  return code;
}

function convertToGoSyntax(code) {
  return code.replace(/=/g, ':=').replace(/:=:=/g, '==');
}

function sanitizeIdentifier(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

function sanitizeRepoName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed-service';
}

export function generateReadme(nodes, dbSchemas) {
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
    readme += 'No database connections configured.\n\n';
  }

  readme += '## Node Types Used\n\n';

  const nodeTypeCounts = {};
  for (const node of nodes) {
    nodeTypeCounts[node.type] = (nodeTypeCounts[node.type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(nodeTypeCounts)) {
    readme += `- **${type}:** ${count}\n`;
  }

  return readme;
}
