# VIBELINK Repository Setup Script
# This script initializes a git repository and performs the initial commit.

# 1. Initialize Git
Write-Host "Initializing Git repository..." -ForegroundColor Cyan
git init

# 2. Add all files
Write-Host "Staging files..." -ForegroundColor Cyan
git add .

# 3. Initial Commit
Write-Host "Performing initial commit..." -ForegroundColor Cyan
git commit -m "initial commit: VIBELINK application"

Write-Host "`nGit repository initialized successfully!" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Create a new repository on GitHub (https://github.com/new)"
Write-Host "2. Copy the repository URL (e.g., https://github.com/username/vibelink.git)"
Write-Host "3. Run the following commands in your terminal:"
Write-Host "   git remote add origin <YOUR_REPO_URL>"
Write-Host "   git branch -M main"
Write-Host "   git push -u origin main"
