import { useEffect, useMemo, useState } from 'react';
import type { ApiContract, ApiContractField } from '../types/apiContract';

type Props = {
  isOpen: boolean;
  serviceName?: string;
  contracts: ApiContract[];
  onSave: (contracts: ApiContract[]) => void;
  onClose: () => void;
};

const FIELD_TYPES = ['string', 'int', 'float', 'bool', 'object', 'array'] as const;
const FIELD_LOCATIONS = ['path', 'query', 'header', 'body'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function createEmptyField(location: ApiContractField['location'] = 'body'): ApiContractField {
  return {
    name: '',
    type: 'string',
    required: true,
    location,
    description: '',
  };
}

function createEmptyContract(): ApiContract {
  const id = `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: '',
    method: 'POST',
    path: '/resource',
    description: '',
    requestFields: [createEmptyField('body')],
    responseFields: [
      { name: 'success', type: 'bool', required: true, description: 'Whether the request succeeded' },
    ],
  };
}

export function ApiRequestBuilderModal({
  isOpen,
  serviceName,
  contracts,
  onSave,
  onClose,
}: Props) {
  const [draftContracts, setDraftContracts] = useState<ApiContract[]>(contracts || []);
  const [selectedContractId, setSelectedContractId] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    const next = (contracts || []).map((contract) => ({
      ...contract,
      requestFields: (contract.requestFields || []).map((f) => ({ ...f })),
      responseFields: (contract.responseFields || []).map((f) => ({ ...f })),
    }));
    setDraftContracts(next);
    setSelectedContractId(next[0]?.id || '');
  }, [isOpen, contracts]);

  const selectedIndex = useMemo(() => {
    return draftContracts.findIndex((c) => c.id === selectedContractId);
  }, [draftContracts, selectedContractId]);

  const selected = selectedIndex >= 0 ? draftContracts[selectedIndex] : null;

  if (!isOpen) return null;

  const updateSelected = (updater: (c: ApiContract) => ApiContract) => {
    if (selectedIndex < 0) return;
    setDraftContracts((prev) => prev.map((contract, idx) => (idx === selectedIndex ? updater(contract) : contract)));
  };

  const addContract = () => {
    const contract = createEmptyContract();
    setDraftContracts((prev) => [...prev, contract]);
    setSelectedContractId(contract.id);
  };

  const removeContract = (contractId: string) => {
    setDraftContracts((prev) => prev.filter((c) => c.id !== contractId));
    if (selectedContractId === contractId) {
      const next = draftContracts.find((c) => c.id !== contractId);
      setSelectedContractId(next?.id || '');
    }
  };

  const addRequestField = () => {
    updateSelected((c) => ({ ...c, requestFields: [...(c.requestFields || []), createEmptyField('body')] }));
  };

  const addResponseField = () => {
    updateSelected((c) => ({ ...c, responseFields: [...(c.responseFields || []), createEmptyField('body')] }));
  };

  const removeRequestField = (index: number) => {
    updateSelected((c) => ({ ...c, requestFields: c.requestFields.filter((_, idx) => idx !== index) }));
  };

  const removeResponseField = (index: number) => {
    updateSelected((c) => ({ ...c, responseFields: c.responseFields.filter((_, idx) => idx !== index) }));
  };

  const updateRequestField = (index: number, patch: Partial<ApiContractField>) => {
    updateSelected((c) => ({
      ...c,
      requestFields: c.requestFields.map((field, idx) => (idx === index ? { ...field, ...patch } : field)),
    }));
  };

  const updateResponseField = (index: number, patch: Partial<ApiContractField>) => {
    updateSelected((c) => ({
      ...c,
      responseFields: c.responseFields.map((field, idx) => (idx === index ? { ...field, ...patch } : field)),
    }));
  };

  const hasInvalidContract = draftContracts.some((c) => !c.name.trim() || !c.path.trim());

  const handleSave = () => {
    const normalized = draftContracts.map((contract) => ({
      ...contract,
      name: contract.name.trim(),
      path: contract.path.startsWith('/') ? contract.path.trim() : `/${contract.path.trim()}`,
      requestFields: (contract.requestFields || []).filter((f) => f.name.trim()),
      responseFields: (contract.responseFields || []).filter((f) => f.name.trim()),
    }));
    onSave(normalized);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content api-request-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Define API Requests{serviceName ? ` - ${serviceName}` : ''}</h2>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

        <div className="modal-body">
          <div className="info-box">
            <strong>Contract-first:</strong> Define REST once and the generator creates GraphQL and gRPC stubs from this contract.
          </div>

          <div className="api-request-layout">
            <div className="api-contract-list">
              <div className="api-contract-list-header">
                <h3>Operations</h3>
                <button className="btn btn-small btn-primary" onClick={addContract}>+ Add</button>
              </div>

              {draftContracts.length === 0 && <p className="empty-message">No API requests defined yet.</p>}

              {draftContracts.map((contract) => (
                <button
                  key={contract.id}
                  type="button"
                  className={`api-contract-item ${selectedContractId === contract.id ? 'active' : ''}`}
                  onClick={() => setSelectedContractId(contract.id)}
                >
                  <span className={`method-badge method-${contract.method.toLowerCase()}`}>{contract.method}</span>
                  <span className="api-contract-name">{contract.name || 'Untitled'}</span>
                  <code className="endpoint-path">{contract.path || '/'}</code>
                  <span
                    className="api-contract-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeContract(contract.id);
                    }}
                    title="Delete request"
                  >
                    x
                  </span>
                </button>
              ))}
            </div>

            <div className="api-contract-editor">
              {!selected ? (
                <p className="empty-message">Select an operation or add a new one.</p>
              ) : (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Operation Name</label>
                      <input
                        type="text"
                        value={selected.name}
                        onChange={(e) => updateSelected((c) => ({ ...c, name: e.target.value }))}
                        placeholder="e.g., UpdateAccountCustomer"
                      />
                    </div>
                    <div className="form-group">
                      <label>Method</label>
                      <select
                        value={selected.method}
                        onChange={(e) => updateSelected((c) => ({ ...c, method: e.target.value as ApiContract['method'] }))}
                      >
                        {HTTP_METHODS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>REST Path</label>
                    <input
                      type="text"
                      value={selected.path}
                      onChange={(e) => updateSelected((c) => ({ ...c, path: e.target.value }))}
                      placeholder="/accounts/{acctId}/customer"
                    />
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <input
                      type="text"
                      value={selected.description || ''}
                      onChange={(e) => updateSelected((c) => ({ ...c, description: e.target.value }))}
                      placeholder="What this operation does"
                    />
                  </div>

                  <div className="api-schema-section">
                    <div className="table-header">
                      <h4>Request Fields</h4>
                      <button className="btn btn-small btn-secondary" onClick={addRequestField}>+ Field</button>
                    </div>
                    {(selected.requestFields || []).map((field, idx) => (
                      <div className="column-row" key={`req-${idx}`}>
                        <input
                          value={field.name}
                          onChange={(e) => updateRequestField(idx, { name: e.target.value })}
                          placeholder="fieldName"
                        />
                        <select
                          value={field.type}
                          onChange={(e) => updateRequestField(idx, { type: e.target.value })}
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <select
                          value={field.location || 'body'}
                          onChange={(e) => updateRequestField(idx, { location: e.target.value as ApiContractField['location'] })}
                        >
                          {FIELD_LOCATIONS.map((location) => (
                            <option key={location} value={location}>{location}</option>
                          ))}
                        </select>
                        <label className="checkbox-inline">
                          <input
                            type="checkbox"
                            checked={field.required ?? false}
                            onChange={(e) => updateRequestField(idx, { required: e.target.checked })}
                          />
                          required
                        </label>
                        <button className="btn btn-small btn-danger" onClick={() => removeRequestField(idx)}>x</button>
                      </div>
                    ))}
                  </div>

                  <div className="api-schema-section">
                    <div className="table-header">
                      <h4>Response Fields</h4>
                      <button className="btn btn-small btn-secondary" onClick={addResponseField}>+ Field</button>
                    </div>
                    {(selected.responseFields || []).map((field, idx) => (
                      <div className="column-row" key={`res-${idx}`}>
                        <input
                          value={field.name}
                          onChange={(e) => updateResponseField(idx, { name: e.target.value })}
                          placeholder="fieldName"
                        />
                        <select
                          value={field.type}
                          onChange={(e) => updateResponseField(idx, { type: e.target.value })}
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <label className="checkbox-inline">
                          <input
                            type="checkbox"
                            checked={field.required ?? false}
                            onChange={(e) => updateResponseField(idx, { required: e.target.checked })}
                          />
                          required
                        </label>
                        <button className="btn btn-small btn-danger" onClick={() => removeResponseField(idx)}>x</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={hasInvalidContract}>Save API Contract</button>
        </div>
      </div>
    </div>
  );
}
