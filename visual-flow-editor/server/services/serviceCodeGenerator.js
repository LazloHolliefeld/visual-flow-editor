// Service code generation orchestrator.
// This file is intentionally thin — each concern lives in its own module:
//   contractNormalizer.js   – contract normalization + sanitizeIdentifier
//   restHandlerGenerator.js – REST Go handler generation
//   graphqlGenerator.js     – GraphQL stub generation
//   grpcGenerator.js        – gRPC + proto stub generation
//   flowCodeGenerator.js    – visual flow canvas → Go code

import { normalizeServiceContracts } from './contractNormalizer.js';
import { generateContractHandlerBlock, escapeGoString } from './restHandlerGenerator.js';
import { generateGraphqlStub } from './graphqlGenerator.js';
import { generateGrpcStub, generateProtoStub } from './grpcGenerator.js';
import { generateFlowHandlerCode } from './flowCodeGenerator.js';

// Re-exported for backward compatibility with index.js and githubService.js callers.
export { generateGoCode, generateReadme } from './flowCodeGenerator.js';

function sanitizeRepoName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unnamed-service';
}

export function generateServiceCode(serviceData, flowNodes, flowEdges, hasDataGateway) {
  const serviceName = serviceData.name || 'service';
  const contracts = normalizeServiceContracts(serviceData);

  const registerLines = ['\tmux.HandleFunc("/health", healthHandler)'];
  const handlerBlocks = [];

  if (contracts.length === 0) {
    registerLines.push('\tmux.HandleFunc("/", mainHandler)');
  } else {
    for (const contract of contracts) {
      registerLines.push(`\tmux.HandleFunc("${escapeGoString(contract.path)}", ${contract.handlerName})`);
      handlerBlocks.push(generateContractHandlerBlock(contract));
    }
  }

  const mainHandlerBlock =
    contracts.length === 0
      ? `
func mainHandler(w http.ResponseWriter, r *http.Request) {
  // Generated from flow
  w.Header().Set("Content-Type", "application/json")

${generateFlowHandlerCode(flowNodes, flowEdges)}
}
`
      : '';

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

${
  hasDataGateway
    ? `
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
`
    : ''
}

func registerHandlers(mux *http.ServeMux) {
${registerLines.join('\n\t')}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

${handlerBlocks.join('\n')}
${mainHandlerBlock}
`;

  const goMod = `module ${sanitizeRepoName(serviceName)}

go 1.21
`;

  return {
    main,
    handlers,
    goMod,
    graphql: generateGraphqlStub(serviceName, contracts),
    grpc: generateGrpcStub(serviceName, contracts),
    proto: generateProtoStub(serviceName, contracts),
  };
}

export function generateServiceReadme(serviceData, flow) {
  const contracts = normalizeServiceContracts(serviceData);
  const endpointLines =
    contracts.length > 0
      ? contracts
          .map((contract) => `- ${contract.method} ${contract.path} - ${contract.description || contract.name}`)
          .join('\n')
      : '- GET /health - Health check\n- * / - Main handler';

  return `# ${serviceData.name || 'Service'}

${serviceData.description || 'Auto-generated API service.'}

## Running

\`\`\`bash
go mod tidy
go run .
\`\`\`

## Endpoints

${endpointLines}

## Contract-Derived Protocols

- REST handlers are generated from saved API contracts
- GraphQL operation stubs: \`graphql.go\`
- gRPC stubs: \`grpc_server.go\` and \`service.proto\`

## Flow

- Nodes: ${flow.nodes?.length || 0}
- Edges: ${flow.edges?.length || 0}
- Contracts: ${flow.apiContracts?.length || serviceData.apiContracts?.length || 0}
`;
}
