"""Read-only public production checks. No tokens or shop records are accessed."""

import json

import httpx


base = "https://sellary-production-30ec.up.railway.app"
with httpx.Client(timeout=30, follow_redirects=False) as client:
    health = client.get(base + "/health")
    assert health.status_code == 200 and health.json()["status"] == "healthy"
    resource = client.get(base + "/.well-known/oauth-protected-resource/mcp")
    assert resource.status_code == 200
    assert resource.json()["resource"] == base + "/mcp"
    assert resource.json()["authorization_servers"] == [base + "/mcp"]
    authorization = client.get(base + "/.well-known/oauth-authorization-server/mcp")
    assert authorization.status_code == 200
    metadata = authorization.json()
    assert metadata["issuer"].rstrip("/") == base + "/mcp"
    assert metadata["token_endpoint"] == base + "/mcp/token"
    assert set(metadata["scopes_supported"]) == {
        "sellary:reports", "sellary:records", "sellary:purchasing",
    }
    transport = client.post(base + "/mcp", headers={
        "Accept": "application/json, text/event-stream",
    }, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-11-25", "capabilities": {},
        "clientInfo": {"name": "Sellary deployment verification", "version": "1"},
    }})
    assert transport.status_code == 401
    assert "oauth-protected-resource/mcp" in transport.headers["www-authenticate"]
    rest = client.get(base + "/api/auth/me")
    assert rest.status_code == 401
    print(json.dumps({
        "health": health.status_code, "status": health.json()["status"],
        "oauth_resource": resource.status_code,
        "oauth_authorization": authorization.status_code,
        "issuer": metadata["issuer"], "scopes": metadata["scopes_supported"],
        "mcp_unauthenticated": transport.status_code,
        "rest_unauthenticated": rest.status_code,
    }, indent=2))
