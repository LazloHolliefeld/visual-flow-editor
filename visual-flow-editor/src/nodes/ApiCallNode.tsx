import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';

export type ApiCallNodeData = {
  label: string;
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
};

export type ApiCallNodeType = Node<ApiCallNodeData, 'apiCall'>;

export function ApiCallNode({ data }: NodeProps<ApiCallNodeType>) {
  return (
    <div className="api-call-node">
      <Handle type="target" position={Position.Top} />
      <div className="parallelogram-shape">
        <div className="node-label">{data.label || 'API Call'}</div>
        {data.url && <div className="node-url">{data.method || 'GET'} {data.url}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
