#!/usr/bin/env python3
"""开发用静态服务器：no-store，避免浏览器缓存旧模块。"""
import http.server
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler) as httpd:
        print(f'serving on http://127.0.0.1:{port}/')
        httpd.serve_forever()
