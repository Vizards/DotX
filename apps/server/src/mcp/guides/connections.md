Use list_connections to discover authorized Macs and their available interfaces. connection_id selects an entry point; hostId and threadId inside native params select the target.

The `updates` field is an optional release hint cached across the service. If `updates.status` is `unavailable`, such as with `GITHUB_HTTP_403`, continue installation and ordinary use based on the connection and interface states. This does not establish installation failure or that the installed version is current. Do not repeatedly query or reinstall to repair the hint; later normal use can check again under the existing cache policy. An actual update still requires readable target Release information and artifacts.

DotX exposes three interfaces:
- app_tools invokes the desktop's tools.
- app_server runs an independent local App Server.
- client_coordination reaches the actual desktop task owner.

Use describe_methods to discover native methods and read their input/output schemas. Do not substitute the independent App Server for a desktop-owned operation. Rediscover runtime IDs after a connector restart. For an unavailable client_coordination transport, describe_methods explicitly attempts to connect again; it does not restore subscriptions.
