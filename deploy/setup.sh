#!/usr/bin/env bash
# إعداد خادم تخزين مدارك على السيرفر — يُشغّل مرة واحدة (root)
# الاستخدام:  bash /var/www/madarek/deploy/setup.sh
set -euo pipefail

ROOT=/var/www/madarek
ENV_FILE=/etc/madarek-api.env

# 1) توكن سري (يُولّد مرة واحدة ويُعاد استخدامه)
if [ -f "$ENV_FILE" ]; then
  TOKEN="$(grep -E '^API_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  echo "ℹ️  توكن موجود مسبقاً، سنعيد استخدامه."
else
  TOKEN="$(openssl rand -hex 24)"
fi
echo "🔑 API_TOKEN=$TOKEN"

# 2) Node.js 20 LTS + أدوات البناء (احتياطاً لـ better-sqlite3)
if ! command -v node >/dev/null 2>&1; then
  echo "📦 تثبيت Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs build-essential python3 sqlite3
fi
echo "✅ Node $(node -v)"

# 3) تثبيت اعتماديات الخادم
echo "📦 تثبيت اعتماديات الخادم..."
cd "$ROOT/server"
npm install --omit=dev --no-audit --no-fund

# 4) ملف البيئة (التوكن) — صلاحيات مقيّدة
echo "API_TOKEN=$TOKEN" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# 5) إعداد الواجهة (التوكن للمتصفح) — غير موجود في المستودع العام
cat > "$ROOT/api-config.js" <<EOF
window.MADAREK_API_BASE='/api';
window.MADAREK_API_TOKEN='$TOKEN';
EOF

# 6) خدمة systemd
cp "$ROOT/deploy/madarek-api.service" /etc/systemd/system/madarek-api.service
systemctl daemon-reload
systemctl enable --now madarek-api
sleep 1
echo "—— حالة الخدمة ——"
systemctl --no-pager status madarek-api | head -6 || true
echo "—— فحص الصحة ——"
curl -s http://127.0.0.1:3001/api/health || echo "⚠️ الخدمة لم تستجب"
echo

# 7) نسخة احتياطية يومية (2:30 فجراً)
cp "$ROOT/deploy/backup-db.sh" /usr/local/bin/madarek-backup.sh
chmod +x /usr/local/bin/madarek-backup.sh
( crontab -l 2>/dev/null | grep -v madarek-backup || true ; \
  echo "30 2 * * * /usr/local/bin/madarek-backup.sh >> /var/log/madarek-backup.log 2>&1" ) | crontab -

echo
echo "✅ تم إعداد الخادم. الخطوة الأخيرة: إضافة مسار /api إلى إعداد nginx."
