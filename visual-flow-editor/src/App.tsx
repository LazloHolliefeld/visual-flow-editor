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
  
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);

  // Get current nodes/edges based on canvas context
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
  const restoreNodeCallbacks = useCallback((data: ProjectData): ProjectData => {
    const restoreProjectNodes = data.projectNodes.map((node: Node) => {
      if (node.type === 'database') {
        return {
          ...node,
          data: {
            ...node.data,
            onConfigure: () => openDbConfigById(node.id),
            onDelete: () => confirmDeleteNode(node.id, 'database'),
          },
        };
      }
      if (node.type === 'service') {
        const serviceData = node.data as unknown as ServiceNodeData;
        return {
          ...node,
          data: {
            ...node.data,
            onConfigure: () => openServiceConfigById(node.id),
            onDrillDown: () => drillIntoService(node.id, serviceData.name),
            onDelete: () => confirmDeleteNode(node.id, 'service'),
          },
        };
      }
      if (node.type === 'dataGateway') {
        return {
          ...node,
          data: {
            ...node.data,
            onViewDetails: () => setIsDataGatewayModalOpen(true),
          },
        };
      }
      return node;
    });
    
    return { ...data, projectNodes: restoreProjectNodes };
  }, []);

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
    const stripNode = (node: Node): Node => ({
      ...node,
      data: {
        ...(node.data as Record<string, unknown>),
        onConfigure: undefined,
        onDelete: undefined,
        onDrillDown: undefined,
        onViewDetails: undefined,
      },
    });
    
    return {
      projectNodes: data.projectNodes.map(stripNode),
      projectEdges: data.projectEdges,
      serviceFlows: Object.fromEntries(
        Object.entries(data.serviceFlows).map(([k, v]) => [
          k,
          { nodes: v.nodes.map(stripNode), edges: v.edges },
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

  // Confirm delete
  const confirmDeleteNode = useCallback((nodeId: string, nodeType: string) => {
    setConfirmDialog({
      isOpen: true,
      title: `Delete ${nodeType}?`,
      message: `Are you sure you want to delete this ${nodeType}? This action cannot be undone.`,
      confirmStyle: 'danger',
      onConfirm: () => {
        setProjectData((prev) => ({
          ...prev,
          projectNodes: prev.projectNodes.filter((n) => n.id !== nodeId),
          projectEdges: prev.projectEdges.filter((e) => e.source !== nodeId && e.target !== nodeId),
          serviceFlows: nodeType === 'service' 
            ? Object.fromEntries(Object.entries(prev.serviceFlows).filter(([k]) => k !== nodeId))
            : prev.serviceFlows,
        }));
        setConfirmDialog((c) => ({ ...c, isOpen: false }));
      },
    });
  }, []);

  // New project
  const handleNewProject = useCallback(() => {
    setConfirmDialog({
      isOpen: true,
      title: 'New Project',
      message: 'This will clear all databases, services, and flows. Are you sure?',
      confirmStyle: 'danger',
      onConfirm: () => {
        setProjectData(EMPTY_PROJECT);
        setCanvasContext({ type: 'project' });
        setConfirmDialog((c) => ({ ...c, isOpen: false }));
      },
    });
  }, []);

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
    
    let newNode: Node;
    
    switch (type) {
      case 'database':
        newNode = {
          id: nodeId,
          type: 'database',
          position,
          data: {
            label: 'Database',
            host: 'localhost',
            port: 5432,
            database: '',
            schema: 'public',
            tables: [],
            onConfigure: () => openDbConfigById(nodeId),
            onDelete: () => confirmDeleteNode(nodeId, 'database'),
          },
        };
        break;
        
      case 'service':
        newNode = {
          id: nodeId,
          type: 'service',
          position,
          data: {
            label: 'New API',
            name: '',
            description: '',
            onConfigure: () => openServiceConfigById(nodeId),
            onDrillDown: () => {
              const foundNode = projectData.projectNodes.find(n => n.id === nodeId);
              const name = foundNode ? (foundNode.data as unknown as ServiceNodeData).name || 'API' : 'API';
              drillIntoService(nodeId, name);
            },
            onDelete: () => confirmDeleteNode(nodeId, 'service'),
          },
        };
        break;
        
      default:
        newNode = {
          id: nodeId,
          type,
          position,
          data: getDefaultData(type),
        };
    }
    
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
  }, [nodes, edges, openDbConfigById, openServiceConfigById, confirmDeleteNode, drillIntoService, projectData.projectNodes, syncToProjectData]);

  // Update DataGateway when databases change
  useEffect(() => {
    if (canvasContext.type !== 'project') return;
    
    const dbNodes = projectData.projectNodes.filter((n) => n.type === 'database');
    const existingGateway = projectData.projectNodes.find((n) => n.type === 'dataGateway');
    
    if (dbNodes.length > 0 && !existingGateway) {
      // Create DataGateway
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
      };
      
      const gatewayNode: Node = {
        id: 'dataGateway',
        type: 'dataGateway',
        position: { x: 400, y: 100 },
        data: gatewayData as unknown as Record<string, unknown>,
      };
      
      setProjectData((prev) => ({
        ...prev,
        projectNodes: [...prev.projectNodes, gatewayNode],
      }));
    } else if (dbNodes.length > 0 && existingGateway) {
      // Update DataGateway
      setProjectData((prev) => ({
        ...prev,
        projectNodes: prev.projectNodes.map((n) =>
          n.type === 'dataGateway'
            ? {
                ...n,
                data: {
                  ...n.data,
                  databases: dbNodes.map((dn) => {
                    const d = dn.data as DatabaseNodeData;
                    return {
                      name: d.database || 'unnamed',
                      host: d.host,
                      port: d.port,
                      tables: d.tables || [],
                    };
                  }),
                },
              }
            : n
        ),
      }));
    } else if (dbNodes.length === 0 && existingGateway) {
      // Remove DataGateway if no databases
      setProjectData((prev) => ({
        ...prev,
        projectNodes: prev.projectNodes.filter((n) => n.type !== 'dataGateway'),
      }));
    }
  }, [projectData.projectNodes.filter((n) => n.type === 'database').length, canvasContext.type]);

  // Save database config
  const handleSaveDbConfig = useCallback((data: DatabaseNodeData) => {
    if (!selectedDbNode) return;
    
    setProjectData((prev) => ({
      ...prev,
      projectNodes: prev.projectNodes.map((node) =>
        node.id === selectedDbNode
          ? {
              ...node,
              data: {
                ...data,
                onConfigure: () => openDbConfigById(node.id),
                onDelete: () => confirmDeleteNode(node.id, 'database'),
              },
            }
          : node
      ),
    }));
  }, [selectedDbNode, openDbConfigById, confirmDeleteNode]);

  // Save service config
  const handleSaveServiceConfig = useCallback((data: ServiceNodeData) => {
    if (!selectedServiceNode) return;
    
    setProjectData((prev) => ({
      ...prev,
      projectNodes: prev.projectNodes.map((node) =>
        node.id === selectedServiceNode
          ? {
              ...node,
              data: {
                ...data,
                onConfigure: () => openServiceConfigById(node.id),
                onDrillDown: () => drillIntoService(node.id, data.name),
                onDelete: () => confirmDeleteNode(node.id, 'service'),
              },
            }
          : node
      ),
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
    if (!selectedDbNode) return getDefaultData('database') as DatabaseNodeData;
    const node = projectData.projectNodes.find((n) => n.id === selectedDbNode);
    return (node?.data as DatabaseNodeData) || (getDefaultData('database') as DatabaseNodeData);
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

function getDefaultData(type: string): Record<string, unknown> {
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
      return { label: 'Database', host: 'localhost', port: 5432, database: '', schema: 'public', tables: [] };
    default:
      return { label: 'Node' };
  }
}

export default App;
