import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';

export type LoopNodeData = {
  label: string;
  condition?: string;
};

export type LoopNodeType = Node<LoopNodeData, 'loop'>;

export function LoopNode({ data }: NodeProps<LoopNodeType>) {
  return (
    <div className="loop-node">
      <Handle type="target" position={Position.Top} />
      <div className="hexagon-shape">
        <div className="node-label">{data.label || 'Loop'}</div>
        {data.condition && <div className="node-condition">{data.condition}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} id="body" style={{ left: '50%' }} />
      <Handle type="source" position={Position.Right} id="exit" />
    </div>
  );
}
