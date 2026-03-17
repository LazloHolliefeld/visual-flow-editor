import { useState, useEffect } from 'react';
import type { ServiceNodeData } from '../nodes/ServiceNode';

interface ServiceConfigModalProps {
  isOpen: boolean;
  data: ServiceNodeData;
  onSave: (data: ServiceNodeData) => void;
  onClose: () => void;
}

export function ServiceConfigModal({
  isOpen,
  data,
  onSave,
  onClose,
}: ServiceConfigModalProps) {
  const [name, setName] = useState(data.name || '');
  const [description, setDescription] = useState(data.description || '');

  useEffect(() => {
    if (isOpen) {
      setName(data.name || '');
      setDescription(data.description || '');
    }
  }, [isOpen, data]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
      ...data,
      name,
      label: name,
      description,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content service-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configure API Service</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>Service Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., UserService"
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this API do?"
              rows={3}
            />
          </div>

          <div className="info-box">
            <strong>💡 Tip:</strong> Double-click the service node, then use <code>Define Request</code> in the toolbox to build REST contracts that auto-generate GraphQL and gRPC stubs.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={!name.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
