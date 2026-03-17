// Shared API contract types used by ServiceNode, ApiRequestBuilderModal, and future tooling.

export interface ApiContractField {
  name: string;
  type: string;
  required?: boolean;
  location?: 'path' | 'query' | 'header' | 'body';
  description?: string;
}

export interface ApiContract {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description?: string;
  requestFields: ApiContractField[];
  responseFields: ApiContractField[];
}
