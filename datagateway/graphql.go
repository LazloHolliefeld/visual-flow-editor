package main

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
			Query string `json:"query"`
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
