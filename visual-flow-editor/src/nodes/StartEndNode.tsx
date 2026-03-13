import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';

export type StartEndNodeData = {
  label: string;
  type: 'start' | 'end';
};

export type StartEndNodeType = Node<StartEndNodeData, 'startEnd'>;

export function StartEndNode({ data }: NodeProps<StartEndNodeType>) {
  const isStart = data.type === 'start';
  
  return (
    <div className={`start-end-node ${data.type}`}>
      <div className="oval-shape">
        <div className="node-label">{data.label || (isStart ? 'Start' : 'End')}</div>
      </div>
      {isStart ? (
        <Handle type="source" position={Position.Bottom} />
      ) : (
        <Handle type="target" position={Position.Top} />
      )}
    </div>
  );
}
