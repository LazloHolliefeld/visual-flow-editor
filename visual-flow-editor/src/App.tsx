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
import type { DatabaseNodeData } from './nodes';
import type { ServiceNodeData } from './nodes/ServiceNode';
import type { DataGatewayNodeData } from './nodes/DataGatewayNode';
import { DatabaseConfigModal } from './components/DatabaseConfigModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ServiceConfigModal } from './components/ServiceConfigModal';
import { DataGatewayViewModal } from './components/DataGatewayViewModal';
import {
  attachProjectNodeCallbacks,
  createProjectNode,
  getDatabaseDropPayload,
  getProjectNodeDeletionTargets,
  getDefaultNodeData,
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
  // Project-level nodes (databases, services, datagateway)
  projectNodes: Node[];
  projectEdges: Edge[];
  // Per-service flow data
  serviceFlows: Record<string, { nodes: Node[]; edges: Edge[] }>;
}

const EMPTY_PROJECT: ProjectData = {
  projectNodes: [],
  projectEdges: [],
  serviceFlows: {},
};

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
  
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);

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

  // Keep canvas state in sync with loaded/saved project data and current context.
  useEffect(() => {
    if (canvasContext.type === 'project') {
      setNodes(projectData.projectNodes);
      setEdges(projectData.projectEdges);
    } else if (canvasContext.serviceId) {
      const flow = projectData.serviceFlows[canvasContext.serviceId] || { nodes: [], edges: [] };
      setNodes(flow.nodes);
      setEdges(flow.edges);
    }
  }, [canvasContext, projectData]);

  // Sync current nodes/edges back to project data
  const syncToProjectData = useCallback((newNodes: Node[], newEdges: Edge[]) => {
    setProjectData((prev) => {
      if (canvasContext.type === 'project') {
        return { ...prev, projectNodes: newNodes, projectEdges: newEdges };
      } else if (canvasContext.serviceId) {
        return {
          ...prev,
          serviceFlows: {
            ...prev.serviceFlows,
            [canvasContext.serviceId]: { nodes: newNodes, edges: newEdges },
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

  // Auto-save
  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    setSaveStatus('saving');
    
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        // Strip callbacks before saving
        const dataToSave = stripCallbacks(projectData);
        
        const response = await fetch(`${API_BASE}/api/project/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectData: dataToSave }),
        });
        
        const result = await response.json();
        setSaveStatus(result.success ? 'saved' : 'error');
      } catch (error) {
        console.error('Failed to save:', error);
        setSaveStatus('error');
      }
    }, 1000);
    
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [projectData, isLoading]);

  // Strip callbacks for serialization
  const stripCallbacks = (data: ProjectData): ProjectData => {
    return {
      projectNodes: data.projectNodes.map(stripNodeCallbacks),
      projectEdges: data.projectEdges,
      serviceFlows: Object.fromEntries(
        Object.entries(data.serviceFlows).map(([k, v]) => [
          k,
          { nodes: v.nodes.map(stripNodeCallbacks), edges: v.edges },
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
    // Save current project-level state first
    syncToProjectData(nodes, edges);
    
    // Initialize service flow if doesn't exist
    setProjectData((prev) => {
      if (!prev.serviceFlows[serviceId]) {
        return {
          ...prev,
          serviceFlows: {
            ...prev.serviceFlows,
            [serviceId]: {
              nodes: [
                {
                  id: `${serviceId}-start`,
                  type: 'startEnd',
                  position: { x: 250, y: 50 },
                  data: { label: 'Start', type: 'start' },
                },
                {
                  id: `${serviceId}-end`,
                  type: 'startEnd',
                  position: { x: 250, y: 400 },
                  data: { label: 'End', type: 'end' },
                },
              ],
              edges: [],
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
    syncToProjectData(nodes, edges);
    setCanvasContext({ type: 'project' });
  }, [nodes, edges, syncToProjectData]);

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

    const newNode = createProjectNode(type, nodeId, position, {
      openDbConfigById,
      openServiceConfigById,
      confirmDeleteNode,
      drillIntoService,
    });
    
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
  }, [nodes, edges, openDbConfigById, openServiceConfigById, confirmDeleteNode, drillIntoService, syncToProjectData]);

  // Update DataGateway when databases change
  useEffect(() => {
    if (canvasContext.type !== 'project') return;
    
    const dbNodes = projectData.projectNodes.filter((n) => n.type === 'database');
    const existingGateway = projectData.projectNodes.find((n) => n.type === 'dataGateway');
    
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
        id: 'dataGateway',
        type: 'dataGateway',
        position: { x: 400, y: 100 },
        data: gatewayData as unknown as Record<string, unknown>,
      };
      
      // Update both nodes (for React Flow) and projectData (for persistence)
      setNodes((prev) => [...prev, gatewayNode]);
      setProjectData((prev) => ({
        ...prev,
        projectNodes: [...prev.projectNodes, gatewayNode],
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
      
      // Update projectData for persistence
      setProjectData((prev) => ({
        ...prev,
        projectNodes: prev.projectNodes.map((n) =>
          n.type === 'dataGateway'
            ? { ...n, data: { ...n.data, databases: updatedDatabases } }
            : n
        ),
      }));
    } else if (dbNodes.length === 0 && existingGateway) {
      // Remove DataGateway (all databases removed)
      setNodes((prev) => prev.filter((n) => n.type !== 'dataGateway'));
      setProjectData((prev) => ({
        ...prev,
        projectNodes: prev.projectNodes.filter((n) => n.type !== 'dataGateway'),
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
          database: data.database,
          schema: data.schema,
          tables: data.tables,
        }),
      });
      return await response.json();
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
  }, [projectData]);

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
            📁 Project
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
              <h3>{canvasContext.type === 'project' ? 'Project' : canvasContext.serviceName}</h3>
              
              {canvasContext.type === 'project' && (
                <>
                  <button onClick={() => addNode('database')}>⛁ Database</button>
                  <button onClick={() => addNode('service')}>🔌 API Service</button>
                </>
              )}
              
              {canvasContext.type === 'service' && (
                <>
                  <button onClick={() => addNode('startEnd')}>⬭ Start/End</button>
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
