import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { ApiContract } from '../types/apiContract';

export interface RequestNodeData {
  [key: string]: unknown;
  contract: ApiContract;
  onEdit?: () => void;
}

export type RequestNodeType = Node<RequestNodeData, 'request'>;

export const RequestNode = memo(function RequestNode({ data }: NodeProps<RequestNodeType>) {
  const contract = data.contract as ApiContract;
  if (!contract) return null;

  const methodColors: Record<string, string> = {
    GET: '#3498db',
    POST: '#2ecc71',
    PUT: '#f39c12',
    PATCH: '#9b59b6',
    DELETE: '#e74c3c',
  };

  const methodColor = methodColors[contract.method] || '#95a5a6';

  return (
    <div className="request-node">
      <Handle type="source" position={Position.Bottom} />

      <div className="request-node-header">
        <span className="request-icon">📨</span>
        <span className="request-method" style={{ backgroundColor: methodColor }}>
          {contract.method}
        </span>
      </div>

      <div className="request-node-path">
        <code>{contract.path}</code>
      </div>

      {contract.name && <div className="request-node-name">{contract.name}</div>}

      {contract.description && <div className="request-node-description">{contract.description}</div>}

      <div className="request-node-fields">
        {contract.requestFields && contract.requestFields.length > 0 && (
          <div className="fields-section">
            <div className="fields-label">Request Fields: {contract.requestFields.length}</div>
          </div>
        )}
      </div>

      {data.onEdit && (
        <button
          className="request-edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            data.onEdit?.();
          }}
          title="Edit contract"
        >
          ✏️
        </button>
      )}
    </div>
  );
});
