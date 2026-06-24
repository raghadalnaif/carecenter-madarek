# Madarek Project — Server Info

## Production Server
- **IP:** 207.180.202.200
- **User:** root
- **Path:** /var/www/madarek

## Deploy Command
```bash
ssh root@207.180.202.200 "cd /var/www/madarek && git pull origin main"
```

## Notes
- Server is a git repo synced to `main` branch
- Single-file app: `index.html` (also synced as `childcare-system.html`)
- BUILD version string is in `index.html` head IIFE
