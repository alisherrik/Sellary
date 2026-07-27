"""Server-rendered pages for the connector's login flow.

Three forms. No framework, no assets, no client-side script — everything here
is a POST to the next step. Russian, matching the rest of the product's UI.
"""

from html import escape


_SHELL = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sellary — подключение</title>
<style>
  :root {{ color-scheme: light dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px;
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f4f5f7; color: #14161a;
  }}
  .card {{
    width: 100%; max-width: 400px; background: #fff; border-radius: 14px;
    padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 28px rgba(0,0,0,.06);
  }}
  .brand {{ font-weight: 700; font-size: 20px; letter-spacing: -.02em; }}
  .sub {{ color: #6b7280; font-size: 13px; margin-top: 4px; }}
  h1 {{ font-size: 17px; margin: 22px 0 4px; }}
  p.hint {{ color: #6b7280; font-size: 13px; margin: 0 0 18px; }}
  label {{ display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }}
  input[type=text], input[type=password] {{
    width: 100%; padding: 10px 12px; border: 1px solid #d5d8dd; border-radius: 8px;
    font-size: 15px; background: #fff; color: inherit;
  }}
  input:focus {{ outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }}
  button {{
    width: 100%; margin-top: 20px; padding: 11px 14px; border: 0; border-radius: 8px;
    background: #2563eb; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  }}
  button:hover {{ background: #1d4ed8; }}
  button.ghost {{ background: #eceef1; color: #14161a; margin-top: 8px; }}
  button.ghost:hover {{ background: #e0e3e8; }}
  .error {{
    margin: 16px 0 0; padding: 10px 12px; border-radius: 8px;
    background: #fdeaea; color: #9b1c1c; font-size: 13px;
  }}
  .choice {{
    display: block; width: 100%; text-align: left; padding: 12px 14px; margin-top: 8px;
    border: 1px solid #d5d8dd; border-radius: 8px; background: #fff; color: inherit;
    font-size: 15px; cursor: pointer;
  }}
  .choice:hover {{ border-color: #2563eb; background: #f5f8ff; }}
  .grants {{ margin: 16px 0 0; padding: 14px; background: #f7f8fa; border-radius: 10px; }}
  .grants ul {{ margin: 8px 0 0; padding-left: 20px; }}
  .grants li {{ margin: 4px 0; font-size: 13px; }}
  .meta {{ font-size: 13px; color: #6b7280; }}
  .meta b {{ color: #14161a; }}
  @media (prefers-color-scheme: dark) {{
    body {{ background: #0f1115; color: #e8eaed; }}
    .card {{ background: #181b21; box-shadow: none; border: 1px solid #262b33; }}
    input[type=text], input[type=password] {{ background: #0f1115; border-color: #333a44; }}
    .choice {{ background: #0f1115; border-color: #333a44; }}
    .choice:hover {{ background: #16213a; }}
    button.ghost {{ background: #262b33; color: #e8eaed; }}
    .grants {{ background: #0f1115; }}
    .meta b {{ color: #e8eaed; }}
    .error {{ background: #3b1414; color: #f8b4b4; }}
  }}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">Sellary</div>
    <div class="sub">{subtitle}</div>
    {body}
  </div>
</body>
</html>
"""


def _shell(subtitle: str, body: str) -> str:
    return _SHELL.format(subtitle=escape(subtitle), body=body)


def _error_block(message: str | None) -> str:
    return f'<div class="error">{escape(message)}</div>' if message else ""


def render_login(txn: str, client_name: str, error: str | None = None) -> str:
    body = f"""
    <h1>Вход</h1>
    <p class="hint">Приложение <b>{escape(client_name)}</b> запрашивает доступ
    к вашим данным в Sellary.</p>
    {_error_block(error)}
    <form method="post" action="/mcp/oauth/login">
      <input type="hidden" name="txn" value="{escape(txn)}">
      <label for="username">Логин</label>
      <input id="username" name="username" type="text" autocomplete="username"
             autofocus required>
      <label for="password">Пароль</label>
      <input id="password" name="password" type="password"
             autocomplete="current-password" required>
      <button type="submit">Войти</button>
    </form>
    """
    return _shell("Подключение приложения", body)


def render_company(txn: str, companies: list[dict], error: str | None = None) -> str:
    options = "".join(
        f'<button class="choice" type="submit" name="company_id" value="{company["id"]}">'
        f'{escape(company["name"])}</button>'
        for company in companies
    )
    body = f"""
    <h1>Выберите компанию</h1>
    <p class="hint">Доступ будет выдан только к выбранной компании.</p>
    {_error_block(error)}
    <form method="post" action="/mcp/oauth/company">
      <input type="hidden" name="txn" value="{escape(txn)}">
      {options}
    </form>
    """
    return _shell("Подключение приложения", body)


def render_consent(
    txn: str, client_name: str, company_name: str, user_label: str, scopes: list[str]
) -> str:
    labels = {
        "sellary:reports": "Просмотр отчётов: продажи, прибыль, смены, склад, деньги",
        "sellary:purchasing": "Оформление закупок: создание заказов и приход товара",
    }
    items = "".join(
        f"<li>{escape(labels.get(scope, scope))}</li>" for scope in scopes
    ) or "<li>Только чтение отчётов</li>"

    body = f"""
    <h1>Подтвердите доступ</h1>
    <p class="hint">Приложение <b>{escape(client_name)}</b> получит доступ
    от вашего имени.</p>
    <p class="meta">Пользователь: <b>{escape(user_label)}</b><br>
       Компания: <b>{escape(company_name)}</b></p>
    <div class="grants">
      <div class="meta">Что будет разрешено:</div>
      <ul>{items}</ul>
    </div>
    <form method="post" action="/mcp/oauth/consent">
      <input type="hidden" name="txn" value="{escape(txn)}">
      <button type="submit" name="decision" value="approve">Разрешить</button>
      <button class="ghost" type="submit" name="decision" value="deny">Отмена</button>
    </form>
    """
    return _shell("Подключение приложения", body)


def render_error(message: str) -> str:
    body = f"""
    <h1>Не удалось продолжить</h1>
    {_error_block(message)}
    <p class="hint" style="margin-top:16px">Закройте это окно и попробуйте
    подключить приложение заново.</p>
    """
    return _shell("Подключение приложения", body)
