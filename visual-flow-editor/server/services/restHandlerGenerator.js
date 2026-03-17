// REST handler Go code generation. Converts a normalized API contract into a Go
// HTTP handler function. This is the layer most likely to change as the REST
// generation strategy evolves (e.g. adding middleware, auth, DB calls, etc.).

export function goLiteral(value) {
  return JSON.stringify(String(value ?? ''));
}

export function escapeGoString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function placeholderGoExprByType(typeName) {
  const normalized = String(typeName || '').toLowerCase();
  if (normalized === 'int' || normalized === 'float') return '0';
  if (normalized === 'bool' || normalized === 'boolean') return 'false';
  if (normalized === 'array') return '[]any{}';
  if (normalized === 'object') return 'map[string]any{}';
  return '""';
}

export function generateContractHandlerBlock(contract) {
  const requiredRequestFields = (contract.requestFields || [])
    .filter((field) => field.required && field.name)
    .map((field) => field.name);
  const responseFields = (contract.responseFields || []).filter((field) => field?.name);

  const requiredFieldChecks = requiredRequestFields
    .map(
      (fieldName) => `
	if _, exists := payload[${goLiteral(fieldName)}]; !exists {
		http.Error(w, "missing required field: ${escapeGoString(fieldName)}", http.StatusBadRequest)
		return
	}`,
    )
    .join('\n');

  const decodeBody =
    contract.method === 'GET' || contract.method === 'DELETE'
      ? ''
      : `
	var payload map[string]any
	if r.Body != nil {
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && err != io.EOF {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
	}
	if payload == nil {
		payload = map[string]any{}
	}${requiredFieldChecks}
`;

  const responseBuildLines =
    responseFields.length > 0
      ? responseFields
          .map((field) => `	responsePayload[${goLiteral(field.name)}] = ${placeholderGoExprByType(field.type)}`)
          .join('\n')
      : `	responsePayload["success"] = true\n	responsePayload["operation"] = ${goLiteral(contract.name)}`;

  const descLine = contract.description ? `\n\t// ${contract.description}` : '';

  return `func ${contract.handlerName}(w http.ResponseWriter, r *http.Request) {
	if r.Method != ${goLiteral(contract.method)} {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}${descLine}
	w.Header().Set("Content-Type", "application/json")${decodeBody}
	responsePayload := map[string]any{}
${responseBuildLines}
	json.NewEncoder(w).Encode(responsePayload)
}
`;
}
