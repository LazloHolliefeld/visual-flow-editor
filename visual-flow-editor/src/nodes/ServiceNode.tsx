import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';

export interface ServiceNodeData {
  label: string;
  name: string;
  description?: string;
  repoUrl?: string;
  endpoints?: Array<{
    method: string;
    path: string;
    description?: string;
  }>;
  onDrillDown?: () => void;
  onDelete?: () => void;
  onConfigure?: () => void;
}

export type ServiceNodeType = Node<ServiceNodeData, 'service'>;

export const ServiceNode = memo(function ServiceNode({ data }: NodeProps<ServiceNodeType>) {
  const handleDoubleClick = () => {
    if (data.onDrillDown) {
      data.onDrillDown();
    }
  };

  const endpointCount = data.endpoints?.length || 0;

  return (
    <div 
      className="service-node"
      onDoubleClick={handleDoubleClick}
      title="Double-click to edit API logic"
    >
      <Handle type="target" position={Position.Top} />
      
      <div className="service-node-header">
        <span className="service-icon">🔌</span>
        <span className="service-name">{data.name || data.label || 'API Service'}</span>
      </div>
      
      {data.description && (
        <div className="service-description">{data.description}</div>
      )}
      
      <div className="service-stats">
        <span className="endpoint-count">{endpointCount} endpoint{endpointCount !== 1 ? 's' : ''}</span>
      </div>
      
      <div className="service-actions">
        {data.onConfigure && (
          <button 
            className="service-btn" 
            onClick={(e) => { e.stopPropagation(); data.onConfigure?.(); }}
            title="Configure"
          >
            ⚙️
          </button>
        )}
        {data.onDelete && (
          <button 
            className="service-btn service-btn-delete" 
            onClick={(e) => { e.stopPropagation(); data.onDelete?.(); }}
            title="Delete"
          >
            🗑️
          </button>
        )}
      </div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
