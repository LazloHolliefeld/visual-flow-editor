package main

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
	
	fmt.Printf("DataGateway starting on :%s\n", port)
	fmt.Printf("  REST:    http://localhost:%s/api/\n", port)
	fmt.Printf("  gRPC:    localhost:50051\n")
	fmt.Printf("  GraphQL: http://localhost:8081/graphql\n")
	
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
