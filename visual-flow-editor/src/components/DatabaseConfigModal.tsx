import { useState, useEffect } from 'react';
import type { TableDefinition, DatabaseNodeData } from '../nodes/DatabaseNode';

const COLUMN_TYPES = [
  'INTEGER',
  'BIGINT',
  'SERIAL',
  'BIGSERIAL',
  'VARCHAR(255)',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
  'DECIMAL(10,2)',
  'FLOAT',
  'UUID',
  'JSON',
  'JSONB',
];

type ColumnDefinition = {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  defaultValue: string;
};

type TableEditorProps = {
  table: TableDefinition;
  onUpdate: (table: TableDefinition) => void;
  onDelete: () => void;
};

function TableEditor({ table, onUpdate, onDelete }: TableEditorProps) {
  const [columns, setColumns] = useState<ColumnDefinition[]>(
    table.columns.map(c => ({
      name: c.name,
      type: c.type,
      isPrimaryKey: c.isPrimaryKey || false,
      isNullable: c.isNullable !== false,
      defaultValue: c.defaultValue || '',
    }))
  );

  const addColumn = () => {
    setColumns([...columns, {
      name: '',
      type: 'VARCHAR(255)',
      isPrimaryKey: false,
      isNullable: true,
      defaultValue: '',
    }]);
  };

  const updateColumn = (index: number, field: keyof ColumnDefinition, value: string | boolean) => {
    const updated = [...columns];
    updated[index] = { ...updated[index], [field]: value };
    setColumns(updated);
    onUpdate({ ...table, columns: updated });
  };

  const removeColumn = (index: number) => {
    const updated = columns.filter((_, i) => i !== index);
    setColumns(updated);
    onUpdate({ ...table, columns: updated });
  };

  return (
    <div className="table-editor">
      <div className="table-header">
        <input
          type="text"
          value={table.name}
          onChange={(e) => onUpdate({ ...table, name: e.target.value })}
          placeholder="Table name"
          style={{ flex: 1, marginRight: 10 }}
        />
        <button className="btn btn-danger btn-small" onClick={onDelete}>
          Remove Table
        </button>
      </div>
      
      <div style={{ marginTop: 10 }}>
        <div className="column-row" style={{ fontWeight: 'bold', fontSize: 11, color: '#888' }}>
          <span style={{ flex: 1 }}>Column Name</span>
          <span style={{ width: 120 }}>Type</span>
          <span style={{ width: 30 }} title="Primary Key">PK</span>
          <span style={{ width: 30 }} title="Nullable">Null</span>
          <span style={{ width: 50 }}></span>
        </div>
        <div style={{ fontSize: 11, color: '#777', marginTop: 6, marginBottom: 8 }}>
          Select multiple PK checkboxes to create a composite primary key.
        </div>
        
        {columns.map((col, index) => (
          <div key={index} className="column-row">
            <input
              type="text"
              value={col.name}
              onChange={(e) => updateColumn(index, 'name', e.target.value)}
              placeholder="column_name"
            />
            <select
              value={col.type}
              onChange={(e) => updateColumn(index, 'type', e.target.value)}
            >
              {COLUMN_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              type="checkbox"
              checked={col.isPrimaryKey}
              onChange={(e) => updateColumn(index, 'isPrimaryKey', e.target.checked)}
              title="Primary Key"
            />
            <input
              type="checkbox"
              checked={col.isNullable}
              onChange={(e) => updateColumn(index, 'isNullable', e.target.checked)}
              title="Nullable"
            />
            <button
              className="btn btn-secondary btn-small"
              onClick={() => removeColumn(index)}
            >
              ✕
            </button>
          </div>
        ))}
        
        <button
          className="btn btn-secondary btn-small"
          onClick={addColumn}
          style={{ marginTop: 10 }}
        >
          + Add Column
        </button>
      </div>
    </div>
  );
}

type DatabaseConfigModalProps = {
  isOpen: boolean;
  data: DatabaseNodeData;
  onSave: (data: DatabaseNodeData) => void;
  onClose: () => void;
  onCreateDatabase: (data: DatabaseNodeData) => Promise<{ success: boolean; message: string }>;
};

export function DatabaseConfigModal({ isOpen, data, onSave, onClose, onCreateDatabase }: DatabaseConfigModalProps) {
  const [formData, setFormData] = useState<DatabaseNodeData>({
    label: data.label || 'Database',
    connectionName: data.connectionName || 'default',
    host: data.host || 'localhost',
    port: data.port || 5432,
    password: data.password || '',
    database: data.database || '',
    schema: data.schema || 'public',
    tables: data.tables || [],
  });
  
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    setFormData({
      label: data.label || 'Database',
      connectionName: data.connectionName || 'default',
      host: data.host || 'localhost',
      port: data.port || 5432,
      password: data.password || '',
      database: data.database || '',
      schema: data.schema || 'public',
      tables: data.tables || [],
    });
    setStatus(null);
  }, [data, isOpen]);

  if (!isOpen) return null;

  const addTable = () => {
    setFormData({
      ...formData,
      tables: [
        ...(formData.tables || []),
        {
          name: `table_${(formData.tables?.length || 0) + 1}`,
          columns: [
            { name: 'id', type: 'SERIAL', isPrimaryKey: true, isNullable: false },
          ],
        },
      ],
    });
  };

  const updateTable = (index: number, table: TableDefinition) => {
    const updated = [...(formData.tables || [])];
    updated[index] = table;
    setFormData({ ...formData, tables: updated });
  };

  const removeTable = (index: number) => {
    const updated = (formData.tables || []).filter((_, i) => i !== index);
    setFormData({ ...formData, tables: updated });
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  const handleCreateDatabase = async () => {
    setIsCreating(true);
    setStatus(null);
    
    try {
      // Keep UI node state in sync with what is being provisioned.
      onSave(formData);

      const result = await onCreateDatabase(formData);
      setStatus({
        type: result.success ? 'success' : 'error',
        message: result.message,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to create database',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>Configure Database</h2>
        
        {status && (
          <div className={`status-message ${status.type}`}>
            {status.message}
          </div>
        )}
        
        <h3>Connection Settings</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Label</label>
            <input
              type="text"
              value={formData.label}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Connection Name</label>
            <input
              type="text"
              value={formData.connectionName}
              onChange={(e) => setFormData({ ...formData, connectionName: e.target.value })}
            />
          </div>
        </div>
        
        <div className="form-row">
          <div className="form-group">
            <label>Host</label>
            <input
              type="text"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Port</label>
            <input
              type="number"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 5432 })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Postgres Password</label>
            <input
              type="password"
              value={formData.password as string}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="postgres"
            />
          </div>
          <div className="form-group"></div>
        </div>
        
        <div className="form-row">
          <div className="form-group">
            <label>Database Name</label>
            <input
              type="text"
              value={formData.database}
              onChange={(e) => setFormData({ ...formData, database: e.target.value })}
              placeholder="my_database"
            />
          </div>
          <div className="form-group">
            <label>Schema</label>
            <input
              type="text"
              value={formData.schema}
              onChange={(e) => setFormData({ ...formData, schema: e.target.value })}
            />
          </div>
        </div>
        
        <h3>
          Tables
          <button
            className="btn btn-secondary btn-small"
            onClick={addTable}
            style={{ marginLeft: 10 }}
          >
            + Add Table
          </button>
        </h3>
        
        {(formData.tables || []).map((table, index) => (
          <TableEditor
            key={index}
            table={table}
            onUpdate={(t) => updateTable(index, t)}
            onDelete={() => removeTable(index)}
          />
        ))}
        
        {(formData.tables || []).length === 0 && (
          <div style={{ color: '#888', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
            No tables defined. Click "Add Table" to create one.
          </div>
        )}
        
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-success"
            onClick={handleCreateDatabase}
            disabled={isCreating || !formData.database}
          >
            {isCreating ? 'Creating...' : 'Create Database'}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
