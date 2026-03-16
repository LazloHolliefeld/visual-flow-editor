import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';

export interface DecisionNodeData {
  [key: string]: unknown;
  label: string;
  condition?: string;
}

export type DecisionNodeType = Node<DecisionNodeData, 'decision'>;

export const DecisionNode = memo(function DecisionNode({ data }: NodeProps<DecisionNodeType>) {
  return (
    <div className="decision-node">
      <Handle type="target" position={Position.Top} />
      <div className="diamond-shape">
        <div className="node-content">
          <div className="node-label">{data.label || 'IF'}</div>
          {data.condition && <div className="node-condition">{data.condition}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: '25%' }} />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: '75%' }} />
    </div>
  );
});
