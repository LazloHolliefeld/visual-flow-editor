import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';

export interface DataGatewayNodeData {
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
  onViewDetails?: () => void;
}

export type DataGatewayNodeType = Node<DataGatewayNodeData, 'dataGateway'>;

export const DataGatewayNode = memo(function DataGatewayNode({ data }: NodeProps<DataGatewayNodeType>) {
  const dbCount = data.databases?.length || 0;
  const tableCount = data.databases?.reduce((acc, db) => acc + (db.tables?.length || 0), 0) || 0;
  
  const protocols = [];
  if (data.protocols?.rest) protocols.push('REST');
  if (data.protocols?.grpc) protocols.push('gRPC');
  if (data.protocols?.graphql) protocols.push('GraphQL');

  return (
    <div 
      className="datagateway-node"
      onDoubleClick={() => data.onViewDetails?.()}
      title="Auto-generated DataGateway (read-only)"
    >
      <Handle type="target" position={Position.Top} />
      
      <div className="datagateway-header">
        <span className="datagateway-icon">🗄️</span>
        <span className="datagateway-name">DataGateway</span>
        <span className="datagateway-badge">AUTO</span>
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
      
      <div className="datagateway-footer">
        <span className="readonly-notice">🔒 Auto-generated</span>
      </div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
