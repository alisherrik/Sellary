# Sellary Release Checklist

## Local Verification

- [ ] Backend: `cd sellary-backend && .\.venv\Scripts\pytest.exe tests/integration tests/unit -q`
- [ ] Frontend: `cd sellary-frontend && npx vitest run && npm run build`
- [ ] Cashier: `cd sellary-cashier && npm test && npm run build`
- [ ] Desktop installer when needed: `cd sellary-cashier && npm run tauri:build`

## Production Backend

- [ ] Confirm Railway service is online: `railway status`
- [ ] Confirm `/health`: `Invoke-RestMethod https://sellary-production-30ec.up.railway.app/health`
- [ ] Confirm migrations: `alembic upgrade head` runs through Railway preDeploy.

## Production Frontend

- [ ] Confirm Netlify deploy state is `ready`.
- [ ] Confirm `https://sellary-client.netlify.app` returns 200.
- [ ] Login smoke test.

## Tauri Cashier

- [ ] Login smoke test.
- [ ] Select company.
- [ ] Bootstrap products/categories.
- [ ] Create one sale online and confirm it syncs.
- [ ] Create one sale offline and confirm it remains pending.
- [ ] Reconnect and confirm pending sale syncs.
