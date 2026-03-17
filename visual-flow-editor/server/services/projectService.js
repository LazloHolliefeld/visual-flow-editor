import fs from 'fs';

export function getEmptyProjectData() {
  return { projectNodes: [], projectEdges: [], serviceFlows: {} };
}

export function saveProjectState(projectFile, projectData) {
  const data = {
    version: '2.0',
    savedAt: new Date().toISOString(),
    projectData: projectData || getEmptyProjectData(),
  };

  fs.writeFileSync(projectFile, JSON.stringify(data, null, 2));
  return { success: true, message: 'Project saved successfully' };
}

export function loadProjectState(projectFile) {
  if (!fs.existsSync(projectFile)) {
    return { success: false, message: 'No saved project found' };
  }

  const data = fs.readFileSync(projectFile, 'utf-8');
  const saved = JSON.parse(data);

  // Handle both old and new formats.
  if (saved.projectData) {
    return { success: true, projectData: saved.projectData };
  }

  if (saved.nodes) {
    return {
      success: true,
      projectData: {
        projectNodes: saved.nodes,
        projectEdges: saved.edges || [],
        serviceFlows: {},
      },
    };
  }

  return { success: false, message: 'Invalid project format' };
}

export function clearProjectState(projectFile) {
  fs.writeFileSync(projectFile, JSON.stringify(getEmptyProjectData(), null, 2));
  return { success: true, message: 'Project state cleared' };
}
