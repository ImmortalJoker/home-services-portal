"""HTTP phase for the disposable REL-04 worker. Output is limited to fixed labels."""

import base64
import json
import os
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from secrets import token_hex
from threading import Thread
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, ProxyHandler, Request, build_opener

AUTH = "http://auth.rel04.test:9000"
TRANSMISSION = "http://transmission.rel04.test:9000"
METRICS = "http://metrics.rel04.test:9000"
OWNER_PATH = "/rel04-owner"
START = "/outpost.goauthentik.io/start"
LOGIN = "/if/flow/default-authentication-flow/"
EXECUTOR = "/api/v3/flows/executor/default-authentication-flow/"
REDIRECTS = (301, 302, 303, 307, 308)


class ProbeFailure(Exception):
    pass


def observe(service, method, path, headers, authorization):
    if method != "GET" or path != OWNER_PATH:
        return "REL04_HTTP_ACCESS"
    expected_host = "127.0.0.1:9091" if service == "transmission" else urlsplit(METRICS).netloc
    if headers.get_all("Host", []) != [expected_host]:
        return "REL04_HTTP_HOST"
    expected_auth = [authorization] if service == "transmission" else []
    if headers.get_all("Authorization", []) != expected_auth:
        return "REL04_HTTP_AUTHORIZATION"
    return service


def require_arrivals(arrivals, expected, *, anonymous=False):
    if anonymous and arrivals != expected:
        raise ProbeFailure("REL04_HTTP_ANONYMOUS")
    for arrival in arrivals:
        if arrival.startswith("REL04_HTTP_"):
            raise ProbeFailure(arrival)
    if arrivals != expected:
        raise ProbeFailure("REL04_HTTP_ARRIVALS")


class FixtureListener(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        pass


def listen(port, service, authorization, arrivals):
    class Handler(BaseHTTPRequestHandler):
        timeout = 5

        def log_message(self, *_args):
            pass

        def parse_request(self):
            if not super().parse_request():
                arrivals.append("REL04_HTTP_ACCESS")
                return False
            result = observe(service, self.command, self.path, self.headers, authorization)
            arrivals.append(result)
            self.send_response(204 if result == service else 400)
            self.end_headers()
            return False  # The entire response was handled above, including unexpected methods.

    listener = FixtureListener(("0.0.0.0", port), Handler)
    Thread(target=listener.serve_forever, daemon=True).start()
    return listener


class ManualRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args):
        return None


class Browser:
    def __init__(self, proxy):
        self.cookies = CookieJar()
        self.opener = build_opener(ProxyHandler({}), ManualRedirect(), HTTPCookieProcessor(self.cookies))
        self.proxy = proxy
        self.authorities = {urlsplit(origin).netloc for origin in (AUTH, proxy)}

    def request(self, url, values=None):
        target = urlsplit(url)
        if target.scheme != "http" or target.netloc not in self.authorities:
            raise ProbeFailure("REL04_HTTP_ACCESS")
        headers = {}
        body = None
        if values is not None:
            if target.netloc != urlsplit(AUTH).netloc or target.path != EXECUTOR:
                raise ProbeFailure("REL04_HTTP_ACCESS")
            body = json.dumps(values).encode()
            headers = {"Content-Type": "application/json", "Origin": AUTH}
            for cookie in self.cookies:
                if cookie.name == "authentik_csrf" and cookie.domain.lstrip(".") == target.hostname:
                    headers["X-Authentik-CSRF"] = cookie.value
        try:
            response = self.opener.open(Request(url, data=body, headers=headers), timeout=4)
        except HTTPError as error:
            response = error
        with response:
            challenge = None
            if response.code == 200 and target.path == EXECUTOR:
                challenge = json.loads(response.read(256 * 1024))
            return response.code, response.headers.get("Location"), challenge


def authenticate(browser, username, password, failure):
    url = browser.proxy + START + "?" + urlencode({"rd": OWNER_PATH})
    values = None
    submitted_password = False
    callback_seen = False
    for _ in range(24):
        status, location, challenge = browser.request(url, values)
        values = None
        if status == 204 and url == browser.proxy + OWNER_PATH:
            if submitted_password and callback_seen:
                return
            break
        callback_seen |= url.startswith(browser.proxy + "/outpost.goauthentik.io/callback?") and status == 302
        if status in REDIRECTS and location:
            url = urljoin(url, location)
            continue
        target = urlsplit(url)
        if status == 200 and target.netloc == urlsplit(AUTH).netloc and target.path == LOGIN:
            url = AUTH + EXECUTOR + "?" + urlencode({"query": target.query})
            continue
        if not isinstance(challenge, dict) or challenge.get("response_errors"):
            break
        component = challenge.get("component")
        if component == "xak-flow-redirect":
            url = urljoin(url, challenge["to"])
            continue
        if component == "ak-stage-identification":
            values = {"uid_field": username}
        elif component == "ak-stage-password":
            values = {"password": password}
            submitted_password = True
        elif component == "ak-stage-user-login":
            values = {"remember_me": False}
        else:
            break
        values["component"] = component
    raise ProbeFailure(failure)


def anonymous_check(proxy, arrivals, expected):
    deadline = monotonic() + 45
    while monotonic() < deadline:
        browser = Browser(proxy)
        try:
            status, location, _ = browser.request(proxy + OWNER_PATH)
            require_arrivals(arrivals, expected, anonymous=True)
            if status == 302 and location and urljoin(proxy, location).startswith(proxy + START + "?"):
                status, location, _ = browser.request(urljoin(proxy, location))
                require_arrivals(arrivals, expected, anonymous=True)
                if status == 302 and location and location.startswith(AUTH + "/application/o/authorize/"):
                    return
        except URLError:
            pass
        sleep(1)
    require_arrivals(arrivals, expected, anonymous=True)
    raise ProbeFailure("REL04_HTTP_READINESS")


def main():
    arrivals = []
    listeners = []
    phase = "REL04_HTTP_SETUP"
    try:
        from authentik.core.models import Group, User
        from authentik.outposts.models import Outpost

        username = "rel04-owner-" + token_hex(8)
        password = token_hex(32)
        owner = User.objects.create_user(username=username, password=password)
        owner.groups.add(Group.objects.get(name="Portal - Owner"))
        outpost = Outpost.objects.get(name="authentik Embedded Outpost")
        config = outpost.config
        config.authentik_host = AUTH
        outpost.config = config
        outpost.save(update_fields=["_config"])

        rpc = os.environ["PORTAL_TRANSMISSION_RPC_USERNAME"] + ":" + os.environ["PORTAL_TRANSMISSION_RPC_PASSWORD"]
        authorization = "Basic " + base64.b64encode(rpc.encode()).decode("ascii")
        listeners.append(listen(9091, "transmission", authorization, arrivals))
        listeners.append(listen(8086, "metrics", authorization, arrivals))

        for proxy, service, expected in ((TRANSMISSION, "transmission", []),
                                         (METRICS, "metrics", ["transmission"])):
            phase = "REL04_HTTP_READINESS"
            anonymous_check(proxy, arrivals, expected)
            phase = "REL04_HTTP_" + service.upper()
            authenticate(Browser(proxy), username, password, phase)
            require_arrivals(arrivals, [*expected, service])
        phase = "REL04_HTTP_ARRIVALS"
    except ProbeFailure as error:
        phase = str(error)
    except Exception:
        pass
    finally:
        for listener in listeners:
            listener.shutdown()
            listener.server_close()

    # A failure returned by the upstream may also result in a failed browser
    # request. Prefer the independent listener's assertion in that case.
    if phase != "REL04_HTTP_ANONYMOUS":
        phase = next((arrival for arrival in arrivals if arrival.startswith("REL04_HTTP_")), phase)
    if phase == "REL04_HTTP_ARRIVALS" and arrivals == ["transmission", "metrics"]:
        print("REL04_HTTP_PASSED", flush=True)
        return
    print(phase, flush=True)
    raise SystemExit(1)
