import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';

export interface ActionNodeData {
  [key: string]: unknown;
  label: string;
  code?: string;
}

export type ActionNodeType = Node<ActionNodeData, 'action'>;

export const ActionNode = memo(function ActionNode({ data }: NodeProps<ActionNodeType>) {
  return (
    <div className="action-node">
      <Handle type="target" position={Position.Top} />
      <div className="rectangle-shape">
        <div className="node-label">{data.label || 'Action'}</div>
        {data.code && <div className="node-code">{data.code}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
