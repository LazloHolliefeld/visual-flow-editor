import fs from 'fs';

const PROJECT_NODE_TYPES = new Set(['database', 'service', 'dataGateway']);

function sanitizeProjectData(projectData) {
  const data = projectData || getEmptyProjectData();
  const rawProjectName = String(data.projectName || '').trim();
  const projectName = rawProjectName || 'project';
  const projectNodes = Array.isArray(data.projectNodes)
    ? data.projectNodes.filter((node) => PROJECT_NODE_TYPES.has(String(node?.type || '')))
    : [];
  const projectNodeIds = new Set(projectNodes.map((node) => node.id));
  const projectEdges = Array.isArray(data.projectEdges)
    ? data.projectEdges.filter((edge) => projectNodeIds.has(edge?.source) && projectNodeIds.has(edge?.target))
    : [];
  const serviceFlows = Object.fromEntries(
    Object.entries(data.serviceFlows || {}).map(([serviceId, flow]) => [
      serviceId,
      {
        nodes: Array.isArray(flow?.nodes) ? flow.nodes.filter((node) => node?.type !== 'request') : [],
        edges: Array.isArray(flow?.edges) ? flow.edges : [],
        apiContracts: Array.isArray(flow?.apiContracts) ? flow.apiContracts : [],
      },
    ])
  );

  return { projectName, projectNodes, projectEdges, serviceFlows };
}

export function getEmptyProjectData() {
  return { projectName: 'project', projectNodes: [], projectEdges: [], serviceFlows: {} };
}

export function saveProjectState(projectFile, projectData) {
  const sanitizedProjectData = sanitizeProjectData(projectData);

  if (fs.existsSync(projectFile)) {
    fs.copyFileSync(projectFile, `${projectFile}.bak`);
  }

  const data = {
    version: '2.0',
    savedAt: new Date().toISOString(),
    projectData: sanitizedProjectData,
  };

  console.log('[projectService.saveProjectState]', {
    projectName: sanitizedProjectData.projectName,
    projectNodeTypes: sanitizedProjectData.projectNodes.map((node) => node.type),
    projectNodeCount: sanitizedProjectData.projectNodes.length,
    serviceFlowIds: Object.keys(sanitizedProjectData.serviceFlows),
  });

  fs.writeFileSync(projectFile, JSON.stringify(data, null, 2));
  return { success: true, message: 'Project saved successfully' };
}

export function loadProjectState(projectFile) {
  if (!fs.existsSync(projectFile)) {
    return { success: false, message: 'No saved project found' };
  }

  const data = fs.readFileSync(projectFile, 'utf-8');
  const saved = JSON.parse(data);

  if (saved.projectData) {
    const sanitizedProjectData = sanitizeProjectData(saved.projectData);
    console.log('[projectService.loadProjectState]', {
      projectName: sanitizedProjectData.projectName,
      projectNodeTypes: sanitizedProjectData.projectNodes.map((node) => node.type),
      projectNodeCount: sanitizedProjectData.projectNodes.length,
      serviceFlowIds: Object.keys(sanitizedProjectData.serviceFlows),
    });
    return { success: true, projectData: sanitizedProjectData };
  }

  if (saved.nodes) {
    const sanitizedProjectData = sanitizeProjectData({
      projectNodes: saved.nodes,
      projectEdges: saved.edges || [],
      serviceFlows: {},
    });
    return {
      success: true,
      projectData: sanitizedProjectData,
    };
  }

  return { success: false, message: 'Invalid project format' };
}

export function clearProjectState(projectFile) {
  fs.writeFileSync(projectFile, JSON.stringify(getEmptyProjectData(), null, 2));
  return { success: true, message: 'Project state cleared' };
}
