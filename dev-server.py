from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import re


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        request = urlparse(self.path)
        if request.path == '/api/nflverse':
            self.serve_archive(parse_qs(request.query).get('year', [''])[0])
            return
        super().do_GET()

    def serve_archive(self, year):
        if not re.fullmatch(r'(200[0-9]|201[0-9]|202[0-5])', year):
            self.send_json(400, {'error': 'Invalid season.'})
            return

        upstream = f'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{year}.csv'
        try:
            with urlopen(Request(upstream, headers={'User-Agent': 'Sunday-Draft-Club'}), timeout=30) as response:
                body = response.read()
        except Exception as error:
            self.send_json(502, {'error': f'Could not load the {year} archive: {error}'})
            return

        self.send_response(200)
        self.send_header('Content-Type', 'text/csv; charset=utf-8')
        self.send_header('Cache-Control', 'public, max-age=86400')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print('Retro Draftle running at http://localhost:8000')
    ThreadingHTTPServer(('localhost', 8000), Handler).serve_forever()