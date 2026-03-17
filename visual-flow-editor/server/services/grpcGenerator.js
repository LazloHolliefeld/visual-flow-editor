// gRPC stub and Protobuf definition generation. Derives stubs + .proto from
// normalized API contracts. Replace this module when wiring in a real gRPC
// implementation (e.g. buf + grpc-go).

import { sanitizeIdentifier } from './contractNormalizer.js';

export function generateGrpcStub(serviceName, contracts) {
  const methods = contracts
    .map(
      (contract) =>
        `// RPC stub for ${contract.method} ${contract.path}\nfunc ${sanitizeIdentifier(contract.name)}RPCStub() {}`,
    )
    .join('\n\n');

  return `package main

// Auto-generated gRPC stubs from API contracts.
// Service: ${serviceName}

${methods || '// No contracts defined yet'}
`;
}

export function generateProtoStub(serviceName, contracts) {
  const serviceType = sanitizeIdentifier(serviceName) || 'Service';

  const rpcLines = contracts
    .map((contract) => {
      const rpcName = sanitizeIdentifier(contract.name) || 'Operation';
      return `  rpc ${rpcName} (${rpcName}Request) returns (${rpcName}Response);`;
    })
    .join('\n');

  const messageBlocks = contracts
    .map((contract) => {
      const rpcName = sanitizeIdentifier(contract.name) || 'Operation';
      const reqFields = buildProtoFields(contract.requestFields);
      const resFields = buildProtoFields(contract.responseFields);
      return (
        `message ${rpcName}Request {\n${reqFields || '  string placeholder = 1;'}\n}\n\n` +
        `message ${rpcName}Response {\n${resFields || '  bool success = 1;'}\n}`
      );
    })
    .join('\n\n');

  return `syntax = "proto3";

package ${serviceType.toLowerCase()};

service ${serviceType}Api {
${rpcLines || '  rpc Health (HealthRequest) returns (HealthResponse);'}
}

${messageBlocks || 'message HealthRequest {}\n\nmessage HealthResponse {\n  string status = 1;\n}'}
`;
}

function buildProtoFields(fields) {
  const list = Array.isArray(fields) ? fields.filter((field) => field?.name) : [];
  return list
    .map((field, index) => `  ${mapProtoType(field.type)} ${sanitizeIdentifier(field.name) || `field_${index + 1}`} = ${index + 1};`)
    .join('\n');
}

function mapProtoType(typeName) {
  const normalized = String(typeName || '').toLowerCase();
  if (normalized === 'int') return 'int64';
  if (normalized === 'float') return 'double';
  if (normalized === 'bool' || normalized === 'boolean') return 'bool';
  if (normalized === 'array') return 'repeated string';
  if (normalized === 'object') return 'string';
  return 'string';
}
