# Kill existing node and python processes (Aggressive cleanup)
taskkill /F /IM node.exe /T 2>$null
taskkill /F /IM python.exe /T 2>$null

# Start Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd sellary-backend; .\.venv\Scripts\activate; python main.py" -WorkingDirectory "$PSScriptRoot"

# Wait a moment for backend to init
Start-Sleep -Seconds 5

# Start Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd sellary-frontend; npm run dev" -WorkingDirectory "$PSScriptRoot"

Write-Host "Servers restarted! backend:8000, frontend:3000"
