Use list_connections to discover authorized Macs and their available interfaces. connection_id selects an entry point; hostId and threadId inside native params select the target.

DotX exposes three interfaces:
- app_tools invokes the desktop's tools.
- app_server runs an independent local App Server.
- client_coordination reaches the actual desktop task owner.

Use describe_methods to discover native methods and read their input/output schemas. Do not substitute the independent App Server for a desktop-owned operation. Rediscover runtime IDs after a connector restart. For an unavailable client_coordination transport, describe_methods explicitly attempts to connect again; it does not restore subscriptions.
