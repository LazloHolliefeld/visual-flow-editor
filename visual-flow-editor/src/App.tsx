import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeTypes,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './nodes';
import type { DatabaseNodeData, RequestNodeData } from './nodes';
import type { ServiceNodeData } from './nodes/ServiceNode';
import type { ApiContract } from './types/apiContract';
import type { DataGatewayNodeData } from './nodes/DataGatewayNode';
import { DatabaseConfigModal } from './components/DatabaseConfigModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ServiceConfigModal } from './components/ServiceConfigModal';
import { DataGatewayViewModal } from './components/DataGatewayViewModal';
import { ApiRequestBuilderModal } from './components/ApiRequestBuilderModal';
import {
  attachProjectNodeCallbacks,
  createServiceCanvasNode,
  createProjectNode,
  filterProjectCanvasNodes,
  filterServiceCanvasNodes,
  getDatabaseDropPayload,
  getProjectNodeDeletionTargets,
  getDefaultNodeData,
  isProjectCanvasNodeType,
  isServiceCanvasNodeType,
  removeNodeFromProjectData,
  stripNodeCallbacks,
} from './services/nodeLifecycle';
import './App.css';

const API_BASE = 'http://localhost:3001';
const GITHUB_USERNAME = 'LazloHolliefeld';

// Canvas context types
interface CanvasContext {
  type: 'project' | 'service';
  serviceId?: string;
  serviceName?: string;
}

// Project data structure
interface ProjectData {
  projectName?: string;
  // Project-level nodes (databases, services, datagateway)
  projectNodes: Node[];
  projectEdges: Edge[];
  // Per-service flow data
  serviceFlows: Record<string, { nodes: Node[]; edges: Edge[]; apiContracts?: ApiContract[] }>;
}

const EMPTY_PROJECT: ProjectData = {
  projectName: 'project',
  projectNodes: [],
  projectEdges: [],
  serviceFlows: {},
};

const DATAGATEWAY_NODE_ID = 'dataGateway';
const DATAGATEWAY_EDGE_PREFIX = 'db-to-datagateway:';
function isManagedDataGatewayEdge(edge: Edge): boolean {
  return edge.id.startsWith(DATAGATEWAY_EDGE_PREFIX);
}

function buildManagedDataGatewayEdges(dbNodes: Node[]): Edge[] {
  return dbNodes.map((dbNode) => ({
    id: `${DATAGATEWAY_EDGE_PREFIX}${dbNode.id}`,
    source: dbNode.id,
    target: DATAGATEWAY_NODE_ID,
    animated: true,
    label: 'feeds schema',
  }));
}

function mergeWithManagedDataGatewayEdges(existingEdges: Edge[], managedEdges: Edge[]): Edge[] {
  return [...existingEdges.filter((edge) => !isManagedDataGatewayEdge(edge)), ...managedEdges];
}

function filterProjectLevelEdges(projectNodes: Node[], allEdges: Edge[]): Edge[] {
  const projectNodeIds = new Set(projectNodes.map((node) => node.id));
  return allEdges.filter((edge) => projectNodeIds.has(edge.source) && projectNodeIds.has(edge.target));
}

function App() {
  // Canvas context - where we are
  const [canvasContext, setCanvasContext] = useState<CanvasContext>({ type: 'project' });
  
  // Project data
  const [projectData, setProjectData] = useState<ProjectData>(EMPTY_PROJECT);
  
  // Memoized database signature for tracking changes (count + content hash)
  // This ensures DataGateway updates when tables/columns change, not just when DBs are added/removed
  const databaseSignature = useMemo(() => {
    const dbNodes = projectData.projectNodes.filter((n) => n.type === 'database');
    return JSON.stringify(dbNodes.map(n => {
      const d = n.data as DatabaseNodeData;
      return { db: d.database, tables: d.tables?.map(t => ({ name: t.name, cols: t.columns?.length })) };
    }));
  }, [projectData.projectNodes]);
  
  // Current view data
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  
  // Modal states
  const [selectedDbNode, setSelectedDbNode] = useState<string | null>(null);
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  const [selectedServiceNode, setSelectedServiceNode] = useState<string | null>(null);
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isDataGatewayModalOpen, setIsDataGatewayModalOpen] = useState(false);
  const [isApiRequestModalOpen, setIsApiRequestModalOpen] = useState(false);
  
  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmStyle?: 'danger' | 'primary';
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  
  // Status states
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  
  // DataGateway running state
  const [isDataGatewayRunning, setIsDataGatewayRunning] = useState(false);
  const [dataGatewayUrls, setDataGatewayUrls] = useState<{ rest?: string; grpc?: string; graphql?: string } | null>(null);

  const currentProjectName = useMemo(() => {
    const raw = String(projectData.projectName || '').trim();
    return raw || 'project';
  }, [projectData.projectName]);
  
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);

  const buildProjectDataWithDbUpdate = useCallback((data: DatabaseNodeData): ProjectData => {
    if (!selectedDbNode) return projectData;

    const updateNodeData = (node: Node) => {
      if (node.id !== selectedDbNode) return node;
      return {
        ...node,
        data: { ...data },
      };
    };

    return {
      ...projectData,
      projectNodes: projectData.projectNodes.map(updateNodeData),
    };
  }, [selectedDbNode, projectData]);

  const restartDataGatewayIfRunning = useCallback(async (projectSnapshot: ProjectData) => {
    if (!isDataGatewayRunning) return;

    try {
      await fetch(`${API_BASE}/api/server/stop-datagateway`, { method: 'POST' });

      const dataToSend = stripCallbacks(projectSnapshot);
      const response = await fetch(`${API_BASE}/api/server/start-datagateway`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectData: dataToSend }),
      });
      const result = await response.json();

      if (result.success) {
        setIsDataGatewayRunning(true);
        setDataGatewayUrls(result.urls);
      } else {
        setIsDataGatewayRunning(false);
        setDataGatewayUrls(null);
        alert(`Failed to restart DataGateway after DB change: ${result.message}`);
      }
    } catch (error) {
      setIsDataGatewayRunning(false);
      setDataGatewayUrls(null);
      alert(`Error restarting DataGateway after DB change: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }, [isDataGatewayRunning]);

  // DataGateway Run/Stop handlers (defined early for use in effects)
  const handleRunDataGateway = useCallback(async () => {
    try {
      const dataToSend = stripCallbacks(projectData);
      const response = await fetch(`${API_BASE}/api/server/start-datagateway`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectData: dataToSend }),
      });
      const result = await response.json();
      if (result.success) {
        setIsDataGatewayRunning(true);
        setDataGatewayUrls(result.urls);
      } else {
        alert(`Failed to start DataGateway: ${result.message}`);
      }
    } catch (error) {
      alert(`Error starting DataGateway: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }, [projectData]);

  const handleStopDataGateway = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/server/stop-datagateway`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        setIsDataGatewayRunning(false);
        setDataGatewayUrls(null);
      }
    } catch (error) {
      console.error('Error stopping DataGateway:', error);
    }
  }, []);

  // Generate request nodes from APIcontracts
  const generateRequestNodesFromContracts = useCallback((contracts: ApiContract[]): Node<RequestNodeData>[] => {
    const requestNodes: Node<RequestNodeData>[] = [];
    const contractsToUse = contracts || [];

    for (let i = 0; i < contractsToUse.length; i++) {
      const contract = contractsToUse[i];
      const nodeId = `request-${contract.id}`;

      requestNodes.push({
        id: nodeId,
        type: 'request',
        position: { x: 50 + i * 220, y: 50 },
        data: {
          contract,
          onEdit: () => setIsApiRequestModalOpen(true),
        } as RequestNodeData,
      });
    }

    return requestNodes;
  }, []);

  // Keep canvas state in sync with loaded/saved project data and current context.
  useEffect(() => {
    if (canvasContext.type === 'project') {
      const projectNodes = filterProjectCanvasNodes(projectData.projectNodes);
      const projectEdges = filterProjectLevelEdges(projectNodes, projectData.projectEdges);
      setNodes(projectNodes);
      setEdges(projectEdges);
    } else if (canvasContext.serviceId) {
      const flow = projectData.serviceFlows[canvasContext.serviceId] || { nodes: [], edges: [], apiContracts: [] };
      const requestNodes = generateRequestNodesFromContracts(flow.apiContracts || []);
      const flowNodes = filterServiceCanvasNodes(flow.nodes).filter((node) => node.type !== 'request');
      const allNodes = [...requestNodes, ...flowNodes];
      setNodes(allNodes);
      setEdges(flow.edges);
    }
  }, [canvasContext, projectData, generateRequestNodesFromContracts]);

  // Sync current nodes/edges back to project data
  const syncToProjectData = useCallback((newNodes: Node[], newEdges: Edge[]) => {
    setProjectData((prev) => {
      if (canvasContext.type === 'project') {
        const projectNodes = filterProjectCanvasNodes(newNodes);
        const projectEdges = filterProjectLevelEdges(projectNodes, newEdges);

        if (projectNodes.length !== newNodes.length) {
          console.warn('[project-sync] filtered non-project nodes from project canvas state', {
            droppedNodeTypes: newNodes.filter((node) => !isProjectCanvasNodeType(node.type)).map((node) => node.type),
          });
        }

        return { ...prev, projectNodes, projectEdges };
      } else if (canvasContext.serviceId) {
        const persistedNodes = filterServiceCanvasNodes(newNodes).filter((n) => n.type !== 'request');
        const existingFlow = prev.serviceFlows[canvasContext.serviceId] || { nodes: [], edges: [], apiContracts: [] };
        return {
          ...prev,
          serviceFlows: {
            ...prev.serviceFlows,
            [canvasContext.serviceId]: {
              ...existingFlow,
              nodes: persistedNodes,
              edges: newEdges,
            },
          },
        };
      }
      return prev;
    });
  }, [canvasContext]);

  // Load project on startup
  useEffect(() => {
    const loadProject = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/project/load`);
        const data = await response.json();
        
        if (data.success && data.projectData) {
          // Restore callbacks for nodes
          const restored = restoreNodeCallbacks(data.projectData);
          setProjectData(restored);
          console.log('Loaded project');
        }
      } catch (error) {
        console.error('Failed to load project:', error);
      } finally {
        setIsLoading(false);
        setTimeout(() => {
          isInitialLoadRef.current = false;
        }, 500);
      }
    };
    
    loadProject();
  }, []);

  // Restore callbacks to nodes after loading
  const restoreNodeCallbacks = (data: ProjectData): ProjectData => {
    const restoreProjectNodes = data.projectNodes.map((node: Node) =>
      attachProjectNodeCallbacks(node, {
        openDbConfigById,
        openServiceConfigById,
        confirmDeleteNode,
        drillIntoService,
        openDataGatewayDetails: () => setIsDataGatewayModalOpen(true),
        onRunDataGateway: handleRunDataGateway,
        onStopDataGateway: handleStopDataGateway,
        isDataGatewayRunning,
        dataGatewayUrls,
      })
    );
    
    return { ...data, projectNodes: restoreProjectNodes };
  };

  // Immediate save function for critical actions
  const saveProjectImmediately = useCallback(async (data: ProjectData) => {
    try {
      setSaveStatus('saving');
      const dataToSave = stripCallbacks(data);
      dataToSave.projectNodes = filterProjectCanvasNodes(dataToSave.projectNodes);
      dataToSave.projectEdges = filterProjectLevelEdges(dataToSave.projectNodes, dataToSave.projectEdges);
      dataToSave.serviceFlows = Object.fromEntries(
        Object.entries(dataToSave.serviceFlows).map(([serviceId, flow]) => [
          serviceId,
          {
            ...flow,
            nodes: filterServiceCanvasNodes(flow.nodes).filter((node) => node.type !== 'request'),
          },
        ])
      );

      console.log('[project-save]', {
        projectNodeTypes: dataToSave.projectNodes.map((node) => node.type),
        projectNodeCount: dataToSave.projectNodes.length,
        serviceFlowIds: Object.keys(dataToSave.serviceFlows),
      });
      
      const response = await fetch(`${API_BASE}/api/project/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectData: dataToSave }),
      });
      
      const result = await response.json();
      setSaveStatus(result.success ? 'saved' : 'error');
      if (!result.success) {
        console.error('Save failed:', result.message);
      }
      return result.success;
    } catch (error) {
      console.error('Failed to save:', error);
      setSaveStatus('error');
      return false;
    }
  }, []);

  // Save before page unload (browser tab close, navigation, etc.)
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Attempt to save immediately before unload
      await saveProjectImmediately(projectData);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [projectData, saveProjectImmediately]);

  // Auto-save (debounced for regular changes)
  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    setSaveStatus('saving');
    
    // More aggressive debounce timing to reduce data loss risk
    saveTimeoutRef.current = window.setTimeout(async () => {
      await saveProjectImmediately(projectData);
    }, 500);
    
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [projectData, isLoading, saveProjectImmediately]);

  // Strip callbacks for serialization
  const stripCallbacks = (data: ProjectData): ProjectData => {
    return {
      projectName: data.projectName,
      projectNodes: data.projectNodes.map(stripNodeCallbacks),
      projectEdges: data.projectEdges,
      serviceFlows: Object.fromEntries(
        Object.entries(data.serviceFlows).map(([k, v]) => [
          k,
          { ...v, nodes: v.nodes.map(stripNodeCallbacks), edges: v.edges },
        ])
      ),
    };
  };

  // Open helpers
  const openDbConfigById = useCallback((nodeId: string) => {
    setSelectedDbNode(nodeId);
    setIsDbModalOpen(true);
  }, []);

  const openServiceConfigById = useCallback((nodeId: string) => {
    setSelectedServiceNode(nodeId);
    setIsServiceModalOpen(true);
  }, []);

  // Drill into service
  const drillIntoService = useCallback((serviceId: string, serviceName: string) => {
    console.log('[service-nav] drill into service', {
      serviceId,
      serviceName,
      projectNodeTypes: nodes.map((node) => node.type),
    });

    syncToProjectData(nodes, edges);
    
    // Initialize service flow if doesn't exist
    setProjectData((prev) => {
      if (!prev.serviceFlows[serviceId]) {
        return {
          ...prev,
          serviceFlows: {
            ...prev.serviceFlows,
            [serviceId]: {
              nodes: [],
              edges: [],
              apiContracts: [],
            },
          },
        };
      }
      return prev;
    });
    
    setCanvasContext({ type: 'service', serviceId, serviceName });
  }, [nodes, edges, syncToProjectData]);

  // Navigate back to project
  const navigateToProject = useCallback(() => {
    console.log('[service-nav] back to project', {
      serviceId: canvasContext.serviceId,
      currentNodeTypes: nodes.map((node) => node.type),
      currentEdgeCount: edges.length,
    });

    syncToProjectData(nodes, edges);
    setCanvasContext({ type: 'project' });
  }, [canvasContext.serviceId, nodes, edges, syncToProjectData]);

  useEffect(() => {
    if (canvasContext.type !== 'service' && isApiRequestModalOpen) {
      setIsApiRequestModalOpen(false);
    }
  }, [canvasContext.type, isApiRequestModalOpen]);

  // Shared delete path for node-specific side effects + state removal.
  const deleteNodeByType = useCallback(async (nodeId: string, nodeType: string) => {
    const targetNode = projectData.projectNodes.find((n) => n.id === nodeId);
    const dbDropPayload = targetNode ? getDatabaseDropPayload(targetNode) : null;

    if (dbDropPayload) {
      const response = await fetch(`${API_BASE}/api/db/drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbDropPayload),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || `Failed to drop database ${dbDropPayload.database}`);
      }
    }

    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setProjectData((prev) => removeNodeFromProjectData(prev, nodeId, nodeType));
  }, [projectData.projectNodes]);

  // Confirm delete
  const confirmDeleteNode = useCallback((nodeId: string, nodeType: string) => {
    setConfirmDialog({
      isOpen: true,
      title: `Delete ${nodeType}?`,
      message: `Are you sure you want to delete this ${nodeType}? This action cannot be undone.`,
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await deleteNodeByType(nodeId, nodeType);
        } catch (error) {
          alert(`Failed to delete ${nodeType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
          setConfirmDialog((c) => ({ ...c, isOpen: false }));
        }
      },
    });
  }, [deleteNodeByType]);

  // New project
  const handleNewProject = useCallback(() => {
    setConfirmDialog({
      isOpen: true,
      title: 'New Project',
      message: 'This will clear all databases, services, and flows. Are you sure?',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          const targets = getProjectNodeDeletionTargets(projectData);
          for (const target of targets) {
            await deleteNodeByType(target.id, target.type);
          }

          setProjectData(EMPTY_PROJECT);
          setCanvasContext({ type: 'project' });
          setIsDataGatewayRunning(false);
          setDataGatewayUrls(null);
        } catch (error) {
          alert(`Failed to reset project/database: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
          setConfirmDialog((c) => ({ ...c, isOpen: false }));
        }
      },
    });
  }, [projectData, deleteNodeByType]);

  // Node changes
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    const newNodes = applyNodeChanges(changes, nodes);
    setNodes(newNodes);
    syncToProjectData(newNodes, edges);
  }, [nodes, edges, syncToProjectData]);

  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    const newEdges = applyEdgeChanges(changes, edges);
    setEdges(newEdges);
    syncToProjectData(nodes, newEdges);
  }, [nodes, edges, syncToProjectData]);

  const onConnect: OnConnect = useCallback((params) => {
    const newEdges = addEdge(params, edges);
    setEdges(newEdges);
    syncToProjectData(nodes, newEdges);
  }, [nodes, edges, syncToProjectData]);

  // Add node
  const addNode = useCallback((type: string) => {
    const nodeId = `${type}-${Date.now()}`;
    const position = { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 };

    if (canvasContext.type === 'project' && !isProjectCanvasNodeType(type)) {
      console.warn('[canvas-boundary] blocked non-project node on project canvas', { type });
      return;
    }

    if (canvasContext.type === 'service' && !isServiceCanvasNodeType(type)) {
      console.warn('[canvas-boundary] blocked non-service node on service canvas', { type });
      return;
    }

    const newNode = canvasContext.type === 'project'
      ? createProjectNode(type, nodeId, position, {
          openDbConfigById,
          openServiceConfigById,
          confirmDeleteNode,
          drillIntoService,
        })
      : createServiceCanvasNode(type, nodeId, position);
    
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    syncToProjectData(newNodes, edges);
    
    // Auto-open config for database and service
    if (type === 'database') {
      setTimeout(() => {
        setSelectedDbNode(nodeId);
        setIsDbModalOpen(true);
      }, 100);
    } else if (type === 'service') {
      setTimeout(() => {
        setSelectedServiceNode(nodeId);
        setIsServiceModalOpen(true);
      }, 100);
    }
  }, [canvasContext.type, nodes, edges, openDbConfigById, openServiceConfigById, confirmDeleteNode, drillIntoService, syncToProjectData]);

  // Update DataGateway when databases change
  useEffect(() => {
    if (canvasContext.type !== 'project') return;
    
    const dbNodes = projectData.projectNodes.filter((n) => n.type === 'database');
    const existingGateway = projectData.projectNodes.find((n) => n.type === 'dataGateway');
    const managedGatewayEdges = buildManagedDataGatewayEdges(dbNodes);
    
    if (dbNodes.length > 0 && !existingGateway) {
      // Create DataGateway (first database added)
      const gatewayData = {
        label: 'DataGateway',
        databases: dbNodes.map((n) => {
          const d = n.data as unknown as DatabaseNodeData;
          return {
            name: d.database || 'unnamed',
            host: d.host,
            port: d.port,
            tables: d.tables || [],
          };
        }),
        protocols: { rest: true, grpc: true, graphql: true },
        onViewDetails: () => setIsDataGatewayModalOpen(true),
        isRunning: isDataGatewayRunning,
        runUrls: dataGatewayUrls,
        onRun: handleRunDataGateway,
        onStop: handleStopDataGateway,
      };
      
      const gatewayNode: Node = {
        id: DATAGATEWAY_NODE_ID,
        type: 'dataGateway',
        position: { x: 400, y: 100 },
        data: gatewayData as unknown as Record<string, unknown>,
      };
      
      // Update both nodes (for React Flow) and projectData (for persistence)
      setNodes((prev) => [...prev, gatewayNode]);
      setEdges((prev) => mergeWithManagedDataGatewayEdges(prev, managedGatewayEdges));
      setProjectData((prev) => ({
        ...prev,
        projectNodes: [...prev.projectNodes, gatewayNode],
        projectEdges: mergeWithManagedDataGatewayEdges(prev.projectEdges, managedGatewayEdges),
      }));
    } else if (dbNodes.length > 0 && existingGateway) {
      // Update DataGateway (database/table/column changes)
      const updatedDatabases = dbNodes.map((dn) => {
        const d = dn.data as DatabaseNodeData;
        return {
          name: d.database || 'unnamed',
          host: d.host,
          port: d.port,
          tables: d.tables || [],
        };
      });
      
      // Update nodes state for immediate UI reflection
      setNodes((prev) => prev.map((n) =>
        n.type === 'dataGateway'
          ? { 
              ...n, 
              data: { 
                ...n.data, 
                databases: updatedDatabases,
                isRunning: isDataGatewayRunning,
                runUrls: dataGatewayUrls,
                onRun: handleRunDataGateway,
                onStop: handleStopDataGateway,
              } 
            }
          : n
      ));
      setEdges((prev) => mergeWithManagedDataGatewayEdges(prev, managedGatewayEdges));
      
      // Update projectData for persistence
      setProjectData((prev) => ({
        ...prev,
        projectNodes: prev.projectNodes.map((n) =>
          n.type === 'dataGateway'
            ? { ...n, data: { ...n.data, databases: updatedDatabases } }
            : n
        ),
        projectEdges: mergeWithManagedDataGatewayEdges(prev.projectEdges, managedGatewayEdges),
      }));
    } else if (dbNodes.length === 0 && existingGateway) {
      // Remove DataGateway (all databases removed)
      setNodes((prev) => prev.filter((n) => n.type !== 'dataGateway'));
      setEdges((prev) => prev.filter((e) => e.source !== DATAGATEWAY_NODE_ID && e.target !== DATAGATEWAY_NODE_ID));
      setProjectData((prev) => ({
        ...prev,
        projectNodes: prev.projectNodes.filter((n) => n.type !== 'dataGateway'),
        projectEdges: prev.projectEdges.filter((e) => e.source !== DATAGATEWAY_NODE_ID && e.target !== DATAGATEWAY_NODE_ID),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseSignature, canvasContext.type]);

  // Update DataGateway running state and callbacks
  useEffect(() => {
    if (canvasContext.type !== 'project') return;
    
    setNodes((prev) => {
      const hasGateway = prev.some((n) => n.type === 'dataGateway');
      if (!hasGateway) return prev;
      
      return prev.map((n) =>
        n.type === 'dataGateway'
          ? {
              ...n,
              data: {
                ...n.data,
                isRunning: isDataGatewayRunning,
                runUrls: dataGatewayUrls,
                onRun: handleRunDataGateway,
                onStop: handleStopDataGateway,
              },
            }
          : n
      );
    });
  }, [isDataGatewayRunning, dataGatewayUrls, handleRunDataGateway, handleStopDataGateway, canvasContext.type]);

  // Save database config
  const handleSaveDbConfig = useCallback((data: DatabaseNodeData) => {
    if (!selectedDbNode) return;
    
    const updateNodeData = (node: Node) => {
      if (node.id !== selectedDbNode) return node;
      return {
        ...node,
        data: {
          ...data,
          onConfigure: () => openDbConfigById(node.id),
          onDelete: () => confirmDeleteNode(node.id, 'database'),
        },
      };
    };
    
    // Update both nodes state (for React Flow) and projectData (for persistence)
    setNodes((prev) => prev.map(updateNodeData));
    setProjectData((prev) => ({
      ...prev,
      projectNodes: prev.projectNodes.map(updateNodeData),
    }));
  }, [selectedDbNode, openDbConfigById, confirmDeleteNode]);

  // Save service config
  const handleSaveServiceConfig = useCallback((data: ServiceNodeData) => {
    if (!selectedServiceNode) return;
    
    const updateNodeData = (node: Node) => {
      if (node.id !== selectedServiceNode) return node;
      return {
        ...node,
        data: {
          ...data,
          onConfigure: () => openServiceConfigById(node.id),
          onDrillDown: () => drillIntoService(node.id, data.name),
          onDelete: () => confirmDeleteNode(node.id, 'service'),
        },
      };
    };
    
    // Update both nodes state (for React Flow) and projectData (for persistence)
    setNodes((prev) => prev.map(updateNodeData));
    setProjectData((prev) => ({
      ...prev,
      projectNodes: prev.projectNodes.map(updateNodeData),
    }));
  }, [selectedServiceNode, openServiceConfigById, drillIntoService, confirmDeleteNode]);

  // Create database
  const handleCreateDatabase = async (data: DatabaseNodeData): Promise<{ success: boolean; message: string }> => {
    try {
      const response = await fetch(`${API_BASE}/api/db/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: data.host,
          port: data.port,
          password: data.password,
          database: data.database,
          schema: data.schema,
          tables: data.tables,
        }),
      });

      const result = await response.json();

      // If DataGateway is already running, refresh it after successful DB provisioning.
      if (result.success) {
        const nextProjectData = buildProjectDataWithDbUpdate(data);
        void restartDataGatewayIfRunning(nextProjectData);
      }

      return result;
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed' };
    }
  };

  // Generate and push to GitHub
  const handleGenerateAndPush = useCallback(async () => {
    setIsGenerating(true);
    setGenerateStatus('Generating code...');
    
    try {
      const dataToSend = stripCallbacks(projectData);
      
      const response = await fetch(`${API_BASE}/api/generate/push-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectData: dataToSend,
          githubUsername: GITHUB_USERNAME,
          projectName: currentProjectName,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setGenerateStatus(`✓ Pushed ${result.repos?.length || 0} repo(s)`);
        setTimeout(() => setGenerateStatus(null), 5000);
      } else {
        setGenerateStatus(`✗ Error: ${result.message}`);
      }
    } catch (error) {
      setGenerateStatus(`✗ Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    } finally {
      setIsGenerating(false);
    }
  }, [projectData, currentProjectName]);

  const handleRenameProject = useCallback(() => {
    const current = currentProjectName;
    const next = window.prompt('Project name (used as repo prefix):', current);
    if (next === null) return;

    const trimmed = next.trim();
    if (!trimmed) {
      alert('Project name cannot be empty.');
      return;
    }

    setProjectData((prev) => ({
      ...prev,
      projectName: trimmed,
    }));

    console.log('[project] renamed', { from: current, to: trimmed });
  }, [currentProjectName]);

  // Get data for modals
  const selectedDbData = useMemo(() => {
    if (!selectedDbNode) return getDefaultNodeData('database') as DatabaseNodeData;
    const node = projectData.projectNodes.find((n) => n.id === selectedDbNode);
    return (node?.data as DatabaseNodeData) || (getDefaultNodeData('database') as DatabaseNodeData);
  }, [selectedDbNode, projectData.projectNodes]);

  const selectedServiceData = useMemo(() => {
    if (!selectedServiceNode) return { label: '', name: '', description: '' } as ServiceNodeData;
    const node = projectData.projectNodes.find((n) => n.id === selectedServiceNode);
    return (node?.data as unknown as ServiceNodeData) || { label: '', name: '', description: '' };
  }, [selectedServiceNode, projectData.projectNodes]);

  const dataGatewayData = useMemo(() => {
    const node = projectData.projectNodes.find((n) => n.type === 'dataGateway');
    return (node?.data as unknown as DataGatewayNodeData) || {
      label: 'DataGateway',
      databases: [],
      protocols: { rest: true, grpc: true, graphql: true },
    };
  }, [projectData.projectNodes]);

  const currentServiceContracts = useMemo(() => {
    if (canvasContext.type !== 'service' || !canvasContext.serviceId) return [] as ApiContract[];
    return projectData.serviceFlows[canvasContext.serviceId]?.apiContracts || [];
  }, [canvasContext, projectData.serviceFlows]);

  const handleSaveApiContracts = useCallback((contracts: ApiContract[]) => {
    if (canvasContext.type !== 'service' || !canvasContext.serviceId) return;

    const serviceId = canvasContext.serviceId;
    console.log('[contracts] saving contracts', {
      serviceId,
      contractCount: contracts.length,
      contractNames: contracts.map((contract) => contract.name),
    });

    const endpointSummary = contracts.map((contract) => ({
      method: contract.method,
      path: contract.path,
      description: contract.description,
    }));

    setProjectData((prev) => {
      const flow = prev.serviceFlows[serviceId] || { nodes: [], edges: [], apiContracts: [] };
      return {
        ...prev,
        projectNodes: prev.projectNodes.map((node) =>
          node.id === serviceId && node.type === 'service'
            ? {
                ...node,
                data: {
                  ...node.data,
                  apiContracts: contracts,
                  endpoints: endpointSummary,
                },
              }
            : node
        ),
        serviceFlows: {
          ...prev.serviceFlows,
          [serviceId]: {
            ...flow,
            apiContracts: contracts,
          },
        },
      };
    });
  }, [canvasContext]);

  if (isLoading) {
    return (
      <div className="app-container loading-screen">
        <h2>Loading project...</h2>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="app-container">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <button 
            className={`breadcrumb-item ${canvasContext.type === 'project' ? 'active' : ''}`}
            onClick={navigateToProject}
          >
            📁 {currentProjectName}
          </button>
          {canvasContext.type === 'service' && (
            <>
              <span className="breadcrumb-separator">›</span>
              <span className="breadcrumb-item active">
                🔌 {canvasContext.serviceName || 'API'}
              </span>
            </>
          )}
        </div>

        <div className="flow-container">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes as NodeTypes}
            fitView
          >
            <Background />
            <Controls />
            
            <Panel position="top-left" className="node-palette">
              <h3>{canvasContext.type === 'project' ? currentProjectName : canvasContext.serviceName}</h3>
              
              {canvasContext.type === 'project' && (
                <>
                  <button onClick={handleRenameProject}>✏️ Rename Project</button>
                  <button onClick={() => addNode('database')}>⛁ Database</button>
                  <button onClick={() => addNode('service')}>🔌 API Service</button>
                </>
              )}
              
              {canvasContext.type === 'service' && (
                <>
                  <button onClick={() => setIsApiRequestModalOpen(true)}>📝 Define Request</button>
                  <button onClick={() => addNode('action')}>▭ Action</button>
                  <button onClick={() => addNode('decision')}>◇ Decision</button>
                  <button onClick={() => addNode('loop')}>⬡ Loop</button>
                  <button onClick={() => addNode('apiCall')}>▱ API Call</button>
                </>
              )}
              
              <hr style={{ margin: '10px 0', borderColor: '#444' }} />
              
              {canvasContext.type === 'project' && (
                <button 
                  onClick={handleGenerateAndPush}
                  disabled={isGenerating}
                  style={{ background: isGenerating ? '#555' : '#238636', width: '100%', fontWeight: 'bold' }}
                >
                  {isGenerating ? '⏳ Generating...' : '🚀 Generate & Push'}
                </button>
              )}
              
              {generateStatus && (
                <div style={{ 
                  marginTop: '8px', fontSize: '11px', wordBreak: 'break-word',
                  color: generateStatus.startsWith('✓') ? '#3fb950' : generateStatus.startsWith('✗') ? '#f85149' : '#8b949e'
                }}>
                  {generateStatus}
                </div>
              )}
              
              <hr style={{ margin: '10px 0', borderColor: '#444' }} />
              
              <button 
                onClick={handleNewProject}
                style={{ background: '#6e4040', width: '100%' }}
              >
                🗑️ New Project
              </button>
            </Panel>
            
            <Panel position="top-right" className="info-panel">
              <h3>Visual Flow Editor</h3>
              {canvasContext.type === 'project' ? (
                <>
                  <p>Add databases and API services</p>
                  <p>Double-click services to edit logic</p>
                  <p>DataGateway auto-generates from DBs</p>
                </>
              ) : (
                <>
                  <p>Define API logic with flow nodes</p>
                  <p>Use API Call to access DataGateway</p>
                  <p>Click Project to go back</p>
                </>
              )}
              <hr style={{ margin: '10px 0', borderColor: '#444' }} />
              <div style={{ fontSize: '12px', color: '#8b949e' }}>
                Status: {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? '⏳ Saving...' : '✗ Error'}
              </div>
              <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '4px' }}>
                {nodes.length} nodes, {edges.length} edges
              </div>
            </Panel>
          </ReactFlow>
        </div>
        
        <DatabaseConfigModal
          isOpen={isDbModalOpen}
          data={selectedDbData}
          onSave={handleSaveDbConfig}
          onClose={() => setIsDbModalOpen(false)}
          onCreateDatabase={handleCreateDatabase}
        />
        
        <ServiceConfigModal
          isOpen={isServiceModalOpen}
          data={selectedServiceData}
          onSave={handleSaveServiceConfig}
          onClose={() => setIsServiceModalOpen(false)}
        />
        
        <DataGatewayViewModal
          isOpen={isDataGatewayModalOpen}
          data={dataGatewayData}
          onClose={() => setIsDataGatewayModalOpen(false)}
        />

        <ApiRequestBuilderModal
          isOpen={isApiRequestModalOpen}
          serviceName={canvasContext.serviceName}
          contracts={currentServiceContracts}
          onSave={handleSaveApiContracts}
          onClose={() => setIsApiRequestModalOpen(false)}
        />
        
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmStyle={confirmDialog.confirmStyle}
          confirmText="Yes, delete"
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog((c) => ({ ...c, isOpen: false }))}
        />
      </div>
    </ReactFlowProvider>
  );
}

export default App;
