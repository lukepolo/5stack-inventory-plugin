Set `STEAM_COMMUNITY_URL` on an Inventory backend to send the Steam inventory
sync through another host. Steam rate-limits `steamcommunity.com/inventory`
per IP, and some hosting IPs keep getting 429 even when the backend has been
idle for hours. When another machine you run (the panel host, for example)
still gets 200, a reverse proxy there lets the sync leave from its IP.

The backend requests `${STEAM_COMMUNITY_URL}/inventory/<steamid>/730/2?...`
and keeps the status, headers and body it gets back, so a 429 from Steam still
reaches the backend as a 429. It does not follow redirects, so a redirect can't
send the request around the proxy. Unset or empty keeps
`https://steamcommunity.com`; a trailing slash is ignored, and a value that
isn't an http(s) URL stops the backend at startup.

A minimal nginx proxy that forwards only the inventory path:

```nginx
server {
  listen 8080;
  resolver 10.43.0.10 valid=60s ipv6=off;  # the cluster DNS service
  # Only the one request the backend makes, without cookies either way.
  location ~ "^/inventory/\d{17}/730/2$" {
    limit_except GET { deny all; }
    proxy_set_header Cookie "";
    proxy_hide_header Set-Cookie;
    set $steam https://steamcommunity.com;
    proxy_pass $steam;
    proxy_set_header Host steamcommunity.com;
    proxy_ssl_server_name on;
    proxy_ssl_name steamcommunity.com;
    proxy_ssl_verify on;
    proxy_ssl_verify_depth 3;  # the default of 1 rejects Steam's chain
    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
  }
  location / { return 404; }
}
```

Then `STEAM_COMMUNITY_URL=http://<proxy service>:8080`. Keep the proxy
cluster-internal: it carries only public inventory data, but an open one lets
anyone spend that host's Steam allowance.
