export { DecisionNode } from './DecisionNode';
export { ActionNode } from './ActionNode';
export { StartEndNode } from './StartEndNode';
export { ApiCallNode } from './ApiCallNode';
export { LoopNode } from './LoopNode';
export { DatabaseNode } from './DatabaseNode';
export { ServiceNode } from './ServiceNode';
export { DataGatewayNode } from './DataGatewayNode';

export type { DecisionNodeData, DecisionNodeType } from './DecisionNode';
export type { ActionNodeData, ActionNodeType } from './ActionNode';
export type { StartEndNodeData, StartEndNodeType } from './StartEndNode';
export type { ApiCallNodeData, ApiCallNodeType } from './ApiCallNode';
export type { LoopNodeData, LoopNodeType } from './LoopNode';
export type { DatabaseNodeData, DatabaseNodeType, TableDefinition } from './DatabaseNode';
export type { ServiceNodeData, ServiceNodeType } from './ServiceNode';
export type { DataGatewayNodeData, DataGatewayNodeType } from './DataGatewayNode';

import { DecisionNode } from './DecisionNode';
import { ActionNode } from './ActionNode';
import { StartEndNode } from './StartEndNode';
import { ApiCallNode } from './ApiCallNode';
import { LoopNode } from './LoopNode';
import { DatabaseNode } from './DatabaseNode';
import { ServiceNode } from './ServiceNode';
import { DataGatewayNode } from './DataGatewayNode';

export const nodeTypes = {
  decision: DecisionNode,
  action: ActionNode,
  startEnd: StartEndNode,
  apiCall: ApiCallNode,
  loop: LoopNode,
  database: DatabaseNode,
  service: ServiceNode,
  dataGateway: DataGatewayNode,
};
