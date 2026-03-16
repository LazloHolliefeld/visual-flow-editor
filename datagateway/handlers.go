package main

import (
  "database/sql"
  "encoding/json"
  "fmt"
  "log"
  "net/http"
  "regexp"
  "strings"

  _ "github.com/lib/pq"
)

var dbConnections = make(map[string]*sql.DB)

// allowedSchema[database][table][column] = true
var allowedSchema = map[string]map[string]map[string]bool{
	"myDB": {
		"Account": { "clientNum": true, "app": true, "status": true },
		"Customer": { "clientNum": true, "app": true, "name": true },
	},
}

var identRe = regexp.MustCompile("^[A-Za-z_][A-Za-z0-9_]*$")

func isSafeIdentifier(v string) bool {
  return identRe.MatchString(v)
}

func quoteIdent(v string) string {
  return "\"" + strings.ReplaceAll(v, "\"", "") + "\""
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
  LogicalOp      string                 
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
  LogicalOp      string                 
}

type updatePayload struct {
  Database string          
  Request  *updateRequest  
  Requests []updateRequest 
}

type deleteRequest struct {
  Name           string                 
  SearchCriteria map[string]interface{} 
  LogicalOp      string                 
}

type deletePayload struct {
  Database string          
  Request  *deleteRequest  
  Requests []deleteRequest 
}

func initDB() {

  // Connect to myDB
  connStrmydb := fmt.Sprintf("host=localhost port=5432 dbname=myDB user=postgres sslmode=disable")
  dbmydb, err := sql.Open("postgres", connStrmydb)
  if err != nil {
    log.Printf("Warning: Failed to connect to myDB: %v", err)
  } else {
    dbConnections["myDB"] = dbmydb
  }

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

func buildWhereClause(database, baseTable, baseAlias string, criteria map[string]interface{}, logical string, args *[]interface{}) (string, error) {
  if len(criteria) == 0 {
    return "", nil
  }

  parts := []string{}
  joinLogical := normalizeLogical(logical)

  for field, raw := range criteria {
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

        groupLogical := normalizeLogical(fmt.Sprintf("%v", typed["logicalOp"]))
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

  aliasToTable := map[string]string{baseAlias: baseTable}
  joinSQL := []string{}

  for i, j := range joins {
    if !isSafeIdentifier(j.Table) || !tableExists(database, j.Table) {
      return "", fmt.Errorf("invalid join table: %s", j.Table)
    }

    joinAlias := fmt.Sprintf("j%d", i+1)
    aliasToTable[joinAlias] = j.Table

    onParts := []string{}
    for joinCol, raw := range j.SearchCriteria {
      if !columnExists(database, j.Table, joinCol) {
        return "", fmt.Errorf("invalid join column %s on %s", joinCol, j.Table)
      }

      lhs := fmt.Sprintf("%s.%s", quoteIdent(joinAlias), quoteIdent(joinCol))

      switch typed := raw.(type) {
      case string:
        refAlias, refCol, ok := parseRef(typed)
        if !ok {
          return "", fmt.Errorf("invalid join ref: %s", typed)
        }
        refTable, ok := aliasToTable[refAlias]
        if !ok || !columnExists(database, refTable, refCol) {
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
          refAlias, refCol, ok := parseRef(fmt.Sprintf("%v", refRaw))
          if !ok {
            return "", fmt.Errorf("invalid join ref")
          }
          refTable, ok := aliasToTable[refAlias]
          if !ok || !columnExists(database, refTable, refCol) {
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

func buildSelectFields(database, baseTable, baseAlias string, fields []string) ([]string, error) {
  if len(fields) == 0 {
    return []string{baseAlias + ".*"}, nil
  }

  out := []string{}
  for _, f := range fields {
    if strings.Contains(f, ".") {
      alias, col, ok := parseRef(f)
      if !ok || !isSafeIdentifier(alias) || !isSafeIdentifier(col) {
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

    fields, err := buildSelectFields(payload.Database, req.Name, baseAlias, req.RetrieveFields)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

    joinSQL, err := buildJoinClause(payload.Database, req.Name, baseAlias, joins, &args)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

    whereSQL, err := buildWhereClause(payload.Database, req.Name, baseAlias, req.SearchCriteria, req.LogicalOp, &args)
    if err != nil {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
      return
    }

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
          alias, col, ok := parseRef(field)
          if !ok {
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

    rowsToInsert := req.Values
    if len(rowsToInsert) == 0 && req.Value != nil {
      rowsToInsert = append(rowsToInsert, req.Value)
    }
    if len(rowsToInsert) == 0 {
      writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "insert values required"})
      return
    }

    for _, row := range rowsToInsert {
      cols := []string{}
      ph := []string{}
      args := []interface{}{}
      i := 1
      for k, v := range row {
        if !columnExists(payload.Database, req.Name, k) {
          writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid insert column: " + k})
          return
        }
        cols = append(cols, quoteIdent(k))
        args = append(args, v)
        ph = append(ph, fmt.Sprintf("$%d", i))
        i++
      }

      query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", quoteIdent(req.Name), strings.Join(cols, ", "), strings.Join(ph, ", "))
      res, err := tx.Exec(query, args...)
      if err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": err.Error()})
        return
      }
      rc, _ := res.RowsAffected()
      affected += rc
    }
  }

  if err := tx.Commit(); err != nil {
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": err.Error()})
    return
  }

  writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "affected": affected})
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
      if !columnExists(payload.Database, req.Name, k) {
        writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "invalid update column: " + k})
        return
      }
      args = append(args, v)
      setParts = append(setParts, fmt.Sprintf("%s = $%d", quoteIdent(k), len(args)))
    }

    whereSQL, err := buildWhereClause(payload.Database, req.Name, req.Name, req.SearchCriteria, req.LogicalOp, &args)
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
    whereSQL, err := buildWhereClause(payload.Database, req.Name, req.Name, req.SearchCriteria, req.LogicalOp, &args)
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
