import { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';

export interface DataGatewayNodeData {
  [key: string]: unknown;
  label: string;
  databases: Array<{
    name: string;
    host: string;
    port: number;
    tables: Array<{
      name: string;
      columns: Array<{ name: string; type: string }>;
    }>;
  }>;
  protocols: {
    rest: boolean;
    grpc: boolean;
    graphql: boolean;
  };
  repoUrl?: string;
  isRunning?: boolean;
  runUrls?: {
    rest?: string;
    grpc?: string;
    graphql?: string;
  };
  onViewDetails?: () => void;
  onRun?: () => void;
  onStop?: () => void;
}

export type DataGatewayNodeType = Node<DataGatewayNodeData, 'dataGateway'>;

export const DataGatewayNode = memo(function DataGatewayNode({ data }: NodeProps<DataGatewayNodeType>) {
  const [showUrls, setShowUrls] = useState(false);
  
  const dbCount = data.databases?.length || 0;
  const tableCount = data.databases?.reduce((acc, db) => acc + (db.tables?.length || 0), 0) || 0;
  
  const protocols = [];
  if (data.protocols?.rest) protocols.push('REST');
  if (data.protocols?.grpc) protocols.push('gRPC');
  if (data.protocols?.graphql) protocols.push('GraphQL');

  const handleRunClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.isRunning) {
      data.onStop?.();
    } else {
      data.onRun?.();
    }
  };

  return (
    <div 
      className={`datagateway-node ${data.isRunning ? 'running' : ''}`}
      onDoubleClick={() => data.onViewDetails?.()}
      title="Auto-generated DataGateway (read-only)"
    >
      <Handle type="target" position={Position.Top} />
      
      <div className="datagateway-header">
        <span className="datagateway-icon">🗄️</span>
        <span className="datagateway-name">DataGateway</span>
        {data.isRunning ? (
          <span className="datagateway-badge running">LIVE</span>
        ) : (
          <span className="datagateway-badge">AUTO</span>
        )}
      </div>
      
      <div className="datagateway-stats">
        <div className="stat-row">
          <span className="stat-icon">💾</span>
          <span>{dbCount} database{dbCount !== 1 ? 's' : ''}</span>
        </div>
        <div className="stat-row">
          <span className="stat-icon">📋</span>
          <span>{tableCount} table{tableCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      
      <div className="datagateway-protocols">
        {protocols.map((p) => (
          <span key={p} className="protocol-badge">{p}</span>
        ))}
      </div>
      
      {/* Run/Stop Button */}
      <div className="datagateway-actions">
        <button
          className={`run-btn ${data.isRunning ? 'stop' : ''}`}
          onClick={handleRunClick}
          title={data.isRunning ? 'Stop server' : 'Run server locally'}
        >
          {data.isRunning ? '⏹️ Stop' : '▶️ Run'}
        </button>
        {data.isRunning && (
          <button
            className="urls-btn"
            onClick={(e) => { e.stopPropagation(); setShowUrls(!showUrls); }}
            title="Show API URLs"
          >
            🔗
          </button>
        )}
      </div>
      
      {/* URLs Dropdown */}
      {data.isRunning && showUrls && data.runUrls && (
        <div className="datagateway-urls">
          {data.runUrls.rest && (
            <div className="url-row">
              <span className="url-label">REST:</span>
              <a href={data.runUrls.rest} target="_blank" rel="noopener noreferrer">
                {data.runUrls.rest}
              </a>
            </div>
          )}
          {data.runUrls.grpc && (
            <div className="url-row">
              <span className="url-label">gRPC:</span>
              <span>{data.runUrls.grpc}</span>
            </div>
          )}
          {data.runUrls.graphql && (
            <div className="url-row">
              <span className="url-label">GraphQL:</span>
              <a href={data.runUrls.graphql} target="_blank" rel="noopener noreferrer">
                {data.runUrls.graphql}
              </a>
            </div>
          )}
        </div>
      )}
      
      <div className="datagateway-footer">
        <span className="readonly-notice">
          {data.isRunning ? '🟢 Running locally' : '🔒 Auto-generated'}
        </span>
      </div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
