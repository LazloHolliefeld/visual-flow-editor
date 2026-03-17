// Contract normalization: converts raw serviceData.apiContracts (or legacy endpoints)
// into a normalized array with computed handlerName. Used by all code generators.

export function sanitizeIdentifier(name) {
  return String(name ?? '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

export function normalizePath(pathValue) {
  const trimmed = String(pathValue || '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function normalizeServiceContracts(serviceData) {
  const contracts = Array.isArray(serviceData?.apiContracts) ? serviceData.apiContracts : [];
  const fromContracts = contracts
    .filter((contract) => contract && contract.path && contract.method)
    .map((contract, index) => {
      const cleanPath = normalizePath(contract.path);
      const method = String(contract.method || 'POST').toUpperCase();
      const operationName = (contract.name || `Operation${index + 1}`).trim();
      return {
        id: contract.id || `api-${index + 1}`,
        name: operationName,
        method,
        path: cleanPath,
        description: contract.description || '',
        requestFields: Array.isArray(contract.requestFields) ? contract.requestFields : [],
        responseFields: Array.isArray(contract.responseFields) ? contract.responseFields : [],
        handlerName: `${sanitizeIdentifier(operationName)}Handler`,
      };
    });

  if (fromContracts.length > 0) return fromContracts;

  // Fallback: legacy endpoints array (no requestFields/responseFields)
  const legacyEndpoints = Array.isArray(serviceData?.endpoints) ? serviceData.endpoints : [];
  return legacyEndpoints
    .filter((endpoint) => endpoint && endpoint.path)
    .map((endpoint, index) => {
      const method = String(endpoint.method || 'POST').toUpperCase();
      const p = normalizePath(endpoint.path);
      const name = `Endpoint${index + 1}`;
      return {
        id: `legacy-${index + 1}`,
        name,
        method,
        path: p,
        description: endpoint.description || '',
        requestFields: [],
        responseFields: [],
        handlerName: `${sanitizeIdentifier(name)}Handler`,
      };
    });
}
