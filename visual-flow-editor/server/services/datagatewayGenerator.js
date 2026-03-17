function sanitizeIdentifier(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
}

export function generateDataGateway(dbNodes) {
  const databases = dbNodes.map(n => n.data);
  const schemaMap = databases.map(db => {
    const tables = (db.tables || []).map(table => {
      const columns = (table.columns || [])
        .filter(c => c && c.name)
        .map(c => `"${c.name}": true`)
        .join(', ');
      return `		"${table.name}": { ${columns} },`;
    }).join('\n');
    return `	"${db.database}": {\n${tables}\n\t},`;
  }).join('\n');
  
  const main = `package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	// Initialize database connections
	initDB()
	defer closeDB()
	
	// Start gRPC server in background
	go startGRPCServer()
	
	// Start GraphQL server
	go startGraphQLServer()
	
	// REST API routes
	mux := http.NewServeMux()
	registerRoutes(mux)
	
	fmt.Printf("DataGateway starting on :%s\\n", port)
	fmt.Printf("  REST:    http://localhost:%s/api/\\n", port)
	fmt.Printf("  gRPC:    localhost:50051\\n")
	fmt.Printf("  GraphQL: http://localhost:8081/graphql\\n")
	
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
`;

  const handlers = `package main

import (
  "database/sql"
  "encoding/json"
  "fmt"
  "log"
  "net/http"
  "os"
  "regexp"
  "strings"

  _ "github.com/lib/pq"
)

var dbConnections = make(map[string]*sql.DB)

// allowedSchema[database][table][column] = true
var allowedSchema = map[string]map[string]map[string]bool{
${schemaMap}
}

var identRe = regexp.MustCompile("^[A-Za-z_][A-Za-z0-9_]*$")

func isSafeIdentifier(v string) bool {
  return identRe.MatchString(v)
}

func quoteIdent(v string) string {
  return "\\\"" + strings.ReplaceAll(v, "\\\"", "") + "\\\""
}

func tableExists(database, table string) bool {
  _, ok := allowedSchema[database]
  if !ok {
    return false
  }
  _, ok = allowedSchema[database][table]
  return ok
}

func columnExists(database, table, column string) bool {
  if !tableExists(database, table) {
    return false
  }
  return allowedSchema[database][table][column]
}

func isProtectedIdentityColumn(database, table, column string) bool {
  return strings.EqualFold(column, "id") && columnExists(database, table, column)
}

func parseRef(raw string) (alias string, column string, ok bool) {
  parts := strings.Split(raw, ".")
  if len(parts) != 2 {
    return "", "", false
  }
  if !isSafeIdentifier(parts[0]) || !isSafeIdentifier(parts[1]) {
    return "", "", false
  }
  return parts[0], parts[1], true
}

func buildReferenceMaps(baseTable, baseAlias string, joins []joinInput) (map[string]string, map[string]string) {
  aliasToTable := map[string]string{baseAlias: baseTable}
  tableToAlias := map[string]string{strings.ToLower(baseTable): baseAlias}

  for i, j := range joins {
    joinAlias := fmt.Sprintf("j%d", i+1)
    aliasToTable[joinAlias] = j.Table
    if _, exists := tableToAlias[strings.ToLower(j.Table)]; !exists {
      tableToAlias[strings.ToLower(j.Table)] = joinAlias
    }
  }

  return aliasToTable, tableToAlias
}

func resolveRefAliasOrTable(raw string, aliasToTable map[string]string, tableToAlias map[string]string) (resolvedAlias string, resolvedTable string, resolvedCol string, err error) {
  left, col, ok := parseRef(raw)
  if !ok {
    return "", "", "", fmt.Errorf("invalid ref: %s", raw)
  }

  if table, exists := aliasToTable[left]; exists {
    return left, table, col, nil
  }

  if alias, exists := tableToAlias[strings.ToLower(left)]; exists {
    return alias, aliasToTable[alias], col, nil
  }

  return "", "", "", fmt.Errorf("invalid ref: %s", raw)
}

type conditionInput struct {
  Op    string      
  Value interface{} 
  Ref   string      
}

type groupedConditionInput struct {
  LogicalOp  string           
  Conditions []conditionInput 
}

type joinInput struct {
  Table          string                 
  Type           string                 
  SearchCriteria map[string]interface{} 
}

type fetchRequest struct {
  Name           string                 
  SearchCriteria map[string]interface{} 
  RetrieveFields []string               
  Join           *joinInput             
  Joins          []joinInput            
  OrderBy        []map[string]string    
  Limit          int                    
  Offset         int                    
}

type fetchPayload struct {
  Database string         
  Request  *fetchRequest  
  Requests []fetchRequest 
}

type insertRequest struct {
  Name   string                   
  Values []map[string]interface{} 
  Value  map[string]interface{}   
}

type insertPayload struct {
  Database string          
  Request  *insertRequest  
  Requests []insertRequest 
}

type updateRequest struct {
  Name           string                 
  Values         map[string]interface{} 
  SearchCriteria map[string]interface{} 
}

type updatePayload struct {
  Database string          
  Request  *updateRequest  
  Requests []updateRequest 
}

type deleteRequest struct {
  Name           string                 
  SearchCriteria map[string]interface{} 
}

type deletePayload struct {
  Database string          
  Request  *deleteRequest  
  Requests []deleteRequest 
}

func initDB() {
  dbPasswordFromEnv := os.Getenv("PGPASSWORD")
${databases.map(db => `
  // Connect to ${db.database}
  dbPassword${sanitizeIdentifier(db.database)} := ${JSON.stringify(db.password || '')}
  if dbPassword${sanitizeIdentifier(db.database)} == "" {
    dbPassword${sanitizeIdentifier(db.database)} = dbPasswordFromEnv
  }
  if dbPassword${sanitizeIdentifier(db.database)} == "" {
    dbPassword${sanitizeIdentifier(db.database)} = "postgres"
  }
  connStr${sanitizeIdentifier(db.database)} := fmt.Sprintf("host=${db.host} port=${db.port} dbname=${db.database} user=postgres password=%s sslmode=disable", dbPassword${sanitizeIdentifier(db.database)})
  db${sanitizeIdentifier(db.database)}, err := sql.Open("postgres", connStr${sanitizeIdentifier(db.database)})
  if err != nil {
    log.Printf("Warning: Failed to connect to ${db.database}: %v", err)
  } else {
    dbConnections["${db.database}"] = db${sanitizeIdentifier(db.database)}
  }
`).join('')}
}

func closeDB() {
  for _, db := range dbConnections {
    db.Close()
  }
}

func registerRoutes(mux *http.ServeMux) {
  mux.HandleFunc("/api/query/fetch", handleFetch)
  mux.HandleFunc("/api/query/insert", handleInsert)
  mux.HandleFunc("/api/query/update", handleUpdate)
  mux.HandleFunc("/api/query/delete", handleDelete)
}

func normalizeLogical(logical string) string {
  if strings.EqualFold(logical, "or") {
    return "OR"
  }
  return "AND"
}

func normalizeOp(op string) (string, bool) {
  switch strings.ToLower(op) {
  case "eq":
    return "=", true
  case "ne":
    return "<>", true
  case "gt":
    return ">", true
  case "gte":
    return ">=", true
  case "lt":
    return "<", true
  case "lte":
    return "<=", true
  case "like":
    return "LIKE", true
  case "ilike":
    return "ILIKE", true
  default:
    return "", false
  }
}

func appendValueCondition(parts *[]string, args *[]interface{}, lhs string, op string, value interface{}) {
  *args = append(*args, value)
  *parts = append(*parts, fmt.Sprintf("%s %s $%d", lhs, op, len(*args)))
}

func extractWhereLogical(criteria map[string]interface{}) (map[string]interface{}, string, error) {
  if len(criteria) == 0 {
    return criteria, "AND", nil
  }

  logical := "AND"
  cleaned := map[string]interface{}{}
  for key, value := range criteria {
    if strings.EqualFold(key, "logicalOp") {
      logical = normalizeLogical(fmt.Sprintf("%v", value))
      continue
    }
    cleaned[key] = value
  }

  return cleaned, logical, nil
}

func buildWhereClause(database, baseTable, baseAlias string, criteria map[string]interface{}, args *[]interface{}) (string, error) {
  cleanedCriteria, joinLogical, err := extractWhereLogical(criteria)
  if err != nil {
    return "", err
  }
  if len(criteria) == 0 {
    return "", nil
  }

  parts := []string{}
  if len(cleanedCriteria) == 0 {
    return "", nil
  }

  for field, raw := range cleanedCriteria {
    if !columnExists(database, baseTable, field) {
      return "", fmt.Errorf("invalid field in searchCriteria: %s", field)
    }

    lhs := fmt.Sprintf("%s.%s", quoteIdent(baseAlias), quoteIdent(field))

    switch typed := raw.(type) {
    case map[string]interface{}:
      if condsRaw, ok := typed["conditions"]; ok {
        condsList, ok := condsRaw.([]interface{})
        if !ok || len(condsList) == 0 {
          return "", fmt.Errorf("conditions must be a non-empty array for field %s", field)
        }

        groupLogical := joinLogical
        if groupLogicalRaw, hasGroupLogical := typed["logicalOp"]; hasGroupLogical {
          groupLogical = normalizeLogical(fmt.Sprintf("%v", groupLogicalRaw))
          if groupLogical != joinLogical {
            return "", fmt.Errorf("mixing AND and OR in one searchCriteria is not supported")
          }
        }
        groupParts := []string{}
        for _, c := range condsList {
          cMap, ok := c.(map[string]interface{})
          if !ok {
            return "", fmt.Errorf("invalid condition entry for field %s", field)
          }
          op, ok := normalizeOp(fmt.Sprintf("%v", cMap["op"]))
          if !ok {
            return "", fmt.Errorf("unsupported operator for field %s", field)
          }

          if refRaw, hasRef := cMap["ref"]; hasRef {
            refAlias, refCol, ok := parseRef(fmt.Sprintf("%v", refRaw))
            if !ok || !isSafeIdentifier(refAlias) || !isSafeIdentifier(refCol) {
              return "", fmt.Errorf("invalid ref for field %s", field)
            }
            groupParts = append(groupParts, fmt.Sprintf("%s %s %s.%s", lhs, op, quoteIdent(refAlias), quoteIdent(refCol)))
          } else {
            appendValueCondition(&groupParts, args, lhs, op, cMap["value"])
          }
        }

        parts = append(parts, "("+strings.Join(groupParts, " "+groupLogical+" ")+")")
      } else {
        op := "="
        if opRaw, ok := typed["op"]; ok {
          norm, ok := normalizeOp(fmt.Sprintf("%v", opRaw))
          if !ok {
            return "", fmt.Errorf("unsupported operator for field %s", field)
          }
          op = norm
        }

        if refRaw, hasRef := typed["ref"]; hasRef {
          refAlias, refCol, ok := parseRef(fmt.Sprintf("%v", refRaw))
          if !ok || !isSafeIdentifier(refAlias) || !isSafeIdentifier(refCol) {
            return "", fmt.Errorf("invalid ref for field %s", field)
          }
          parts = append(parts, fmt.Sprintf("%s %s %s.%s", lhs, op, quoteIdent(refAlias), quoteIdent(refCol)))
        } else {
          appendValueCondition(&parts, args, lhs, op, typed["value"])
        }
      }
    default:
      appendValueCondition(&parts, args, lhs, "=", raw)
    }
  }

  return " WHERE " + strings.Join(parts, " "+joinLogical+" "), nil
}

func joinTypeOrDefault(v string) string {
  switch strings.ToLower(v) {
  case "inner":
    return "INNER"
  case "left":
    return "LEFT"
  case "right":
    return "RIGHT"
  default:
    return "INNER"
  }
}

func buildJoinClause(database, baseTable, baseAlias string, joins []joinInput, args *[]interface{}) (string, error) {
  if len(joins) == 0 {
    return "", nil
  }

  aliasToTable, tableToAlias := buildReferenceMaps(baseTable, baseAlias, joins)
  joinSQL := []string{}

  for i, j := range joins {
    if !isSafeIdentifier(j.Table) || !tableExists(database, j.Table) {
      return "", fmt.Errorf("invalid join table: %s", j.Table)
    }

    joinAlias := fmt.Sprintf("j%d", i+1)

    onParts := []string{}
    for joinCol, raw := range j.SearchCriteria {
      if !columnExists(database, j.Table, joinCol) {
        return "", fmt.Errorf("invalid join column %s on %s", joinCol, j.Table)
      }

      lhs := fmt.Sprintf("%s.%s", quoteIdent(joinAlias), quoteIdent(joinCol))

      switch typed := raw.(type) {
      case string:
        refAlias, refTable, refCol, err := resolveRefAliasOrTable(typed, aliasToTable, tableToAlias)
        if err != nil || !columnExists(database, refTable, refCol) {
          return "", fmt.Errorf("invalid join ref field: %s", typed)
        }
        onParts = append(onParts, fmt.Sprintf("%s = %s.%s", lhs, quoteIdent(refAlias), quoteIdent(refCol)))
      case map[string]interface{}:
        op := "="
        if opRaw, ok := typed["op"]; ok {
          norm, ok := normalizeOp(fmt.Sprintf("%v", opRaw))
          if !ok {
            return "", fmt.Errorf("invalid join operator")
          }
          op = norm
        }

        if refRaw, ok := typed["ref"]; ok {
          refAlias, refTable, refCol, err := resolveRefAliasOrTable(fmt.Sprintf("%v", refRaw), aliasToTable, tableToAlias)
          if err != nil {
            return "", fmt.Errorf("invalid join ref")
          }
          if !columnExists(database, refTable, refCol) {
            return "", fmt.Errorf("invalid join ref field")
          }
          onParts = append(onParts, fmt.Sprintf("%s %s %s.%s", lhs, op, quoteIdent(refAlias), quoteIdent(refCol)))
        } else {
          appendValueCondition(&onParts, args, lhs, op, typed["value"])
        }
      default:
        appendValueCondition(&onParts, args, lhs, "=", raw)
      }
    }

    if len(onParts) == 0 {
      return "", fmt.Errorf("join searchCriteria required for table %s", j.Table)
    }

    joinSQL = append(joinSQL, fmt.Sprintf(" %s JOIN %s %s ON %s", joinTypeOrDefault(j.Type), quoteIdent(j.Table), quoteIdent(joinAlias), strings.Join(onParts, " AND ")))
  }

  return strings.Join(joinSQL, ""), nil
}

func buildSelectFields(database, baseTable, baseAlias string, joins []joinInput, fields []string) ([]string, error) {
  if len(fields) == 0 {
    return []string{baseAlias + ".*"}, nil
  }

  aliasToTable, tableToAlias := buildReferenceMaps(baseTable, baseAlias, joins)

  out := []string{}
  for _, f := range fields {
    if strings.Contains(f, ".") {
      alias, refTable, col, err := resolveRefAliasOrTable(f, aliasToTable, tableToAlias)
      if err != nil || !columnExists(database, refTable, col) {
        return nil, fmt.Errorf("invalid retrieveFields entry: %s", f)
      }
      out = append(out, fmt.Sprintf("%s.%s", quoteIdent(alias), quoteIdent(col)))
      continue
    }

    if !columnExists(database, baseTable, f) {
      return nil, fmt.Errorf("invalid retrieve field for base table: %s", f)
    }
    out = append(out, fmt.Sprintf("%s.%s", quoteIdent(baseAlias), quoteIdent(f)))
  }

  return out, nil
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
  w.Header().Set("Content-Type", "application/json")
  w.WriteHeader(status)
  json.NewEncoder(w).Encode(payload)
}

func getDBOrWriteError(w http.ResponseWriter, database string) *sql.DB {
  db := dbConnections[database]
  if db == nil {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "database not connected"})
    return nil
  }
  return db
}

func handleFetch(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"success": false, "message": "method not allowed"})
    return
  }

  var payload fetchPayload
  if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid JSON payload"})
    return
  }

  if payload.Database == "" {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "database is required"})
    return
  }

  db := getDBOrWriteError(w, payload.Database)
  if db == nil {
    return
  }

  requests := payload.Requests
  if payload.Request != nil {
    requests = append(requests, *payload.Request)
  }
  if len(requests) == 0 {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "request or requests is required"})
    return
  }

  results := make([]map[string]interface{}, 0, len(requests))

  for _, req := range requests {
    if !isSafeIdentifier(req.Name) || !tableExists(payload.Database, req.Name) {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid table name: " + req.Name})
      return
    }

    baseAlias := "t0"
    args := []interface{}{}

    joins := req.Joins
    if req.Join != nil {
      joins = append(joins, *req.Join)
    }

    fields, err := buildSelectFields(payload.Database, req.Name, baseAlias, joins, req.RetrieveFields)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

    joinSQL, err := buildJoinClause(payload.Database, req.Name, baseAlias, joins, &args)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

    whereSQL, err := buildWhereClause(payload.Database, req.Name, baseAlias, req.SearchCriteria, &args)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

    aliasToTable, tableToAlias := buildReferenceMaps(req.Name, baseAlias, joins)

    orderSQL := ""
    if len(req.OrderBy) > 0 {
      parts := []string{}
      for _, ob := range req.OrderBy {
        field := ob["field"]
        dir := strings.ToUpper(ob["dir"])
        if dir != "DESC" {
          dir = "ASC"
        }

        if strings.Contains(field, ".") {
          alias, refTable, col, err := resolveRefAliasOrTable(field, aliasToTable, tableToAlias)
          if err != nil || !columnExists(payload.Database, refTable, col) {
            writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid orderBy field"})
            return
          }
          parts = append(parts, fmt.Sprintf("%s.%s %s", quoteIdent(alias), quoteIdent(col), dir))
        } else {
          if !columnExists(payload.Database, req.Name, field) {
            writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid orderBy field"})
            return
          }
          parts = append(parts, fmt.Sprintf("%s.%s %s", quoteIdent(baseAlias), quoteIdent(field), dir))
        }
      }
      orderSQL = " ORDER BY " + strings.Join(parts, ", ")
    }

    limitSQL := ""
    if req.Limit > 0 {
      limitSQL = fmt.Sprintf(" LIMIT %d", req.Limit)
    }
    offsetSQL := ""
    if req.Offset > 0 {
      offsetSQL = fmt.Sprintf(" OFFSET %d", req.Offset)
    }

    query := fmt.Sprintf("SELECT %s FROM %s %s%s%s%s%s%s", strings.Join(fields, ", "), quoteIdent(req.Name), quoteIdent(baseAlias), joinSQL, whereSQL, orderSQL, limitSQL, offsetSQL)
    rows, err := db.Query(query, args...)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error(), "query": query})
      return
    }

    cols, _ := rows.Columns()
    items := []map[string]interface{}{}
    for rows.Next() {
      vals := make([]interface{}, len(cols))
      ptrs := make([]interface{}, len(cols))
      for i := range vals {
        ptrs[i] = &vals[i]
      }
      if err := rows.Scan(ptrs...); err != nil {
        rows.Close()
        writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
        return
      }
      m := map[string]interface{}{}
      for i, c := range cols {
        m[c] = vals[i]
      }
      items = append(items, m)
    }
    rows.Close()

    results = append(results, map[string]interface{}{
      "name": req.Name,
      "records": items,
    })
  }

  writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "results": results})
}

func handleInsert(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"success": false, "message": "method not allowed"})
    return
  }

  var payload insertPayload
  if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid JSON payload"})
    return
  }

  if payload.Database == "" {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "database is required"})
    return
  }

  db := getDBOrWriteError(w, payload.Database)
  if db == nil {
    return
  }

  requests := payload.Requests
  if payload.Request != nil {
    requests = append(requests, *payload.Request)
  }
  if len(requests) == 0 {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "request or requests is required"})
    return
  }

  tx, err := db.Begin()
  if err != nil {
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
    return
  }
  defer tx.Rollback()

  affected := int64(0)
  results := make([]map[string]interface{}, 0, len(requests))
  for _, req := range requests {
    if !isSafeIdentifier(req.Name) || !tableExists(payload.Database, req.Name) {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid table name: " + req.Name})
      return
    }

    rowsToInsert := req.Values
    if len(rowsToInsert) == 0 && req.Value != nil {
      rowsToInsert = append(rowsToInsert, req.Value)
    }
    if len(rowsToInsert) == 0 {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "insert values required"})
      return
    }

    insertedRows := []map[string]interface{}{}

    for _, row := range rowsToInsert {
      cols := []string{}
      ph := []string{}
      args := []interface{}{}
      i := 1
      for k, v := range row {
        if isProtectedIdentityColumn(payload.Database, req.Name, k) {
          writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "id is auto-generated and cannot be provided"})
          return
        }
        if !columnExists(payload.Database, req.Name, k) {
          writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid insert column: " + k})
          return
        }
        cols = append(cols, quoteIdent(k))
        args = append(args, v)
        ph = append(ph, fmt.Sprintf("$%d", i))
        i++
      }

      query := ""
      if len(cols) == 0 {
        query = fmt.Sprintf("INSERT INTO %s DEFAULT VALUES RETURNING *", quoteIdent(req.Name))
      } else {
        query = fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) RETURNING *", quoteIdent(req.Name), strings.Join(cols, ", "), strings.Join(ph, ", "))
      }

      rows, err := tx.Query(query, args...)
      if err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
        return
      }

      colsReturned, _ := rows.Columns()
      for rows.Next() {
        vals := make([]interface{}, len(colsReturned))
        ptrs := make([]interface{}, len(colsReturned))
        for i := range vals {
          ptrs[i] = &vals[i]
        }
        if err := rows.Scan(ptrs...); err != nil {
          rows.Close()
          writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
          return
        }

        m := map[string]interface{}{}
        for i, c := range colsReturned {
          m[c] = vals[i]
        }
        insertedRows = append(insertedRows, m)
        affected += 1
      }
      rows.Close()
    }

    results = append(results, map[string]interface{}{
      "name": req.Name,
      "records": insertedRows,
    })
  }

  if err := tx.Commit(); err != nil {
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
    return
  }

  writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "affected": affected, "results": results})
}

func handleUpdate(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"success": false, "message": "method not allowed"})
    return
  }

  var payload updatePayload
  if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid JSON payload"})
    return
  }

  db := getDBOrWriteError(w, payload.Database)
  if db == nil {
    return
  }

  requests := payload.Requests
  if payload.Request != nil {
    requests = append(requests, *payload.Request)
  }
  if len(requests) == 0 {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "request or requests is required"})
    return
  }

  tx, err := db.Begin()
  if err != nil {
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
    return
  }
  defer tx.Rollback()

  affected := int64(0)
  for _, req := range requests {
    if !isSafeIdentifier(req.Name) || !tableExists(payload.Database, req.Name) {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid table name: " + req.Name})
      return
    }

    if len(req.Values) == 0 {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "values required for update"})
      return
    }

    setParts := []string{}
    args := []interface{}{}
    for k, v := range req.Values {
      if isProtectedIdentityColumn(payload.Database, req.Name, k) {
        writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "id is auto-generated and cannot be updated"})
        return
      }
      if !columnExists(payload.Database, req.Name, k) {
        writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid update column: " + k})
        return
      }
      args = append(args, v)
      setParts = append(setParts, fmt.Sprintf("%s = $%d", quoteIdent(k), len(args)))
    }

    whereSQL, err := buildWhereClause(payload.Database, req.Name, req.Name, req.SearchCriteria, &args)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

    if whereSQL == "" {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "searchCriteria required for update"})
      return
    }

    query := fmt.Sprintf("UPDATE %s SET %s%s", quoteIdent(req.Name), strings.Join(setParts, ", "), whereSQL)
    res, err := tx.Exec(query, args...)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }
    rc, _ := res.RowsAffected()
    affected += rc
  }

  if err := tx.Commit(); err != nil {
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
    return
  }

  writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "affected": affected})
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"success": false, "message": "method not allowed"})
    return
  }

  var payload deletePayload
  if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid JSON payload"})
    return
  }

  db := getDBOrWriteError(w, payload.Database)
  if db == nil {
    return
  }

  requests := payload.Requests
  if payload.Request != nil {
    requests = append(requests, *payload.Request)
  }
  if len(requests) == 0 {
    writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "request or requests is required"})
    return
  }

  tx, err := db.Begin()
  if err != nil {
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
    return
  }
  defer tx.Rollback()

  affected := int64(0)
  for _, req := range requests {
    if !isSafeIdentifier(req.Name) || !tableExists(payload.Database, req.Name) {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid table name: " + req.Name})
      return
    }

    args := []interface{}{}
    whereSQL, err := buildWhereClause(payload.Database, req.Name, req.Name, req.SearchCriteria, &args)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

    if whereSQL == "" {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "searchCriteria required for delete"})
      return
    }

    query := fmt.Sprintf("DELETE FROM %s%s", quoteIdent(req.Name), whereSQL)
    res, err := tx.Exec(query, args...)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }
    rc, _ := res.RowsAffected()
    affected += rc
  }

  if err := tx.Commit(); err != nil {
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
    return
  }

  writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "affected": affected})
}
`;

  const grpc = `package main

import (
	"log"
	"net"
	
	"google.golang.org/grpc"
)

func startGRPCServer() {
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Printf("Failed to start gRPC server: %v", err)
		return
	}
	
	server := grpc.NewServer()
	// Register services here
	
	log.Printf("gRPC server listening on :50051")
	if err := server.Serve(lis); err != nil {
		log.Printf("gRPC server error: %v", err)
	}
}
`;

  const graphql = `package main

import (
	"encoding/json"
	"log"
	"net/http"
	
	"github.com/graphql-go/graphql"
)

func startGraphQLServer() {
	schema, err := graphql.NewSchema(graphql.SchemaConfig{
		Query: graphql.NewObject(graphql.ObjectConfig{
			Name: "Query",
			Fields: graphql.Fields{
				"health": &graphql.Field{
					Type: graphql.String,
					Resolve: func(p graphql.ResolveParams) (interface{}, error) {
						return "ok", nil
					},
				},
				// Add more query fields for each table
			},
		}),
	})
	
	if err != nil {
		log.Printf("Failed to create GraphQL schema: %v", err)
		return
	}
	
	http.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
		var params struct {
			Query string \`json:"query"\`
		}
		json.NewDecoder(r.Body).Decode(&params)
		
		result := graphql.Do(graphql.Params{
			Schema:        schema,
			RequestString: params.Query,
		})
		
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})
	
	log.Printf("GraphQL server listening on :8081")
	http.ListenAndServe(":8081", nil)
}
`;

  const goMod = `module datagateway

go 1.21

require (
	github.com/lib/pq v1.10.9
	github.com/graphql-go/graphql v0.8.1
	google.golang.org/grpc v1.59.0
)
`;

  return { main, handlers, grpc, graphql, goMod };
}

// Helper: Generate DataGateway README
export function generateDataGatewayReadme(dbNodes) {
  return `# DataGateway

Auto-generated data access layer with REST, gRPC, and GraphQL support.

## Databases

${dbNodes.map(n => `- **${n.data.database}** (${n.data.host}:${n.data.port})`).join('\n')}

## Running

\`\`\`bash
go mod tidy
go run .
\`\`\`

## Endpoints

- REST: http://localhost:8080/api/
- gRPC: localhost:50051
- GraphQL: http://localhost:8081/graphql

## Database Layout Export

- \`db-layout.json\` is generated in this folder whenever DataGateway is generated.
- You can import this file back into the Database modal to recreate connection and table definitions.

## REST API

### Query Endpoints
- POST /api/query/fetch
- POST /api/query/insert
- POST /api/query/update
- POST /api/query/delete

### Features
- Body-driven requests (single or batch via \`requests\`)
- Multi-table fetch with \`join\` / \`joins\` (INNER/LEFT/RIGHT)
- Logical operators: \`and\`, \`or\`
- Relational operators: \`eq\`, \`ne\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`, \`like\`, \`ilike\`
- Sorting and paging: \`orderBy\`, \`limit\`, \`offset\`

### Example Fetch Payload
\`\`\`json
{
  "database": "myDB",
  "request": {
    "name": "Account",
    "searchCriteria": {
      "logicalOp": "or",
      "clientNum": "2220",
      "app": "1234",
      "status": {
        "conditions": [
          { "op": "eq", "value": "active" },
          { "op": "eq", "value": "pending" }
        ]
      }
    },
    "retrieveFields": ["clientNum", "status", "app"],
    "join": {
      "table": "Customer",
      "type": "inner",
      "searchCriteria": {
        "clientNum": "Account.clientNum",
        "app": { "op": "gt", "ref": "Account.app" }
      }
    },
    "orderBy": [
      { "field": "Account.clientNum", "dir": "asc" }
    ]
  }
}
\`\`\`
`;
}

