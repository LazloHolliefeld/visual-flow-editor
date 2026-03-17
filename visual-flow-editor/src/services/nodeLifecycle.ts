import type { Edge, Node } from '@xyflow/react';
import type { ServiceNodeData } from '../nodes/ServiceNode';
import type { DatabaseNodeData } from '../nodes/DatabaseNode';
import type { ApiContract } from '../types/apiContract';

export type ProjectGraphData = {
  projectName?: string;
  projectNodes: Node[];
  projectEdges: Edge[];
  serviceFlows: Record<string, { nodes: Node[]; edges: Edge[]; apiContracts?: ApiContract[] }>;
};

export type CallbackBinderDeps = {
  openDbConfigById: (nodeId: string) => void;
  openServiceConfigById: (nodeId: string) => void;
  confirmDeleteNode: (nodeId: string, nodeType: string) => void;
  drillIntoService: (serviceId: string, serviceName: string) => void;
  openDataGatewayDetails: () => void;
  onRunDataGateway?: () => void;
  onStopDataGateway?: () => void;
  isDataGatewayRunning?: boolean;
  dataGatewayUrls?: { rest?: string; grpc?: string; graphql?: string } | null;
};

export type ProjectNodeFactoryDeps = {
  openDbConfigById: (nodeId: string) => void;
  openServiceConfigById: (nodeId: string) => void;
  confirmDeleteNode: (nodeId: string, nodeType: string) => void;
  drillIntoService: (serviceId: string, serviceName: string) => void;
};

export type DatabaseDropPayload = {
  host?: string;
  port?: number;
  password?: string;
  database: string;
};

const CALLBACK_KEYS = [
  'onConfigure',
  'onDelete',
  'onDrillDown',
  'onViewDetails',
  'onRun',
  'onStop',
] as const;

export const PROJECT_CANVAS_NODE_TYPES = ['database', 'service', 'dataGateway'] as const;
export const SERVICE_CANVAS_NODE_TYPES = ['request', 'action', 'decision', 'loop', 'apiCall', 'startEnd'] as const;

export function isProjectCanvasNodeType(type: string | undefined): boolean {
  return PROJECT_CANVAS_NODE_TYPES.includes((type || '') as (typeof PROJECT_CANVAS_NODE_TYPES)[number]);
}

export function isServiceCanvasNodeType(type: string | undefined): boolean {
  return SERVICE_CANVAS_NODE_TYPES.includes((type || '') as (typeof SERVICE_CANVAS_NODE_TYPES)[number]);
}

export function getDefaultNodeData(type: string): Record<string, unknown> {
  switch (type) {
    case 'startEnd':
      return { label: 'Start', type: 'start' };
    case 'action':
      return { label: 'Action', code: '' };
    case 'decision':
      return { label: 'IF', condition: '' };
    case 'loop':
      return { label: 'Loop', condition: '' };
    case 'apiCall':
      return { label: 'API Call', url: '', method: 'GET' };
    case 'database':
      return { label: 'Database', host: 'localhost', port: 5432, password: '', database: '', schema: 'public', tables: [] };
    default:
      return { label: 'Node' };
  }
}

export function stripNodeCallbacks(node: Node): Node {
  const data = { ...(node.data as Record<string, unknown>) };
  for (const key of CALLBACK_KEYS) {
    data[key] = undefined;
  }
  return { ...node, data };
}

export function filterProjectCanvasNodes(nodes: Node[]): Node[] {
  return nodes.filter((node) => isProjectCanvasNodeType(node.type));
}

export function filterServiceCanvasNodes(nodes: Node[]): Node[] {
  return nodes.filter((node) => isServiceCanvasNodeType(node.type));
}

export function attachProjectNodeCallbacks(node: Node, deps: CallbackBinderDeps): Node {
  if (node.type === 'database') {
    return {
      ...node,
      data: {
        ...node.data,
        onConfigure: () => deps.openDbConfigById(node.id),
        onDelete: () => deps.confirmDeleteNode(node.id, 'database'),
      },
    };
  }

  if (node.type === 'service') {
    const serviceData = node.data as unknown as ServiceNodeData;
    return {
      ...node,
      data: {
        ...node.data,
        onConfigure: () => deps.openServiceConfigById(node.id),
        onDrillDown: () => deps.drillIntoService(node.id, serviceData.name),
        onDelete: () => deps.confirmDeleteNode(node.id, 'service'),
      },
    };
  }

  if (node.type === 'dataGateway') {
    return {
      ...node,
      data: {
        ...node.data,
        onViewDetails: deps.openDataGatewayDetails,
        isRunning: deps.isDataGatewayRunning ?? false,
        runUrls: deps.dataGatewayUrls ?? null,
        onRun: deps.onRunDataGateway ?? (() => {}),
        onStop: deps.onStopDataGateway ?? (() => {}),
      },
    };
  }

  return node;
}

export function removeNodeFromProjectData(
  projectData: ProjectGraphData,
  nodeId: string,
  nodeType: string
): ProjectGraphData {
  return {
    ...projectData,
    projectNodes: projectData.projectNodes.filter((n) => n.id !== nodeId),
    projectEdges: projectData.projectEdges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    serviceFlows:
      nodeType === 'service'
        ? Object.fromEntries(Object.entries(projectData.serviceFlows).filter(([k]) => k !== nodeId))
        : projectData.serviceFlows,
  };
}

export function createProjectNode(
  type: string,
  nodeId: string,
  position: { x: number; y: number },
  deps: ProjectNodeFactoryDeps
): Node {
  if (type === 'database') {
    return {
      id: nodeId,
      type: 'database',
      position,
      data: {
        label: 'Database',
        host: 'localhost',
        port: 5432,
        password: '',
        database: '',
        schema: 'public',
        tables: [],
        onConfigure: () => deps.openDbConfigById(nodeId),
        onDelete: () => deps.confirmDeleteNode(nodeId, 'database'),
      },
    };
  }

  if (type === 'service') {
    return {
      id: nodeId,
      type: 'service',
      position,
      data: {
        label: 'New API',
        name: '',
        description: '',
        onConfigure: () => deps.openServiceConfigById(nodeId),
        onDrillDown: () => deps.drillIntoService(nodeId, 'API'),
        onDelete: () => deps.confirmDeleteNode(nodeId, 'service'),
      },
    };
  }

  return {
    id: nodeId,
    type,
    position,
    data: getDefaultNodeData(type),
  };
}

export function createServiceCanvasNode(
  type: string,
  nodeId: string,
  position: { x: number; y: number }
): Node {
  return {
    id: nodeId,
    type,
    position,
    data: getDefaultNodeData(type),
  };
}

export function getDatabaseDropPayload(node: Node): DatabaseDropPayload | null {
  if (node.type !== 'database') return null;

  const data = node.data as DatabaseNodeData;
  const database = (data.database || '').trim();
  if (!database || database === 'postgres') return null;

  return {
    host: data.host || 'localhost',
    port: data.port || 5432,
    password: data.password || '',
    database,
  };
}

export function getProjectNodeDeletionTargets(projectData: ProjectGraphData): Array<{ id: string; type: string }> {
  return projectData.projectNodes.map((node) => ({
    id: node.id,
    type: node.type || 'node',
  }));
}
