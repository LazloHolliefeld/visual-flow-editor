import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';

export type TableDefinition = {
  name: string;
  columns: {
    name: string;
    type: string;
    isPrimaryKey?: boolean;
    isNullable?: boolean;
    defaultValue?: string;
  }[];
};

export type DatabaseNodeData = {
  label: string;
  connectionName?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  tables?: TableDefinition[];
  onConfigure?: () => void;
};

export type DatabaseNodeType = Node<DatabaseNodeData, 'database'>;

export function DatabaseNode({ data }: NodeProps<DatabaseNodeType>) {
  return (
    <div className="database-node" onDoubleClick={data.onConfigure}>
      <Handle type="target" position={Position.Top} />
      <div className="cylinder-shape">
        <div className="cylinder-top"></div>
        <div className="cylinder-body">
          <div className="node-label">{data.label || 'Database'}</div>
          {data.database && (
            <div className="node-detail">{data.database}</div>
          )}
          {data.tables && data.tables.length > 0 && (
            <div className="node-detail">{data.tables.length} table(s)</div>
          )}
        </div>
        <div className="cylinder-bottom"></div>
      </div>
      <div className="config-hint">Double-click to configure</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
