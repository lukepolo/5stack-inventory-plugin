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

## Running the proxy in the cluster

`k8s/steam-egress/` runs that nginx proxy as a Deployment and a ClusterIP
Service named `steam-egress` in the `5stack` namespace. It is not part of the
overlays, so nothing changes until you apply it:

1. Label the node whose IP Steam still answers (often the panel host):

   ```bash
   kubectl label node <node> 5stack-steam-egress=true
   ```

   The pod stays Pending until a node carries the label, so it never quietly
   lands on the node Steam refuses. Pick a node with its own public IP: two
   nodes behind the same NAT look like one to Steam.

2. Apply it: `kubectl apply -k k8s/steam-egress` from this repo, or
   `kubectl apply -k custom/inventory/steam-egress` from the panel repo when
   `k8s/` was copied to `custom/inventory/`.
3. Set `STEAM_COMMUNITY_URL=http://steam-egress:8080` in the plugin's
   `base/inventory.env` on the panel and deploy again (`./custom.sh inventory` from
   the panel repo) so the backend picks it up.

The config uses `10.43.0.10`, k3s's default cluster DNS address; change the
`resolver` line if your cluster's DNS service has another IP
(`kubectl -n kube-system get svc kube-dns`). To remove it:
unset `STEAM_COMMUNITY_URL`, deploy again, then
`kubectl delete -k k8s/steam-egress`.
