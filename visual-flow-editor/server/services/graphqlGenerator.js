// GraphQL stub generation. Derives a GraphQL schema + operation stubs from
// normalized API contracts. Replace this module when upgrading to a real
// GraphQL execution layer (e.g. gqlgen).

import { sanitizeIdentifier } from './contractNormalizer.js';

export function generateGraphqlStub(serviceName, contracts) {
  const operations = contracts
    .map((contract) => {
      const operationType = contract.method === 'GET' ? 'query' : 'mutation';
      const operationName = sanitizeIdentifier(contract.name) || 'operation';
      return `${operationType} ${operationName} {\n  ${operationName}\n}`;
    })
    .join('\n\n');

  return `package main

// Auto-generated GraphQL stubs from API contracts.
// Service: ${serviceName}

const generatedGraphQLSchema = \`
type Query {
  health: String
}

type Mutation {
  noop: String
}
\`

const generatedGraphQLOperations = \`
${operations || '# No contracts defined yet'}
\`
`;
}
