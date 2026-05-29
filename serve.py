"""
drum_simulator dev server
Serves from parent '1. 개발/' directory so that
../robot_simulator/meshes/ resolves correctly.

Usage:
  python serve.py          → http://localhost:8082/drum_simulator/
"""
import http.server, socketserver, os, webbrowser, threading

PORT = 8083
# Serve from the parent of drum_simulator (= '1. 개발/')
SERVE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SUPPRESS_PREFIXES = ('/robot_simulator/meshes/',)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SERVE_DIR, **kwargs)

    def log_message(self, fmt, *args):
        path = args[0] if args else ''
        for prefix in SUPPRESS_PREFIXES:
            if isinstance(path, str) and prefix in path:
                return
        super().log_message(fmt, *args)

def open_browser():
    webbrowser.open(f'http://localhost:{PORT}/drum_simulator/')

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    os.chdir(SERVE_DIR)
    with ReusableTCPServer(('', PORT), QuietHandler) as httpd:
        print(f'Serving {SERVE_DIR}')
        print(f'Open → http://localhost:{PORT}/drum_simulator/')
        threading.Timer(0.8, open_browser).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')
