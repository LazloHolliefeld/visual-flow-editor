import type { DataGatewayNodeData } from '../nodes/DataGatewayNode';

interface DataGatewayViewModalProps {
  isOpen: boolean;
  data: DataGatewayNodeData;
  onClose: () => void;
}

export function DataGatewayViewModal({
  isOpen,
  data,
  onClose,
}: DataGatewayViewModalProps) {
  if (!isOpen) return null;

  const generateEndpointList = () => {
    const endpoints: Array<{ method: string; path: string; description: string }> = [];
    
    for (const db of data.databases || []) {
      for (const table of db.tables || []) {
        const tableName = table.name;
        const basePath = `/api/${db.name}/${tableName}`;
        
        endpoints.push(
          { method: 'GET', path: basePath, description: `List all ${tableName}` },
          { method: 'GET', path: `${basePath}/:id`, description: `Get ${tableName} by ID` },
          { method: 'POST', path: basePath, description: `Create new ${tableName}` },
          { method: 'PUT', path: `${basePath}/:id`, description: `Update ${tableName}` },
          { method: 'DELETE', path: `${basePath}/:id`, description: `Delete ${tableName}` },
        );
      }
    }
    
    return endpoints;
  };

  const endpoints = generateEndpointList();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content datagateway-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🗄️ DataGateway (Auto-Generated)</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="info-box warning">
            <strong>🔒 Read-Only:</strong> This API is auto-generated from your database schemas. 
            It cannot be edited directly. Add or modify databases to update it.
          </div>

          <h3>Available Protocols</h3>
          <div className="protocol-list">
            {data.protocols?.rest && <span className="protocol-badge large">REST</span>}
            {data.protocols?.grpc && <span className="protocol-badge large">gRPC</span>}
            {data.protocols?.graphql && <span className="protocol-badge large">GraphQL</span>}
          </div>

          <h3>Connected Databases</h3>
          <div className="database-list">
            {(data.databases || []).map((db, i) => (
              <div key={i} className="database-item">
                <div className="database-header">
                  <strong>💾 {db.name}</strong>
                  <span className="db-host">{db.host}:{db.port}</span>
                </div>
                <div className="table-list">
                  {(db.tables || []).map((table, j) => (
                    <div key={j} className="table-item">
                      <span className="table-name">📋 {table.name}</span>
                      <span className="column-count">{table.columns?.length || 0} columns</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <h3>REST Endpoints</h3>
          <div className="endpoint-list">
            {endpoints.length === 0 ? (
              <p className="empty-message">No endpoints yet. Add a database with tables to generate endpoints.</p>
            ) : (
              endpoints.map((ep, i) => (
                <div key={i} className="endpoint-item">
                  <span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                  <code className="endpoint-path">{ep.path}</code>
                  <span className="endpoint-desc">{ep.description}</span>
                </div>
              ))
            )}
          </div>

          <h3>GraphQL Schema (Preview)</h3>
          <pre className="code-preview">
{`type Query {
${(data.databases || []).flatMap(db => 
  (db.tables || []).map(t => 
    `  ${t.name}s: [${t.name}!]!\n  ${t.name}(id: ID!): ${t.name}`
  )
).join('\n')}
}

type Mutation {
${(data.databases || []).flatMap(db => 
  (db.tables || []).map(t => 
    `  create${t.name}(input: ${t.name}Input!): ${t.name}!\n  update${t.name}(id: ID!, input: ${t.name}Input!): ${t.name}!\n  delete${t.name}(id: ID!): Boolean!`
  )
).join('\n')}
}`}
          </pre>
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
