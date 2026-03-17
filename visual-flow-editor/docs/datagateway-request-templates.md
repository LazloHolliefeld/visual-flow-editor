# DataGateway Request Templates (Reference)

This document shows the request body shapes accepted by DataGateway query endpoints.

All endpoints are `POST`:
- `/api/query/fetch`
- `/api/query/insert`
- `/api/query/update`
- `/api/query/delete`

## Example Schema Used In This Doc

Assume these tables exist in `myDB`:
- `Account(id, acctId, customerId, status, app, balance, createdAt)`
- `Customer(id, customerId, customerName, tier, region)`
- `Invoice(id, acctId, amount, dueDate, state)`

`id` is auto-generated identity and is protected by DataGateway:
- Do not send `id` in `insert` values.
- Do not send `id` in `update` values.

## Operator Support

`searchCriteria` and join object conditions support:
- `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`

Logical combiner support is inside `searchCriteria`:
- `searchCriteria.logicalOp` = `AND` or `OR`
- If omitted, default is `AND`
- Mixing `AND` and `OR` in one `searchCriteria` tree is currently rejected

If `op` is omitted, default is `eq`.

## FETCH Templates

### 1. Minimal fetch (single request)

```jsonc
{
  "database": "myDB",                              // Required DB key
  "request": {                                      // Single request mode
    "name": "Account"                             // Required table
  }
}
```

### 2. Fetch with fields, AND criteria, sort, pagination

```jsonc
{
  "database": "myDB",                              // Target connected database
  "request": {
    "name": "Account",                             // Base table (alias = t0 internally)
    "retrieveFields": [                              // Optional; if omitted, returns t0.*
      "acctId",                                      // Base table field
      "customerId",
      "status",
      "balance"
    ],
    "searchCriteria": {
      "logicalOp": "AND",                         // Combines these searchCriteria fields
      "status": "ACTIVE",                          // Implicit eq
      "balance": { "op": "gt", "value": 0 }   // Explicit operator
    },
    "orderBy": [
      { "field": "balance", "dir": "DESC" },   // dir: DESC or ASC (anything else => ASC)
      { "field": "acctId", "dir": "ASC" }
    ],
    "limit": 50,                                     // Optional > 0
    "offset": 0                                      // Optional > 0
  }
}
```

### 3. Fetch with OR criteria + grouped conditions

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Customer",
    "searchCriteria": {
      "logicalOp": "OR",                          // Root combiner for this criteria set
      "tier": {                                      // Grouped conditions for one field
        "conditions": [                              // Non-empty array required
          { "op": "eq", "value": "GOLD" },
          { "op": "eq", "value": "PLATINUM" }
        ]
      },
      "region": { "op": "ilike", "value": "%west%" }
    }
  }
}
```

### 4. Fetch with one join (`join`) and field refs

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Account",                             // Base table
    "searchCriteria": {                              // Yes: base-table filter works while joining
      "logicalOp": "AND",
      "status": "ACTIVE"
    },
    "join": {                                        // Backward-compatible single join
      "table": "Customer",                         // Joined table
      "type": "left",                              // inner | left | right (default inner)
      "searchCriteria": {
        "customerId": "Account.customerId"         // Table-qualified ref (preferred over internal aliases)
      }
    },
    "retrieveFields": [
      "acctId",                                      // Base table field
      "Customer.customerName",                       // Table-qualified joined field
      "Customer.tier"
    ],
    "orderBy": [
      { "field": "Customer.customerName", "dir": "ASC" }
    ]
  }
}
```

### 5. Fetch with multiple joins (`joins`) and join operators

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Account",
    "joins": [
      {
        "table": "Customer",
        "type": "inner",
        "searchCriteria": {
          "customerId": { "op": "eq", "ref": "Account.customerId" }
        }
      },
      {
        "table": "Invoice",
        "type": "left",
        "searchCriteria": {
          "acctId": "Account.acctId",             // Table-qualified ref
          "state": { "op": "ne", "value": "VOID" }
        }
      }
    ],
    "retrieveFields": [
      "acctId",
      "status",
      "Customer.customerName",
      "Invoice.amount"
    ],
    "searchCriteria": {
      "logicalOp": "AND",
      "status": { "op": "eq", "value": "ACTIVE" }
    }
  }
}
```

### 6. Fetch with every comparison operator

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Invoice",
    "searchCriteria": {
      "logicalOp": "AND",
      "amount": { "op": "gt", "value": 100 },  // gt
      "dueDate": { "op": "gte", "value": "2026-01-01" },
      "state": { "op": "ne", "value": "PAID" },
      "acctId": { "op": "lt", "value": 9000 },
      "id": { "op": "lte", "value": 500000 },
      "app": { "op": "like", "value": "web%" },
      "status": { "op": "ilike", "value": "%active%" }
    }
  }
}
```

### 7. Batch fetch (`requests`) and mixed `request` + `requests`

```jsonc
{
  "database": "myDB",
  "requests": [                                      // Batch mode
    {
      "name": "Account",
      "searchCriteria": { "status": "ACTIVE" }
    },
    {
      "name": "Customer",
      "searchCriteria": { "tier": "GOLD" }
    }
  ],
  "request": {                                       // If both are present, server appends this one too
    "name": "Invoice",
    "searchCriteria": { "state": "OPEN" }
  }
}
```

## INSERT Templates

### 1. Insert single row (`value`)

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Account",
    "value": {                                       // Single row insert
      "acctId": 101,
      "customerId": 77,
      "status": "ACTIVE",
      "app": "web",
      "balance": 250.75
    }
  }
}
```

### 2. Insert multiple rows (`values`)

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Customer",
    "values": [                                      // Multi-row insert
      { "customerId": 77, "customerName": "Alice", "tier": "GOLD", "region": "WEST" },
      { "customerId": 88, "customerName": "Bob", "tier": "SILVER", "region": "EAST" }
    ]
  }
}
```

### 3. Insert default row (no columns)

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Invoice",
    "value": {}                                      // Generates: INSERT DEFAULT VALUES RETURNING *
  }
}
```

### 4. Batch insert (`requests`)

```jsonc
{
  "database": "myDB",
  "requests": [
    {
      "name": "Account",
      "values": [
        { "acctId": 5001, "customerId": 9001, "status": "ACTIVE", "app": "mobile" }
      ]
    },
    {
      "name": "Customer",
      "values": [
        { "customerId": 9001, "customerName": "Carol", "tier": "PLATINUM", "region": "NORTH" }
      ]
    }
  ]
}
```

### 5. Invalid insert example (protected id)

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Account",
    "value": {
      "id": 123,                                     // Invalid: DataGateway rejects client-provided id
      "acctId": 101,
      "customerId": 77
    }
  }
}
```

## UPDATE Templates

### 1. Basic update with AND criteria

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Account",
    "values": {
      "status": "SUSPENDED",                       // Columns to set
      "app": "mobile-v2"
    },
    "searchCriteria": {
      "logicalOp": "AND",
      "acctId": 101,
      "customerId": 77
    }
  }
}
```

### 2. Update using OR criteria + operators

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Invoice",
    "values": {
      "state": "COLLECTION"
    },
    "searchCriteria": {
      "logicalOp": "OR",
      "amount": { "op": "gt", "value": 10000 },
      "dueDate": { "op": "lt", "value": "2025-12-31" }
    }
  }
}
```

### 3. Batch update (`requests`)

```jsonc
{
  "database": "myDB",
  "requests": [
    {
      "name": "Account",
      "values": { "status": "ACTIVE" },
      "searchCriteria": { "app": { "op": "ilike", "value": "%mobile%" } }
    },
    {
      "name": "Customer",
      "values": { "tier": "GOLD" },
      "searchCriteria": { "region": "WEST" }
    }
  ]
}
```

### 4. Invalid update example (protected id)

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Account",
    "values": {
      "id": 999,                                     // Invalid: DataGateway rejects id updates
      "status": "ACTIVE"
    },
    "searchCriteria": {
      "acctId": 101
    }
  }
}
```

## DELETE Templates

### 1. Basic delete

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Invoice",
    "searchCriteria": {
      "state": "VOID"
    }
  }
}
```

### 2. Delete with grouped conditions

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Invoice",
    "searchCriteria": {
      "logicalOp": "AND",
      "amount": {
        "conditions": [                              // Inherits root logicalOp (AND)
          { "op": "lt", "value": 0 },
          { "op": "gt", "value": 1000000 }
        ]
      },
      "state": { "op": "ne", "value": "PAID" }
    }
  }
}
```

### 3. Delete with OR at root (no mixing)

```jsonc
{
  "database": "myDB",
  "request": {
    "name": "Invoice",
    "searchCriteria": {
      "logicalOp": "OR",                          // Entire tree uses OR
      "amount": {
        "conditions": [
          { "op": "lt", "value": 0 },
          { "op": "gt", "value": 1000000 }
        ]
      },
      "state": { "op": "ne", "value": "PAID" }
    }
  }
}
```

### 4. Batch delete (`requests`)

```jsonc
{
  "database": "myDB",
  "requests": [
    {
      "name": "Invoice",
      "searchCriteria": { "state": "ARCHIVED" }
    },
    {
      "name": "Account",
      "searchCriteria": { "status": "DELETED" }
    }
  ]
}
```

## Notes / Gotchas

- `database` must point to a connected DB key in DataGateway.
- `name` must be an allowed table name in the generated schema map.
- `searchCriteria` keys must be valid base-table columns for fetch/update/delete.
- `searchCriteria.logicalOp` applies to all sibling criteria fields in that request.
- Default logical combiner is `AND` if `searchCriteria.logicalOp` is omitted.
- Mixing `AND` and `OR` in the same criteria tree is currently not supported.
- `update` and `delete` require non-empty `searchCriteria`.
- `join.searchCriteria` is required and all join ON fragments are combined with `AND`.
- `retrieveFields` and `orderBy.field` may use alias notation like `j1.customerName`.
- Preferred reference style is table-qualified names (for example `Account.customerId`, `Customer.customerName`).
- Alias notation (`t0`, `j1`, `j2`) is still accepted for backward compatibility.
- Aliases are assigned internally as:
  - base table: `t0`
  - first join: `j1`
  - second join: `j2`, etc.
- If `request` and `requests` are both provided, both are executed (`request` is appended).
- Response shape is generally:
  - fetch: `{ success, results: [{ name, records[] }] }`
  - insert: `{ success, affected, results: [{ name, records[] }] }`
  - update/delete: `{ success, affected }`
