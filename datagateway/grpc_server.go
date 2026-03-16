package main

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
