import sys
import os
import time
import subprocess
import argparse
import socket
from contextlib import closing

def check_port(port):
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        if sock.connect_ex(('localhost', port)) == 0:
            return True
        return False

def wait_for_server(port, timeout=10):
    start_time = time.time()
    while time.time() - start_time < timeout:
        if check_port(port):
            return True
        time.sleep(0.5)
    return False

def main():
    parser = argparse.ArgumentParser(description='Run a command with a temporary HTTP server.')
    parser.add_argument('command', nargs=argparse.REMAINDER, help='The command to run')
    parser.add_argument('--port', type=int, default=8000, help='Port to run the server on')
    parser.add_argument('--dir', default='.', help='Directory to serve')
    
    args = parser.parse_args()
    
    # Start the server
    print(f"Starting server on port {args.port}...")
    server_process = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(args.port), '--directory', args.dir],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    try:
        # Wait for server to start
        if not wait_for_server(args.port):
            print("Failed to start server.")
            sys.exit(1)
            
        print("Server started. Running command...")
        
        # Run the command
        if args.command:
            # Remove '--' if present at the start of command
            cmd = args.command
            if cmd[0] == '--':
                cmd = cmd[1:]
                
            result = subprocess.run(cmd)
            sys.exit(result.returncode)
        else:
            print("No command specified. Server is running. Press Ctrl+C to stop.")
            server_process.wait()
            
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server_process.terminate()
        server_process.wait()

if __name__ == '__main__':
    main()
