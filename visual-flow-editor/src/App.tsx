import { useCallback, useState } from 'react';
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
import { DatabaseConfigModal } from './components/DatabaseConfigModal';
import './App.css';

const API_BASE = 'http://localhost:3001';

const initialNodes: Node[] = [
  {
    id: 'start',
    type: 'startEnd',
    position: { x: 250, y: 0 },
    data: { label: 'Start', type: 'start' },
  },
  {
    id: 'action1',
    type: 'action',
    position: { x: 225, y: 100 },
    data: { label: 'Initialize', code: 'x := 0' },
  },
  {
    id: 'decision1',
    type: 'decision',
    position: { x: 225, y: 200 },
    data: { label: 'Check', condition: 'x < 10' },
  },
  {
    id: 'loop1',
    type: 'loop',
    position: { x: 400, y: 200 },
    data: { label: 'For Each', condition: 'item in items' },
  },
  {
    id: 'api1',
    type: 'apiCall',
    position: { x: 225, y: 320 },
    data: { label: 'Fetch Data', url: '/api/data', method: 'GET' },
  },
  {
    id: 'end',
    type: 'startEnd',
    position: { x: 250, y: 450 },
    data: { label: 'End', type: 'end' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e-start-action1', source: 'start', target: 'action1' },
  { id: 'e-action1-decision1', source: 'action1', target: 'decision1' },
  { id: 'e-decision1-api1', source: 'decision1', target: 'api1', sourceHandle: 'true', label: 'Yes' },
  { id: 'e-decision1-loop1', source: 'decision1', target: 'loop1', sourceHandle: 'false', label: 'No' },
  { id: 'e-api1-end', source: 'api1', target: 'end' },
];

function App() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [selectedDbNode, setSelectedDbNode] = useState<string | null>(null);
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    []
  );

  const openDbConfig = useCallback((nodeId: string) => {
    setSelectedDbNode(nodeId);
    setIsDbModalOpen(true);
  }, []);

  const addNode = useCallback((type: string) => {
    const nodeId = `${type}-${Date.now()}`;
    const newNode: Node = {
      id: nodeId,
      type,
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: getDefaultData(type, nodeId, openDbConfig),
    };
    setNodes((nds) => [...nds, newNode]);
    
    // Auto-open config modal for database nodes
    if (type === 'database') {
      setTimeout(() => {
        setSelectedDbNode(nodeId);
        setIsDbModalOpen(true);
      }, 100);
    }
  }, [openDbConfig]);

  const handleSaveDbConfig = useCallback((data: DatabaseNodeData) => {
    if (!selectedDbNode) return;
    
    setNodes((nds) =>
      nds.map((node) =>
        node.id === selectedDbNode
          ? { ...node, data: { ...data, onConfigure: () => openDbConfig(node.id) } }
          : node
      )
    );
  }, [selectedDbNode, openDbConfig]);

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
      
      const result = await response.json();
      return result;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to connect to server',
      };
    }
  };

  const selectedDbData = selectedDbNode
    ? (nodes.find((n) => n.id === selectedDbNode)?.data as DatabaseNodeData) || getDefaultData('database', selectedDbNode, openDbConfig)
    : getDefaultData('database', '', openDbConfig);

  console.log('App rendering with', nodes.length, 'nodes');

  return (
    <ReactFlowProvider>
      <div className="app-container">
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
              <h3>Add Nodes</h3>
              <button onClick={() => addNode('startEnd')}>⬭ Start/End</button>
              <button onClick={() => addNode('action')}>▭ Action</button>
              <button onClick={() => addNode('decision')}>◇ Decision</button>
              <button onClick={() => addNode('loop')}>⬡ Loop</button>
              <button onClick={() => addNode('apiCall')}>▱ API Call</button>
              <button onClick={() => addNode('database')}>⛁ Database</button>
            </Panel>
            <Panel position="top-right" className="info-panel">
              <h3>Visual Flow Editor</h3>
              <p>Drag nodes to reposition</p>
              <p>Click and drag from handles to connect</p>
              <p>Double-click database nodes to configure</p>
            </Panel>
          </ReactFlow>
        </div>
        
        <DatabaseConfigModal
          isOpen={isDbModalOpen}
          data={selectedDbData as DatabaseNodeData}
          onSave={handleSaveDbConfig}
          onClose={() => setIsDbModalOpen(false)}
          onCreateDatabase={handleCreateDatabase}
        />
      </div>
    </ReactFlowProvider>
  );
}

function getDefaultData(type: string, nodeId: string = '', openDbConfig?: (id: string) => void): Record<string, unknown> {
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
      return {
        label: 'Database',
        host: 'localhost',
        port: 5432,
        database: '',
        schema: 'public',
        tables: [],
        onConfigure: openDbConfig ? () => openDbConfig(nodeId) : undefined,
      };
    default:
      return { label: 'Node' };
  }
}

export default App;
