## Configuration Security for Anchorr

### 🚨 Important Security Notice

The `config/config.json` file contains sensitive information including:
- JWT secrets
- Discord bot tokens
- API keys
- Database credentials

### Security Best Practices

#### 1. Never commit sensitive configuration
```bash
# ❌ DON'T DO THIS
git add config/config.json
git commit -m "Updated config"

# ✅ DO THIS INSTEAD
# Keep config files in .gitignore
# Use environment variables or secure vaults
```

#### 2. Use environment variables
Create a `.env` file (also in .gitignore) or use your deployment platform's environment variables:
```bash
DISCORD_TOKEN=your_token_here
JELLYFIN_API_KEY=your_api_key_here
JWT_SECRET=your_jwt_secret_here
```

#### 3. Backup configurations securely
```bash
# ❌ DON'T create backups in the repo
cp config/config.json config/config.backup

# ✅ DO backup to a secure location
cp config/config.json ~/secure-backups/anchorr-config-$(date +%Y%m%d).json
```

#### 4. Development vs Production configs
- Use different API keys/tokens for development and production
- Never use production credentials in development
- Consider using tools like Docker Secrets or Kubernetes Secrets for production

#### 5. Rotate credentials regularly
- Change Discord bot tokens periodically
- Rotate API keys
- Update JWT secrets

### What's Protected

The CI/CD pipeline now includes:
- ✅ Automatic scanning for secrets in commits
- ✅ Checks for accidentally committed config files
- ✅ Dependency security auditing
- ✅ Detection of backup files in the repository

### If You Accidentally Commit Secrets

1. **Immediately rotate/revoke the exposed credentials**
2. **Remove from git history:**
   ```bash
   # For the most recent commit
   git reset --hard HEAD~1
   
   # For older commits, use git filter-branch or BFG Repo-Cleaner
   # Then force push (⚠️  dangerous on shared repos)
   git push --force-with-lease
   ```
3. **Update .gitignore to prevent future incidents**
4. **Inform your team about the incident**

### Environment Setup

Create a sample config template:
```json
{
  "JWT_SECRET": "CHANGE_ME",
  "DISCORD_TOKEN": "YOUR_DISCORD_BOT_TOKEN",
  "JELLYFIN_API_KEY": "YOUR_JELLYFIN_API_KEY",
  "// ... other settings": "..."
}
```